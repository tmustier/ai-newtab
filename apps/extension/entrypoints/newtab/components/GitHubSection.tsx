import { useState } from "react";
import type { GitHubInboxState, GitHubSummary } from "@homepage/agent-core";
import "./github-section.css";

const GROUPS = [
  ["needs-you", "Needs you"], ["waiting", "Waiting on others"], ["no-action", "No action now"], ["all", "All open"],
] as const;

export function GitHubSection({ owner, data }: { owner: string; data?: GitHubInboxState }) {
  const [group, setGroup] = useState<GitHubSummary["bucket"] | "all">("needs-you");
  if (!owner.trim()) return null;
  const inbox = data?.inbox?.owner === owner.trim() ? data.inbox : undefined;
  const summaries = new Map(data?.summaries.map(s => [s.url, s]) ?? []);
  const items = inbox?.items ?? [];
  const bucket = (url: string) => summaries.get(url)?.bucket ?? "needs-you";
  const visible = items.filter(i => group === "all" || bucket(i.url) === group);
  // New/updated items first within each group; retain the source's updated-desc order.
  visible.sort((a, b) => Number(b.change !== "unchanged") - Number(a.change !== "unchanged"));
  const changed = items.filter(i => i.change !== "unchanged").length;

  return <section className="github-section" aria-labelledby="github-title">
    <header className="github-header">
      <div><p className="github-eyebrow">Your projects / {owner}</p><h2 id="github-title">GitHub inbox <span>{items.length} open</span></h2></div>
      <div className="github-freshness">{inbox ? <>Checked <time dateTime={inbox.checkedAt}>{new Date(inbox.checkedAt).toLocaleString()}</time><br />{changed} new or updated since the previous check</> : "Not checked yet. Rebuild to load your inbox."}</div>
    </header>
    {data?.error && <p className="github-warning" role="alert">Refresh failed: {data.error} {inbox ? "Showing the last successful snapshot, not current data." : "No inbox data available."}</p>}
    {inbox?.warnings.map(w => <p className="github-warning" key={w}>{w}</p>)}
    {inbox && <>
      <nav className="github-groups" aria-label="GitHub inbox filters">{GROUPS.map(([value, label]) => <button key={value} type="button" aria-pressed={group === value} onClick={() => setGroup(value)}>{label} <span>{value === "all" ? items.length : items.filter(i => bucket(i.url) === value).length}</span></button>)}</nav>
      <div className="github-items">
        {!visible.length && <p className="github-empty">{items.length ? "Nothing in this group. Other open items are still available in All open." : "No open issues or PRs from others on your public repositories."}</p>}
        {visible.map(item => {
          const summary = summaries.get(item.url);
          return <article className="github-item" key={item.url}>
            <div className="github-item-meta"><span>{item.kind} · {item.repo} #{item.number}</span><span>{item.author}{item.author.endsWith("[bot]") ? " · bot" : ""}{item.change !== "unchanged" && <span className="github-change" title="Compared with the previous successful GitHub refresh; the first refresh marks every item newly tracked.">{item.change === "new" ? "Newly tracked" : "Updated"}</span>}</span></div>
            <h3><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></h3>
            <p>{summary?.summary ?? "AI summary unavailable. Open the item or inspect the source below to triage it."}</p>
            <p className="github-action">Next: {summary?.action ?? "Manual triage needed; this item has not been classified."}</p>
            {item.pr && <p className="github-checks">{item.pr.draft ? "Draft · " : ""}Checks: {item.pr.checks} · Mergeability: {item.pr.mergeable === null ? "unknown" : item.pr.mergeable ? "no conflicts reported" : "conflicts reported"}</p>}
            {item.detailError && <p className="github-warning">Discussion/checks incomplete: {item.detailError}</p>}
            <details><summary>Source and recent discussion</summary><p className="github-source">{item.body || "No description provided."}</p>{item.comments.map((c, n) => <p className="github-source" key={n}>{c.author}: {c.body}</p>)}{item.pr?.reviews.map((r, n) => <p className="github-source" key={`r${n}`}>{r.author} ({r.state}): {r.body}</p>)}</details>
          </article>;
        })}
      </div>
      <p className="github-note">Open items stay here until closed on GitHub. Includes Dependabot, excludes your own submissions. AI suggestions use shortened descriptions and recent discussion, not a full code review.</p>
    </>}
  </section>;
}
