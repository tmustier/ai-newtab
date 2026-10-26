import { useEffect, useState } from "react";
import { MODEL_CHOICES, normalizeBlockList, type HomepageModel } from "@homepage/agent-core";
import { btn } from "./ui";

export function SettingsModal({
  initialPrompt,
  githubOwner,
  githubToken,
  blockedSites,
  model,
  onChangeModel,
  autoRebuild,
  onToggleAutoRebuild,
  onClose,
  onSave,
}: {
  initialPrompt: string;
  githubOwner: string;
  githubToken: string;
  blockedSites: string[];
  model: HomepageModel;
  onChangeModel: (next: HomepageModel) => void;
  autoRebuild: boolean;
  onToggleAutoRebuild: (next: boolean) => void;
  onClose: () => void;
  onSave: (prompt: string, blockedSites: string[], githubOwner: string, githubToken: string) => void;
}) {
  const [draft, setDraft] = useState(initialPrompt);
  const [ownerDraft, setOwnerDraft] = useState(githubOwner);
  const [tokenDraft, setTokenDraft] = useState(githubToken);
  useEffect(() => { setOwnerDraft(githubOwner); setTokenDraft(githubToken); }, [githubOwner, githubToken]);
  const [blockedDraft, setBlockedDraft] = useState(blockedSites.join("\n"));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ backgroundColor: "white", borderRadius: 8, padding: 24, width: "90%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto" }}>
        <h2 style={{ marginTop: 0, color: "#333" }}>Customize your homepage</h2>
        <p style={{ color: "#666" }}>Standing instructions applied to every build.</p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. 'Focus on tech news and Rust releases', 'Always surface unread GitHub PRs first'"
          style={{
            width: "100%",
            minHeight: 200,
            padding: 12,
            fontSize: 14,
            borderRadius: 4,
            border: "1px solid #ddd",
            fontFamily: "inherit",
          }}
        />
        <fieldset style={{ margin: "16px 0", border: "1px solid #ddd", borderRadius: 6, padding: 12 }}>
          <legend>GitHub projects</legend>
          <label style={{ display: "block" }}>GitHub username
            <input aria-label="GitHub username" value={ownerDraft} onChange={e => setOwnerDraft(e.target.value)} placeholder="Leave blank to disable" style={{ width: "100%", boxSizing: "border-box", margin: "6px 0 12px", padding: 8 }} />
          </label>
          <label style={{ display: "block" }}>GitHub token (optional)
            <input aria-label="GitHub token (optional)" type="password" autoComplete="off" value={tokenDraft} onChange={e => setTokenDraft(e.target.value)} style={{ width: "100%", boxSizing: "border-box", marginTop: 6, padding: 8 }} />
          </label>
          <p style={{ fontSize: 12, color: "#666", lineHeight: 1.5 }}>Includes incoming issues and PRs on public repositories, including Dependabot. A read-only token avoids GitHub\'s low anonymous rate limit. Public read access is enough; do not grant write access. Stored only in this browser, never sent to the AI. Public issue text and discussion are sent to your selected model for summaries. Leave the username blank to disable.</p>
        </fieldset>
        <label style={{ display: "block", marginTop: 16, color: "#333", fontSize: 14 }}>
          Sites the agent never reads
          <textarea
            value={blockedDraft}
            onChange={(e) => setBlockedDraft(e.target.value)}
            aria-describedby="blocked-sites-help"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 120, marginTop: 8, padding: 12, fontSize: 14, borderRadius: 4, border: "1px solid #ddd", fontFamily: "inherit" }}
          />
        </label>
        <p id="blocked-sites-help" style={{ color: "#888", fontSize: 12, margin: "6px 0 0" }}>
          One per line. Subdomains are included. Use *.example.com for wildcards.
        </p>
        <label
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, color: "#333", fontSize: 14 }}
        >
          Model
          <select
            value={model}
            onChange={(e) => onChangeModel(e.target.value as HomepageModel)}
            style={{ padding: "4px 8px", fontSize: 14, borderRadius: 4, border: "1px solid #ddd" }}
          >
            {MODEL_CHOICES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 16,
            color: "#333",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={autoRebuild}
            onChange={(e) => onToggleAutoRebuild(e.target.checked)}
          />
          Rebuild automatically each morning
        </label>
        <p style={{ color: "#888", fontSize: 12, margin: "6px 0 0" }}>
          When on, the extension builds one morning edition a day in the background (first time
          Chrome is open between 5am and noon), so your next tab shows a fresh one (uses your API key).
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 20, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{ ...btn, backgroundColor: "white", color: "#333", border: "1px solid #ddd" }}
          >
            Cancel
          </button>
          <button disabled={Boolean(ownerDraft.trim()) && !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(ownerDraft.trim())} onClick={() => onSave(draft, normalizeBlockList(blockedDraft.split("\n")), ownerDraft.trim(), tokenDraft.trim())} style={btn}>
            Save &amp; rebuild
          </button>
        </div>
      </div>
    </div>
  );
}
