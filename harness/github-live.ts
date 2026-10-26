/** Read-only live API verification. GITHUB_TOKEN is optional; never persisted. */
import { mkdirSync, writeFileSync } from "node:fs";
import { fetchGitHubInbox } from "@homepage/agent-core";
import { OUT_DIR } from "./node-bridge";

const inbox = await fetchGitHubInbox({ owner: process.env.GITHUB_OWNER ?? "tmustier", token: process.env.GITHUB_TOKEN });
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/github-snapshot.json`, JSON.stringify(inbox, null, 2));
console.log(JSON.stringify({ checkedAt: inbox.checkedAt, items: inbox.items.length, prs: inbox.items.filter(i => i.kind === "PR").length, bots: inbox.items.filter(i => i.author.endsWith("[bot]")).length, detailedPRs: inbox.items.filter(i => i.pr).length, detailFailures: inbox.items.filter(i => i.detailError).length, warnings: inbox.warnings, contextBytes: JSON.stringify(inbox).length }, null, 2));
if (inbox.warnings.length) process.exitCode = 1;
