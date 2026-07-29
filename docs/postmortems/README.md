# Post-mortem data store

This directory holds per-PR post-mortem records that feed the post-mortem
improvement loop. See `docs/agents/postmortem-agent.md` for the design.

## Where the data lives

- **Records** (`PR-<number>.json`) are committed to the **`postmortem-data`
  branch**, not `main`. The capture workflow
  (`.github/workflows/postmortem-capture.yml`) writes and commits them
  automatically when a PR is **merged**. Closed-but-unmerged PRs are skipped —
  they are often throwaway work whose signal would mislead synthesis.
- This directory on `main` holds only this README and `.gitkeep` markers so
  the path exists; the JSON records accumulate on `postmortem-data`.
- `processed/` holds records the synthesis step has already consumed, so they
  are not re-synthesized (kept forever).
- `digests/<date>.md` holds the de-identified, cumulative-aware summary each
  synthesis run writes.

## Record shape

See `buildPostmortemRecord` in `scripts/postmortem/capture.js` for the
authoritative schema. Each record carries PR stats (size, review cycles,
CI timing, CI-failure counts), `changeShape` (languages, test-to-source ratio,
docs-touched, deps-manifest-touched — derived from the file list, not patch
content), coarse signal (comment classes, follow-up commit kinds,
`reworkAfterReview`), and participants.

## Privacy

Records store participant **roles** (`author`, `human-reviewer`,
`copilot-bot`) and `authorAssociation` only — **never** human reviewer
logins. Review-comment text is stored only as class counts, never verbatim.
This follows the Foundation guidance to minimize personal data in tooling.
