import { describe, expect, test } from "bun:test";
import { fetchGitHubInbox, githubInstructions, parseGitHubSummaries, reconcileGitHubInbox, type GitHubInbox } from "../packages/agent-core/github-inbox";

function issue(n: number, extra: object = {}) {
  return { html_url: `https://github.com/alice/project/issues/${n}`, repository_url: "https://api.github.com/repos/alice/project", number: n, title: `Issue ${n}`, user: { login: "contributor" }, body: "Something broke", updated_at: "2026-10-25T12:00:00Z", comments: 0, ...extra };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const mockFetch = (handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) => ((input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input)), init)) as typeof fetch;

describe("GitHub maintainer inbox", () => {
  test("includes bots, scopes to public incoming open items, paginates and diffs", async () => {
    const calls: URL[] = [];
    const first = issue(1, { user: { login: "dependabot[bot]" } });
    const prior: GitHubInbox = { owner: "alice", checkedAt: "2026-10-24", warnings: [], items: [{ url: first.html_url, repo: "alice/project", number: 1, kind: "Issue", title: first.title, author: "dependabot[bot]", body: "Something broke", updatedAt: first.updated_at, comments: [], change: "new" }] };
    const inbox = await fetchGitHubInbox({ owner: "alice", previous: prior, fetcher: mockFetch(url => {
      calls.push(url);
      return response({ total_count: 101, incomplete_results: false, items: url.searchParams.get("page") === "1" ? [first, ...Array.from({ length: 99 }, (_, n) => issue(n + 2))] : [issue(101)] });
    }) });
    expect(inbox.items).toHaveLength(101);
    expect(inbox.items[0].author).toBe("dependabot[bot]");
    expect(inbox.items[0].change).toBe("unchanged");
    expect(inbox.items[100].change).toBe("new");
    expect(calls).toHaveLength(2);
    expect(calls[0].searchParams.get("q")).toBe("user:alice is:public is:open -author:alice archived:false");
    const updated = await fetchGitHubInbox({ owner: "alice", previous: prior, fetcher: mockFetch(() => response({ total_count: 1, items: [issue(1, { updated_at: "2026-10-26T12:00:00Z" })] })) });
    expect(updated.items[0].change).toBe("updated");
    // Closed items disappear only after a successful fresh search.
    const empty = await fetchGitHubInbox({ owner: "alice", previous: prior, fetcher: mockFetch(() => response({ total_count: 0, items: [] })) });
    expect(empty.items).toEqual([]);
  });

  test("reads PR context, current checks, reviews and recent issue comments", async () => {
    const fetcher = mockFetch((url, init) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
      if (url.pathname === "/search/issues") return response({ total_count: 1, items: [issue(1, { pull_request: {}, comments: 1 })] });
      if (url.pathname.includes("/pulls/") && url.pathname.endsWith("/comments")) return response([]);
      if (url.pathname.endsWith("/comments")) return response([{ user: { login: "alice" }, body: "Please add a regression test", updated_at: "2026-10-26" }]);
      if (url.pathname.endsWith("/pulls/1")) return response({ draft: false, mergeable: null, head: { sha: "abc" } });
      if (url.pathname.endsWith("/reviews")) return response([{ user: { login: "alice" }, state: "CHANGES_REQUESTED", body: "Test needed", submitted_at: "2026-10-26" }]);
      if (url.pathname.endsWith("/check-runs")) return response({ total_count: 1, check_runs: [{ status: "completed", conclusion: "failure" }] });
      if (url.pathname.endsWith("/status")) return response({ state: "pending", total_count: 0 });
      throw new Error(`Unexpected ${url}`);
    });
    const inbox = await fetchGitHubInbox({ owner: "alice", token: "test-token", fetcher });
    expect(inbox.items[0].kind).toBe("PR");
    expect(inbox.items[0].pr?.checks).toBe("failing");
    expect(inbox.items[0].pr?.mergeable).toBeNull();
    expect(inbox.items[0].comments[0].body).toContain("regression test");
    expect(inbox.items[0].pr?.reviews[0].state).toBe("CHANGES_REQUESTED");
    expect(githubInstructions(inbox)).not.toContain("test-token");
    expect(githubInstructions(inbox)).toContain("untrusted GitHub content");
  });

  test("rate-limited details never drop open items or claim checks passed", async () => {
    let calls = 0;
    const inbox = await fetchGitHubInbox({ owner: "alice", fetcher: mockFetch(url => {
      calls++;
      return url.pathname === "/search/issues" ? response({ total_count: 2, items: [issue(1, { pull_request: {} }), issue(2)] }) : new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
    }) });
    expect(inbox.items).toHaveLength(2);
    expect(inbox.warnings.join(" ")).toContain("incomplete");
    expect(inbox.items.every(i => i.detailError)).toBe(true);
    expect(inbox.items[0].pr).toBeUndefined();
    expect(calls).toBe(2);
  });

  test("search failures and incomplete searches throw rather than create an empty inbox", async () => {
    await expect(fetchGitHubInbox({ owner: "alice", fetcher: mockFetch(() => response({}, 403)) })).rejects.toThrow("403");
    await expect(fetchGitHubInbox({ owner: "alice", fetcher: mockFetch(() => response({ incomplete_results: true, items: [] })) })).rejects.toThrow("incomplete");
    await expect(fetchGitHubInbox({ owner: "../not-a-user" })).rejects.toThrow("username");
  });

  test("retains the latest five comments across a page boundary", async () => {
    const comment = (n: number) => ({ user: { login: "alice" }, body: `Comment ${n}`, updated_at: `2026-${n}` });
    const inbox = await fetchGitHubInbox({ owner: "alice", fetcher: mockFetch(url => {
      if (url.pathname === "/search/issues") return response({ total_count: 1, items: [issue(1, { comments: 101 })] });
      return response(url.searchParams.get("page") === "2" ? [comment(101)] : Array.from({ length: 100 }, (_, n) => comment(n + 1)));
    }) });
    expect(inbox.items[0].comments.map(c => c.body)).toEqual([97, 98, 99, 100, 101].map(n => `Comment ${n}`));
  });

  test("isolates item failures and retains already fetched PR metadata", async () => {
    const inbox = await fetchGitHubInbox({ owner: "alice", fetcher: mockFetch(url => {
      if (url.pathname === "/search/issues") return response({ total_count: 2, items: [issue(1, { pull_request: {} }), issue(2, { comments: 1 })] });
      if (url.pathname.endsWith("/pulls/1")) return response({ draft: true, mergeable: false, head: { sha: "abc" } });
      if (url.pathname.endsWith("/reviews")) return response({}, 404);
      return response([{ user: { login: "alice" }, body: "This unrelated discussion still loads.", updated_at: "today" }]);
    }) });
    expect(inbox.items[0].pr?.draft).toBe(true);
    expect(inbox.items[0].detailError).toContain("404");
    expect(inbox.items[1].detailError).toBeUndefined();
    expect(inbox.items[1].comments[0].body).toContain("still loads");
    expect(parseGitHubSummaries(JSON.stringify([{ url: inbox.items[0].url, summary: "Draft PR.", action: "Wait.", bucket: "waiting" }]), inbox)[0].bucket).toBe("needs-you");
  });

  test("rejects search overflow rather than replacing the backlog with a partial snapshot", async () => {
    await expect(fetchGitHubInbox({ owner: "alice", fetcher: mockFetch(() => response({ total_count: 1001, items: Array.from({ length: 100 }, (_, n) => issue(n + 1)) })) })).rejects.toThrow("1,000-result limit");
  });

  test("keeps unchanged summaries through failed or partial AI output, never stale ones", async () => {
    const first = await fetchGitHubInbox({ owner: "alice", fetcher: mockFetch(() => response({ total_count: 2, items: [issue(1), issue(2)] })) });
    const rows = first.items.map(i => ({ url: i.url, summary: i.title, action: "Reply.", bucket: "needs-you" as const }));
    const previous = { inbox: first, summaries: rows };
    const same = structuredClone(first);
    same.items.forEach(i => { i.change = "unchanged"; });
    expect(reconcileGitHubInbox(same, previous).summaries).toEqual(rows);
    same.items[1].body = "New evidence invalidates the old action.";
    expect(reconcileGitHubInbox(same, previous).summaries).toEqual([rows[0]]);
    const replacement = { ...rows[1], action: "Investigate the new evidence." };
    expect(reconcileGitHubInbox(same, previous, [replacement]).summaries).toEqual([rows[0], replacement]);
  });

  test("bounds total AI input without dropping item identities", async () => {
    const inbox = await fetchGitHubInbox({ owner: "alice", fetcher: mockFetch(() => response({ total_count: 100, items: Array.from({ length: 100 }, (_, n) => issue(n + 1, { body: "x".repeat(6000) })) })) });
    expect(inbox.items).toHaveLength(100);
    expect(new TextEncoder().encode(JSON.stringify(inbox)).byteLength).toBeLessThanOrEqual(300_000);
    expect(inbox.warnings.join(" ")).toContain("shortened");
    expect(inbox.items.every(i => i.detailError)).toBe(true);
  });

  test("paginates checks and notices CI changes even without a new issue timestamp", async () => {
    let failing = false;
    const fetcher = mockFetch(url => {
      if (url.pathname === "/search/issues") return response({ total_count: 1, items: [issue(1, { pull_request: {} })] });
      if (url.pathname.endsWith("/pulls/1")) return response({ draft: false, mergeable: true, head: { sha: "abc" } });
      if (url.pathname.endsWith("/check-runs")) return response({ total_count: 101, check_runs: url.searchParams.get("page") === "1" ? Array.from({ length: 100 }, () => ({ status: "completed", conclusion: "success" })) : [{ status: "completed", conclusion: failing ? "failure" : "success" }] });
      if (url.pathname.endsWith("/status")) return response({ state: "pending", total_count: 0 });
      return response([]);
    });
    const previous = await fetchGitHubInbox({ owner: "alice", fetcher });
    expect(previous.items[0].pr?.checks).toBe("passing");
    failing = true;
    const next = await fetchGitHubInbox({ owner: "alice", previous, fetcher });
    expect(next.items[0].pr?.checks).toBe("failing");
    expect(next.items[0].change).toBe("updated");
  });

  test("only accepts valid model summaries for current canonical item URLs", async () => {
    const inbox = await fetchGitHubInbox({ owner: "alice", fetcher: mockFetch(() => response({ total_count: 1, items: [issue(1)] })) });
    const good = { url: inbox.items[0].url, summary: "An installation error.", action: "Ask for the version.", bucket: "needs-you" as const };
    const rows = parseGitHubSummaries(JSON.stringify([{ ...good, url: "javascript:alert(1)" }, { ...good, bucket: "made-up" }, { ...good, summary: "" }, good, good]), inbox);
    expect(rows).toEqual([good]);
    expect(() => parseGitHubSummaries("{}", inbox)).toThrow("array");
    expect(() => parseGitHubSummaries("not json", inbox)).toThrow();
  });
});
