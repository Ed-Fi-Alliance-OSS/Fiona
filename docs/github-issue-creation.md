# Design: File a GitHub Issue from Slack

- **Status:** As-built (feature branch `feature/github-issue-creation`).
- **Deferred:** LLM-based intent detection for the conversational entry point —
  tracked in [AI-174](https://edfi.atlassian.net/browse/AI-174).

## Purpose

Let a Slack user file a bug report or feature request against a GitHub repo
without leaving Slack. Fiona opens a short modal, collects the details, and
creates (or, with the approval gate enabled, drafts for review) a GitHub issue
via the REST API — then DMs the requester the issue number and link.

## Entry points

| Entry point | Trigger | Context |
| --- | --- | --- |
| `/fiona bug` | Slash command | Opens the ticket modal pre-set to `bug` |
| `/fiona feature` | Slash command | Opens the ticket modal pre-set to `feature` |
| Conversational offer | Exact whole-message match on one of the phrases below, in a channel, DM, or thread | Posts a "Report a bug" / "Request a feature" button; clicking it opens the same modal |

The conversational offer only fires on an **exact, whole-message** match — a
message that merely contains one of these phrases as part of a longer sentence
does not trigger it. The recognized phrases are:

- `file a bug`
- `report a bug`
- `bug report`
- `request a feature`
- `feature request`
- `file a feature`

This is deliberately high-precision pattern matching rather than intent
detection, so Fiona never mis-fires the offer on an unrelated message. Smarter,
LLM-based detection of bug/feature intent (e.g. recognizing "the export button
is broken" without an exact phrase) is explicitly out of scope for v1 and is
tracked as a follow-up in **[AI-174](https://edfi.atlassian.net/browse/AI-174)**.

Both entry points funnel into the same modal (`buildTicketModal` in
`apps/fiona-slack/src/listeners/views/ticket_modal.js`) and the same core
(`submitTicket` in `apps/fiona-slack/src/agent/ticket-service.js`), so slash
and conversational paths stay in lockstep.

## Modal fields

- **Summary** (core, required) — becomes the GitHub issue title.
- **Description** (core, required) — becomes the top of the issue body.
- **Priority** — included in the issue body as `**Priority: <name>**`.
- **Bug-specific fields** (only shown when `ticketType` is `bug`):
  - Steps to reproduce
  - Expected vs. actual behavior
  - Environment / version
- **Reporter contact** — not a form field. Fiona automatically resolves the
  requester's name and email (see [Privacy note](#privacy-note) below) and
  appends it to the issue body; the user does not type or confirm this.

## Type → label mapping

| Ticket type | GitHub label (default) | Env override |
| --- | --- | --- |
| `bug` | `bug` | `GITHUB_BUG_LABEL` |
| `feature` | `enhancement` | `GITHUB_FEATURE_LABEL` |

## Behavior of `submitTicket`

1. If GitHub is not configured (see [Configuration](#configuration)),
   returns `{ ok: false, mode: 'not_configured', errorType: 'github_not_configured' }`
   and the slash/conversational handlers respond with "Issue creation is not
   available right now" — **the modal is never opened** in this case.
2. If the approval gate is enabled (`isApprovalRequired()` — see below), posts
   a draft with **Approve & create** / **Discard** buttons to the triage
   channel instead of creating the issue immediately.
3. Otherwise, creates the issue directly via the GitHub REST API
   (`createIssue` in `apps/fiona-slack/src/agent/github-client.js`), using a
   Bearer PAT, and DMs the requester the resulting issue number and link.
4. Every attempt is recorded via `recordInteraction`
   (`interactionType: 'ticket_create'`, `status: 'success'` or `'error'`) —
   the PAT and any auth headers are never logged, only the HTTP status and
   message.

## Approval gate

Set both `TICKET_APPROVAL_REQUIRED=true` and `TICKET_TRIAGE_CHANNEL_ID` to
require human review before an issue is created:

1. Instead of creating the issue, Fiona posts a draft (summary, priority,
   description) with **Approve & create** and **Discard** buttons to
   `TICKET_TRIAGE_CHANNEL_ID`.
2. **Approve & create** creates the GitHub issue and DMs the original
   requester the issue number/link.
3. **Discard** creates nothing.

Both buttons are gated behind `TICKET_APPROVAL_REQUIRED=true` **and** a
non-empty `TICKET_TRIAGE_CHANNEL_ID` — if either is missing, the gate is
treated as disabled and issues are created immediately.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GITHUB_REPO` | (unset — required) | The single fixed target repo, `owner/repo` form (e.g. `Ed-Fi-Alliance-OSS/Fiona`). |
| `GITHUB_TOKEN` | (unset — required) | A fine-grained GitHub PAT with **Issues: write** permission on `GITHUB_REPO`. Never logged. |
| `GITHUB_API_URL` | `https://api.github.com` | Override for GitHub Enterprise Server. |
| `GITHUB_BUG_LABEL` | `bug` | Label applied to bug-type issues. **Must already exist in the repo** — GitHub's create-issue API rejects unknown labels, which Fiona surfaces as a friendly "could not create your issue" DM (recorded as `github_create_failed`). |
| `GITHUB_FEATURE_LABEL` | `enhancement` | Label applied to feature-type issues. Same pre-existence requirement as above. |
| `TICKET_APPROVAL_REQUIRED` | `false` | When `true` (and `TICKET_TRIAGE_CHANNEL_ID` is set), gates issue creation behind human approval. |
| `TICKET_TRIAGE_CHANNEL_ID` | (unset) | Channel **ID** (e.g. `C0123456789`) where approval drafts are posted. The bot must be a member of that channel to post. |

Feature is disabled — and the modal never opens — until both `GITHUB_REPO`
and `GITHUB_TOKEN` are set (`isGithubConfigured()` /
`isTicketingEnabled()`).

### Open items to confirm before enabling in production

- **Repo owner/repo**: `GITHUB_REPO` targets exactly one fixed repository —
  confirm it's the intended one before setting it in any environment.
- **PAT scope**: use a fine-grained PAT restricted to `GITHUB_REPO` with only
  **Issues: write** permission — do not use a classic PAT with broader repo
  access.
- **Labels must pre-exist**: `bug` and `enhancement` (or whatever
  `GITHUB_BUG_LABEL` / `GITHUB_FEATURE_LABEL` are overridden to) must already
  exist as labels in the target repo. Fiona does not create labels.

## Privacy note

> **The requester's Slack display name and email address are written directly
> into the GitHub issue body** (`buildBody` in
> `apps/fiona-slack/src/agent/ticket-service.js`, `**Reported by:** <name>
> <email> (via Slack)`). Fiona resolves this from the `slack-users` Cosmos DB
> container, falling back to a live `users.info` Slack API call when the
> Cosmos lookup misses.
>
> **If `GITHUB_REPO` is a public repository, this name and email are
> world-readable** to anyone who can view the issue — including search
> engines and any tooling that mirrors public GitHub issues. Before pointing
> this feature at a public repo, confirm that exposing requester contact
> information in issue bodies is acceptable, or route ticket creation to a
> private repo instead.

## Slack scopes

Two Slack bot token scopes are required beyond what Fiona already uses for
chat: `users:read` and `users:read.email`, needed for the `users.info`
reporter-contact fallback described above. `commands` is required for the
`/fiona` slash command itself. No GitHub-specific Slack scope is needed —
GitHub authentication is the PAT (`GITHUB_TOKEN`), not a Slack OAuth scope.

## Deferred

- **LLM-based intent detection** for the conversational entry point (e.g.
  recognizing bug/feature intent without an exact trigger phrase) —
  [AI-174](https://edfi.atlassian.net/browse/AI-174).

## References

- Implementation: `apps/fiona-slack/src/agent/ticket-service.js`,
  `apps/fiona-slack/src/agent/github-client.js`,
  `apps/fiona-slack/src/listeners/commands/fiona.js`,
  `apps/fiona-slack/src/listeners/commands/command-handler.js`,
  `apps/fiona-slack/src/listeners/views/ticket_modal.js`,
  `apps/fiona-slack/src/listeners/actions/ticket_approval.js`.
- Env var reference: `apps/fiona-slack/.env.sample`.
- Living product context: `docs/fiona-skills-prd.md`.
