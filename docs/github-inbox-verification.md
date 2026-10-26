# GitHub inbox verification

Last verified: 2026-10-26

## Status

Implementation and supporting checks pass. Live AI behaviour is not yet accepted.
The Anthropic API key used by the installed extension is not available to the
isolated harness. No everyday Chrome extension was replaced or reloaded.

## Tested revision

Code revision: `6735d034e41ba83b8479bad8506a4915c2308724`.
Upstream base: `dfb8192`, including the daily morning rebuild schedule.

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

## Model verification still needed

Intended provider: Anthropic Managed Agents.
Default configured model: `claude-sonnet-5-5`; the extension keeps the user's
selected model. The code does not set a thinking level.

The prompt is the existing homepage kickoff plus `githubInstructions(inbox)` in
`packages/agent-core/github-inbox.ts`. It asks the agent to keep the normal
homepage and use its actual `write` tool to produce `github-inbox.json` with an
explanation, next action and status for every incoming item.

`GITHUB_OWNER=tmustier pnpm agent:run` stopped before making a model request
because `ANTHROPIC_API_KEY` was unavailable. No actual model tool execution was
observed. The mocked orchestrator test verifies prompt delivery, history-tool
dispatch, JSON collection, URL validation and collection before session cleanup,
but it does not replace a live model run.

To complete acceptance, run the harness with the real key supplied privately, or
run an approved rebuild in the installed extension. Verify every input URL has a
valid summary, inspect the suggested actions against source discussion and CI,
and confirm persistence after opening another tab. The real model resume path,
summary quality and production-browser installation remain untested.

## Cleanup

The disposable browser was stopped and its temporary profile removed by the
harness. The Surf inspection window was closed. No repository contribution was
sent upstream, and the branch has not been pushed.
