# GitHub inbox verification

Last verified: 2026-10-26

## Status

Implementation, supporting checks and the live AI build pass. The extension is
installed at its existing unpacked path, with its settings and API key preserved.
The user approved installation and the live build after the initial harness run.

The installed reader hit GitHub's anonymous rate limit. Every incoming item was
still listed and summarised, but 23 items had incomplete discussion/check context.
Those items were kept in manual triage with an explicit warning. Adding a public
read-only GitHub token in Settings is still recommended.

## Tested revision

Runtime code revision: `6735d034e41ba83b8479bad8506a4915c2308724`.
Installed revision: `7a24551`, which adds the initial verification report without
changing runtime code. Upstream base: `dfb8192`, including the daily morning
rebuild schedule.

The final code revision passed:

- `pnpm typecheck`
- `pnpm test`, with 40 passing tests and no failures
- `pnpm build`
- `pnpm extension:test`, using Chrome 155 in a disposable headless profile

The extension checks cover actual new-tab rendering, the existing homepage iframe,
filters, Dependabot, missing summaries, stale warnings, account changes across
storage events, settings, and preserving evidence after a missing-key resume.
The API key and token used in UI fixtures are explicitly fake. Those checks make
no model calls and do not establish summary quality.

## Live GitHub verification

The production reader was run with `GITHUB_OWNER=tmustier` and a token supplied
privately through the runtime. The token was not written to the repository,
artifacts or extension profile.

At 12:01 UTC, the reader returned 43 open incoming items, including 24 PRs and
13 bot submissions. All 24 PRs had discussion/check details, with no detail
failures or warnings. A separate `gh api search/issues` query returned the exact
same set of 43 canonical URLs.

The resulting public-data snapshot is in the ignored
`harness/out/github-snapshot.json` file.

## Visual verification

The actual compiled extension was reviewed at 1440 by 900 and 1024 by 768 pixels.
Screenshots confirmed that the section, source details, filters and settings
render. The usual homepage remains below the inbox. The error banner no longer
covers the section title. There was no horizontal overflow or broken image, and
keyboard focus styles were present.

Screenshots use explicit UI fixtures, not claimed model output. They are saved in
the ignored `harness/out/` directory as `github-desktop.png`,
`github-section.png`, `github-laptop.png` and `github-settings.png`.

## Live model verification

The initial standalone harness attempt stopped because `ANTHROPIC_API_KEY` was
unavailable. After installation approval, the real build was run in the installed
extension using its existing key. No key was exported or copied to the harness.
A temporary extension-local script and Chrome Apple Events controlled the test
in an unfocused window. No debugger was attached to everyday Chrome.

The provider's agent API independently returned:

- provider: Anthropic Managed Agents
- model: `claude-sonnet-5-5`
- effort: high
- speed: standard

The prompt was the normal homepage kickoff plus `githubInstructions(inbox)` in
`packages/agent-core/github-inbox.ts`. It asks the agent to keep the normal
homepage and use its actual `write` tool to produce `github-inbox.json` with an
explanation, next action and status for every incoming item.

The real model called the history and browser-page tools. Eight pages were
mounted, followed by eight sandbox `read` calls, three `write` calls and four
`edit` calls in the retained trace. The build completed at 13:20:48 UTC and saved
a new homepage and 41 validated summaries for 41 incoming items, including 13 bot
submissions. There were 40 items needing the owner and one waiting on others.

Independent assertions confirmed that input and summary URLs matched exactly,
with no duplicates or omissions. All 23 items with incomplete evidence were kept
in manual triage. A separate GitHub API query matched all 41 incoming URLs.
Selected explanations and actions were checked against source descriptions,
discussion and CI, including Windows support and dependency updates. The
suggestions distinguished observed check state from unverified exposure or
mergeability.

Opening another real new tab showed the same 41 items and summaries, with the
usual homepage below the inbox. The generated homepage passed `pnpm agent:verify`:
it transformed, exported the component, rendered to HTML and contained 81 distinct
external links with no placeholders. Its persisted output and GitHub summaries
were also rendered in the disposable Chrome profile using the optional
`LIVE_HOMEPAGE_PATH` and `LIVE_GITHUB_PATH` inputs to `pnpm extension:test`.
The resulting viewport and section screenshots were reviewed. Actual homepage
content remains local in ignored artifacts and is not published in this fork.

The provider returned 404 when the completed session was independently queried,
confirming session deletion. A real interrupted-model resume and a complete
production-browser run with an authenticated GitHub token remain untested.
The authenticated reader itself passed the earlier live API verification.

## Cleanup

The disposable browser was stopped and its temporary profile removed by the
harness. The temporary extension verification script and the owned inspection
window were removed after testing. No contribution was sent to Thariq's
repository. The changes are pushed to the user's GitHub fork at
<https://github.com/tmustier/ai-newtab>.

The normal local checkout now tracks the fork as `origin`; Thariq's repository
is retained as `upstream`.
