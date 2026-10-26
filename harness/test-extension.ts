/**
 * Loads the built extension into a real (headless) Chrome and verifies the half
 * of the system the Bun harness can't reach:
 *
 *   1. the MV3 service worker registers,
 *   2. the new-tab override renders (the API-key screen on a fresh profile),
 *   3. the worker answers `subscribe` on the build port with a snapshot,
 *   4. `startBuild` with no API key fails cleanly with an error message,
 *   5. `chrome.history` is readable, so the `history` permission is real.
 *
 * No API calls are made. Chrome 136+ ignores `--load-extension`, so the
 * extension is loaded over CDP's Extensions domain instead.
 *
 * Run: pnpm build && pnpm extension:test
 * Set CHROME_PATH if Chrome isn't at the default macOS location.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXT = join(import.meta.dir, "../apps/extension/.output/chrome-mv3");
const PORT = Number(process.env.TEST_CDP_PORT ?? 9333);

if (!existsSync(join(EXT, "manifest.json"))) {
  console.error(`No build at ${EXT}. Run: pnpm build`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), "hp-ext-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (label: string, pass: boolean, extra?: string) => {
  console.log(`${pass ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!pass) failures++;
};

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-extension-debugging", // required for the CDP Extensions domain
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function getJson(path: string) {
  return (await fetch(`http://127.0.0.1:${PORT}${path}`)).json() as Promise<any>;
}

/** Minimal CDP client over a target's websocket. */
async function cdp(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const waiters = new Map<number, (v: any) => void>();
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data));
    if (msg.id && waiters.has(msg.id)) {
      waiters.get(msg.id)!(msg);
      waiters.delete(msg.id);
    }
  };
  const send = (method: string, params: unknown = {}) =>
    new Promise<any>((res) => {
      const n = ++id;
      waiters.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return {
    send,
    close: () => ws.close(),
    async evaluate<T>(expression: string): Promise<T> {
      const r = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      const ex = r.result?.exceptionDetails;
      if (ex) throw new Error(ex.exception?.description ?? JSON.stringify(ex));
      return r.result?.result?.value as T;
    },
  };
}

try {
  let version: any;
  for (let i = 0; i < 80; i++) {
    try {
      version = await getJson("/json/version");
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error("Chrome devtools endpoint never came up");
  console.log(`   ${version.Browser}\n`);

  // ---- load the unpacked extension ----------------------------------------
  const browser = await cdp(version.webSocketDebuggerUrl);
  const loaded = await browser.send("Extensions.loadUnpacked", { path: EXT });
  const extId: string | undefined = loaded.result?.id;
  if (!extId) throw new Error(`loadUnpacked failed: ${JSON.stringify(loaded)}`);
  console.log(`   extension id: ${extId}\n`);

  // ---- 1. service worker ---------------------------------------------------
  let sw: any;
  for (let i = 0; i < 40 && !sw; i++) {
    const targets: any[] = await getJson("/json/list");
    sw = targets.find((t) => t.type === "service_worker" && t.url.includes(extId));
    if (!sw) await sleep(250);
  }
  check("MV3 service worker registered", Boolean(sw), sw?.url.split("/").pop());

  // ---- 2. new-tab override renders ----------------------------------------
  const targets: any[] = await getJson("/json/list");
  const blank = targets.find((t) => t.type === "page");
  if (!blank) throw new Error("no page target to navigate");

  const page = await cdp(blank.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  const nav = await page.send("Page.navigate", { url: `chrome-extension://${extId}/newtab.html` });
  if (nav.result?.errorText) throw new Error(`navigate failed: ${nav.result.errorText}`);

  let href = "";
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      href = await page.evaluate<string>("location.href");
      const ready = await page.evaluate<string>("document.readyState");
      if (href.startsWith("chrome-extension://") && ready === "complete") break;
    } catch {
      /* navigation in flight */
    }
  }
  check("new-tab override loads", href.startsWith("chrome-extension://"), href);

  await sleep(2500); // let React mount
  const bodyText = await page.evaluate<string>("document.body.innerText");
  check(
    "renders the API-key setup screen",
    /Connect your Anthropic API key/i.test(bodyText),
    bodyText.split("\n").filter(Boolean)[0]?.slice(0, 50),
  );

  // Open a build port, send one message, and collect replies for a moment.
  const talk = (msg: object, waitMs: number) =>
    page.evaluate<string>(`
      new Promise((resolve) => {
        const port = chrome.runtime.connect({ name: "homepage-agent" });
        const replies = [];
        port.onMessage.addListener((m) => replies.push(m));
        port.postMessage(${JSON.stringify(msg)});
        setTimeout(() => { port.disconnect(); resolve(JSON.stringify(replies)); }, ${waitMs});
      })
    `).then((raw) => JSON.parse(raw) as any[]);

  // ---- 3. subscribe → snapshot ---------------------------------------------
  const subscribed = await talk({ kind: "subscribe" }, 1500);
  const snapshot = subscribed.find((m) => m.kind === "snapshot");
  check(
    "worker answers subscribe with a build snapshot",
    Boolean(snapshot) && snapshot.state.running === false,
    JSON.stringify(subscribed[0])?.slice(0, 80),
  );

  // ---- 4. startBuild without a key fails cleanly ----------------------------
  const started = await talk({ kind: "startBuild" }, 3000);
  const error = started.find((m) => m.kind === "error");
  check("startBuild with no API key reports an error", /API key/i.test(error?.message ?? ""), error?.message);

  // A missing-key resume must keep the exact evidence paired with its session.
  await page.evaluate(`chrome.storage.local.set({activeSessionId:"resume-fixture",githubInbox:{sessionId:"resume-fixture",inbox:{owner:"tmustier",checkedAt:"2026-10-26",items:[],warnings:[]},summaries:[]}})`);
  await talk({ kind: "startBuild", resume: true }, 500);
  check("missing-key resume preserves its session and GitHub evidence", await page.evaluate<boolean>(`chrome.storage.local.get(["activeSessionId","githubInbox"]).then(s=>s.activeSessionId==="resume-fixture" && s.githubInbox.sessionId==="resume-fixture")`));
  await page.evaluate(`chrome.storage.local.remove(["activeSessionId","githubInbox"])`);

  // ---- 5. chrome.history is readable ---------------------------------------
  const domains = await page.evaluate<string[]>(`
    (async () => {
      const seed = [
        "https://news.ycombinator.com/",
        "https://news.ycombinator.com/item?id=1",
        "https://lobste.rs/",
        "https://arstechnica.com/",
      ];
      for (const url of seed) await chrome.history.addUrl({ url });
      await new Promise((r) => setTimeout(r, 500));
      const items = await chrome.history.search({ text: "", startTime: 0, maxResults: 100 });
      return [...new Set(items.map((i) => new URL(i.url).hostname))];
    })()
  `);
  check(
    "chrome.history is readable (seeded domains returned)",
    domains.includes("news.ycombinator.com"),
    domains.join(", "),
  );

  // ---- GitHub section: real extension rendering with explicit UI fixtures ----
  // No real API credentials are used or copied into this isolated profile.
  const fixture = {
    owner: "tmustier", checkedAt: new Date().toISOString(), warnings: [],
    items: [
      { url: "https://github.com/tmustier/codex-computer-use-mcp/pull/39", repo: "tmustier/codex-computer-use-mcp", number: 39, kind: "PR", title: "Add Windows support", author: "contributor", body: "Support the official Windows helper.", updatedAt: new Date().toISOString(), change: "updated", comments: [], pr: { draft: false, mergeable: null, checks: "passing", reviews: [] } },
      { url: "https://github.com/tmustier/pi-for-excel/pull/772", repo: "tmustier/pi-for-excel", number: 772, kind: "PR", title: "Bump hono", author: "dependabot[bot]", body: "Update the dependency.", updatedAt: new Date().toISOString(), change: "new", comments: [], pr: { draft: false, mergeable: true, checks: "pending", reviews: [] } },
      { url: "https://github.com/tmustier/pi-extensions/issues/115", repo: "tmustier/pi-extensions", number: 115, kind: "Issue", title: "files-widget hardcodes brew", author: "contributor", body: "The message assumes Homebrew.", updatedAt: new Date().toISOString(), change: "unchanged", comments: [] },
    ],
  };
  const githubState = {
    inbox: fixture,
    summaries: [
      { url: fixture.items[0].url, summary: "Adds Windows support using the official helper.", action: "Review the implementation and Windows test evidence.", bucket: "needs-you" },
      { url: fixture.items[1].url, summary: "Updates the Hono dependency; checks are still running.", action: "Wait for CI, then review the update.", bucket: "waiting" },
    ],
  };
  await page.evaluate(`chrome.storage.local.set(${JSON.stringify({ apiKey: "ui-test-not-a-real-key", autoRebuild: false, githubOwner: "tmustier", githubToken: "ui-test-token", githubInbox: githubState, homepageData: { code: "import React from 'react'; export default function PersonalizedHomepage(){return <main style={{padding:40,fontFamily:'system-ui'}}><h1>Existing homepage preserved</h1><p>Your usual reading stays below the GitHub inbox.</p></main>}", timestamp: new Date().toISOString() } })})`);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.send("Page.reload");
  await sleep(3500);
  const inboxText = await page.evaluate<string>("document.body.innerText");
  check("GitHub section renders alongside the existing homepage iframe", inboxText.includes("GitHub inbox") && await page.evaluate<boolean>("Boolean(document.querySelector('iframe'))"));
  check("summary and next action are visible", inboxText.includes("Adds Windows support") && inboxText.includes("Review the implementation"));
  check("unsummarised items remain visible for manual triage", inboxText.includes("AI summary unavailable"));
  check("GitHub links are canonical external links", await page.evaluate<boolean>("document.querySelector('.github-item h3 a').href === 'https://github.com/tmustier/codex-computer-use-mcp/pull/39'"));

  const out = join(import.meta.dir, "out");
  mkdirSync(out, { recursive: true });
  const shot = async (name: string, clip?: object) => {
    const r = await page.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
    if (!r.result?.data) throw new Error("Screenshot failed");
    writeFileSync(join(out, name), Buffer.from(r.result.data, "base64"));
  };
  check("build error does not cover the GitHub header", await page.evaluate<boolean>(`(() => {const banner=document.querySelector('[title="Dismiss"]').parentElement;return document.querySelector('.github-section').getBoundingClientRect().top >= banner.getBoundingClientRect().bottom})()`));
  await page.evaluate(`document.querySelector('[title="Dismiss"]').click()`);
  await shot("github-desktop.png");
  const box = await page.evaluate<object>("(() => {const r=document.querySelector('.github-section').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()");
  await shot("github-section.png", box);
  await page.evaluate("Array.from(document.querySelectorAll('.github-groups button')).find(b=>b.textContent.includes('Waiting on others')).click()");
  check("waiting filter includes Dependabot", (await page.evaluate<string>("document.querySelector('.github-items').innerText")).includes("dependabot[bot]"));
  await page.evaluate("Array.from(document.querySelectorAll('.github-groups button')).find(b=>b.textContent.includes('All open')).click()");
  check("All open keeps every unresolved item", await page.evaluate<number>("document.querySelectorAll('.github-item').length") === 3);

  await page.evaluate(`chrome.storage.local.set({githubInbox:${JSON.stringify({ ...githubState, error: "GitHub returned 403: rate limited." })}})`);
  await sleep(250);
  check("failed refresh displays stale warning without discarding items", (await page.evaluate<string>("document.body.innerText")).includes("Showing the last successful snapshot") && await page.evaluate<number>("document.querySelectorAll('.github-item').length") === 3);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await shot("github-laptop.png");
  check("no horizontal overflow at 1024px", await page.evaluate<boolean>("document.documentElement.scrollWidth <= innerWidth"));
  const context = await page.evaluate<object>(`({font:getComputedStyle(document.querySelector('.github-section')).fontFamily,brokenImages:Array.from(document.images).filter(i=>!i.naturalWidth).length,hasFocusRule:Array.from(document.styleSheets).some(s=>{try{return Array.from(s.cssRules).some(r=>(r.selectorText||'').includes(':focus-visible'))}catch{return false}})})`);
  console.log("Visual context:", JSON.stringify(context));
  await page.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.title==='Customize homepage').click()");
  check("settings offers username and password-masked token", await page.evaluate<boolean>("document.querySelector('input[aria-label=\"GitHub username\"]').value === 'tmustier' && document.querySelector('input[aria-label=\"GitHub token (optional)\"]').type === 'password'"));
  await shot("github-settings.png");
  await page.evaluate(`chrome.storage.local.set({githubOwner:""})`);
  await sleep(200);
  check("account changes in storage hide the section and update open settings", await page.evaluate<boolean>(`!document.querySelector('.github-section') && document.querySelector('input[aria-label="GitHub username"]').value === ""`));

  // Optionally render persisted results from a real build, without copying credentials.
  if (process.env.LIVE_HOMEPAGE_PATH && process.env.LIVE_GITHUB_PATH) {
    const code = readFileSync(process.env.LIVE_HOMEPAGE_PATH, "utf8");
    const live = JSON.parse(readFileSync(process.env.LIVE_GITHUB_PATH, "utf8"));
    await page.evaluate(`chrome.storage.local.set(${JSON.stringify({ githubOwner: live.inbox.owner, githubInbox: live, homepageData: { code, timestamp: new Date().toISOString() } })})`);
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.reload");
    await sleep(8000);
    await page.evaluate(`document.querySelector('[title="Dismiss"]')?.click()`);
    check("live build summaries render without missing-item fallbacks", await page.evaluate<boolean>(`document.querySelector('.github-section').innerText.includes('All open ${live.inbox.items.length}') && !document.querySelector('.github-section').innerText.includes('AI summary unavailable')`));
    await shot("github-live-desktop.png");
    const liveBox = await page.evaluate<object>("(() => {const r=document.querySelector('.github-section').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()");
    await shot("github-live-section.png", liveBox);
  }

  page.close();
  browser.close();
} catch (err) {
  console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
  failures++;
} finally {
  chrome.kill("SIGKILL");
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

console.log(
  `\n${failures === 0 ? "\x1b[32mEXTENSION VERIFIED\x1b[0m" : `\x1b[31m${failures} check(s) failed\x1b[0m`}`,
);
process.exit(failures === 0 ? 0 : 1);
