import { expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { runHomepageBuild, type BrowserBridge, type GitHubInbox, type KVStore } from "@homepage/agent-core";

const inbox: GitHubInbox = { owner: "alice", checkedAt: "2026-10-26T12:00:00Z", warnings: [], items: [{ url: "https://github.com/alice/project/issues/1", repo: "alice/project", number: 1, kind: "Issue", title: "Installation fails", author: "bob", body: "Cannot install", updatedAt: "2026-10-26", change: "new", comments: [] }] };

test("agent receives GitHub evidence and the host retrieves/validates summaries before cleanup", async () => {
  const sent: any[] = [];
  const downloads: string[] = [];
  let deleted = false;
  const summary = { url: inbox.items[0].url, summary: "Installation fails for a contributor.", action: "Ask for the error output.", bucket: "needs-you" as const };
  const client = { beta: {
    agents: { retrieve: async () => ({}), update: async () => ({}) },
    environments: { retrieve: async () => ({}) },
    sessions: {
      create: async () => ({ id: "session" }), retrieve: async () => ({ status: "idle" }), delete: async () => { deleted = true; },
      events: {
        stream: async function* () { yield { id: "history", type: "agent.custom_tool_use", name: "getHistory", input: {} }; yield { id: "idle", type: "session.status_idle", stop_reason: { type: "end_turn" } }; },
        list: async function* () {},
        send: async (_id: string, body: any) => { sent.push(...body.events); },
      },
    },
    files: {
      list: async function* () { yield { id: "json", filename: "github-inbox.json" }; yield { id: "tsx", filename: "homepage.tsx" }; },
      download: async (id: string) => {
        expect(deleted).toBe(false);
        downloads.push(id);
        return new Response(id === "json" ? JSON.stringify([summary, { ...summary, url: "https://example.com/invented" }]) : "export default function PersonalizedHomepage() {}");
      },
      delete: async () => {},
    },
  } } as unknown as Anthropic;
  const store: KVStore = { get: async <T>(key: string) => (key === "uploadedFileIds" ? [] : "cached") as T, set: async () => {}, remove: async () => {} };
  let calledHistory = false;
  const bridge: BrowserBridge = { getHistory: async () => { calledHistory = true; return { sites: [], totalSitesSeen: 0 }; }, getPageHtml: async () => ({ pages: [], failed: [] }) };
  const result = await runHomepageBuild({ client, store, bridge, githubInbox: inbox, userSystemPrompt: "Keep my existing news sections." });
  expect(calledHistory).toBe(true);
  const kickoff = sent.find(e => e.type === "user.message").content[0].text;
  expect(kickoff).toContain("Keep my existing news sections.");
  expect(kickoff).toContain("Installation fails");
  expect(kickoff).toContain("github-inbox.json");
  expect(kickoff).toContain("Do NOT duplicate it");
  expect(result.githubSummaries).toEqual([summary]);
  expect(result.code).toContain("PersonalizedHomepage");
  expect(downloads).toEqual(["tsx", "json"]);
  expect(deleted).toBe(true);
});
