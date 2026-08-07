# Design: File a GitHub Issue from Slack

- **Status:** As-built (feature branch `feature/github-issue-creation`).
- **Deferred:** LLM-based intent detection for the conversational entry point —
  tracked in [AI-174](https://edfi.atlassian.net/browse/AI-174).

## Purpose

Let a Slack user file a bug report, feature request or question against a GitHub
repo without leaving Slack. Fiona opens a short modal, collects the details, and
creates (or, with the approval gate enabled, drafts for review) a GitHub issue
via the GraphQL API — then DMs the requester the issue number and link.

## Entry points

There is **one** ticket command. `bug` and `feature` survive as aliases that
preselect a type in the same form; they are deliberately
**discoverable-but-hidden** — `/fiona help` advertises only `ticket`, so help
offers one way to do this while anyone who already types `bug` keeps working.

| Entry point | Trigger | Context |
| --- | --- | --- |
| `/fiona ticket` | Slash command | Opens the ticket modal with **Feature** preselected |
| `/fiona bug`, `/fiona feature` | Slash command aliases (unadvertised) | The same modal, preselected to `bug` / `feature` |
| Conversational offer | Exact whole-message match on one of the phrases below, in a channel, DM, or thread | Posts a **Submit a support ticket** button; clicking it opens the same modal |

`/fiona ticket` preselects **Feature**, not the neutral Question option and not
`bug`. That is a deliberate product decision taken on 2026-08-05; the telemetry
signal that would overturn it is a stream of `modal_feature` submissions arriving
with a `slash_ticket` source, meaning users who typed the generic word are
accepting a type they did not choose.

Telemetry records the word the user typed, not the resolved type —
`slash_ticket`, `slash_bug`, `slash_feature` are distinct interaction types, so
whether anyone still uses the aliases is an evidence question rather than a guess.

The conversational offer only fires on an **exact, whole-message** match — a
message that merely contains one of these phrases as part of a longer sentence
does not trigger it. The recognized phrases, and the type each preselects:

| Phrase | Preselects |
| --- | --- |
| `ticket` | `feature` |
| `bug` | `bug` |
| `feature` | `feature` |
| `file a bug`, `report a bug`, `bug report` | `bug` |
| `request a feature`, `feature request`, `file a feature` | `feature` |

`ticket` resolves to `feature` here for the same reason `/fiona ticket` does —
two entry points for one word must not disagree. A leading slash and a `fiona `
prefix are both tolerated, so `/bug` and `fiona ticket` work too.

**No phrase reaches the `question` type.** It is reachable only from the modal's
Type dropdown, by decision: giving it a command word would mean advertising a
word for a case people reach for when they cannot classify their own report.

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

- **Type** (required, first block) — a `static_select` offering **Bug**,
  **Feature** and **Question / not sure**. Changing it rebuilds the form in place;
  see [Switching type](#switching-type) below.
- **Summary** (core, required) — becomes the GitHub issue title.
- **Description** (core, required) — becomes the top of the issue body.
- **Priority** — written to the org-level **`Priority`** single-select issue field,
  not the issue body. The modal's `PRIORITY_OPTIONS` (`Urgent`, `High`, `Medium`,
  `Low`) must match that field's option names **exactly**, because the selected value
  is resolved to an option node ID by name; any drift fails issue creation outright.
  Unlike `Slack User`, this field's visibility is `ALL` — it is publicly readable.
- **Bug-specific fields** (only shown when `ticketType` is `bug`):
  - Steps to reproduce
  - Expected vs. actual behavior
  - Environment / version
- **Reporter** — not a form field. Fiona resolves the requester's Slack display
  name and writes `<name> [<slack user id>]` to the org-level **`Slack User`**
  issue field (see [Privacy note](#privacy-note) below). Nothing identifying the
  reporter goes into the issue body; the user does not type or confirm this.

## Switching type

The Type select sits in an `input` block with `dispatch_action: true`. That makes
it do two jobs: it contributes to `view.state.values` on submit **and** emits a
`block_actions` event when changed. Verified live in Slack on 2026-08-05 — an
earlier design that moved the select into an `actions` block and shadowed the type
in `private_metadata` was therefore never needed and is not built.

`ticketTypeActionCallback`
(`apps/fiona-slack/src/listeners/actions/ticket_type.js`) acks that event and
calls `views.update` with a rebuilt view, keyed on the view's `id` and `hash`.

- **Summary, Description and Priority are carried forward explicitly.** Slack
  preserves input values across `views.update` only for *identical* input blocks,
  and ours are not identical — the placeholders change with the type. Priority in
  particular used to be hard-coded to `Medium` on every build, so a rebuild would
  silently discard a chosen priority.
- **Bug-specific field content is lost** when switching away from Bug and is not
  restored on switching back. Accepted deliberately rather than stashed.
- **A failed update is logged and otherwise ignored.** The user keeps the previous
  field set, and submit still reads the type from live view state, so the worst
  outcome is an issue filed with three empty optional fields.
- **Not rate-limited, and not re-checked against `isTicketingEnabled()`.** A type
  toggle is a Slack-side interaction with no GitHub cost, and a view that exists
  proves the config guard already passed; re-checking would let a config change
  mid-form blank the user's typing.

### The submitted type comes from view state, not `private_metadata`

`private_metadata` carries only `{ channelId, threadTs }`. The ticket type is read
from the validated Type dropdown in live view state (`readTicketType`), which runs
it through `normalizeTicketType` — view state is client-supplied too, so it is
normalized rather than trusted. A ticket type smuggled into `private_metadata`
cannot change the type of the filed issue.

## Ticket type → GitHub issue type

Issues carry a **native GitHub issue type**, not a label. Labels are no longer
applied by Fiona at all — `issueTypeId` replaced `labelIds` on the mutation.

| Ticket type | GitHub issue type (default) | Env override |
| --- | --- | --- |
| `bug` | `Bug` | `GH_ISSUE_BUG_TYPE_NAME` |
| `feature` | `Feature` | `GH_ISSUE_FEATURE_TYPE_NAME` |
| `question` | **none — filed with no type at all** | n/a |

`resolveIssueTypeName` returns `undefined` for `question`, and `createIssue` omits
`issueTypeId` entirely for a falsy name, so the issue is created untyped and a
triager classifies it later. An **unrecognised** value also returns `undefined`
rather than falling through to `Feature`: `normalizeTicketType` should mean nothing
unrecognised ever arrives, and untyped is the better failure mode — a triager can
see an untyped issue, whereas a mistyped one looks finished and never gets
revisited.

> Issue types are defined at **organization** level and resolved by name from
> `repository.issueTypes`. The type must already exist — Fiona does not create types.
> Note that issues filed through the repo's web form (`.github/ISSUE_TEMPLATE/`) may
> still apply labels; anything filtering on the `bug` / `enhancement` labels will not
> see Fiona-filed issues.

## Behavior of `submitTicket`

1. If GitHub is not configured (see [Configuration](#configuration)),
   returns `{ ok: false, mode: 'not_configured', errorType: 'github_not_configured' }`
   and the slash/conversational handlers respond with "Issue creation is not
   available right now. Please submit your request at community.ed-fi.org" —
   **the modal is never opened** in this case. That copy
   (`TICKET_NOT_CONFIGURED_TEXT`) carries the site as a Slack `<url|label>` link
   and is only ever passed as a message `text` field; it would render literally
   inside a modal `plain_text` block.
2. If the approval gate is enabled (`isApprovalRequired()` — see below), posts
   a draft with **Approve & create** / **Discard** buttons to the triage
   channel instead of creating the issue immediately.
3. Otherwise, creates the issue directly via the GitHub **GraphQL** API
   (`createIssue` in `apps/fiona-slack/src/agent/github-client.js`), using a
   Bearer PAT, and DMs the requester the resulting issue number and link. This
   is two round trips: one query to resolve the repository, issue-type and
   issue-field **node IDs** (GraphQL takes IDs, not names), then the `createIssue`
   mutation carrying `issueTypeId` plus the `Slack User` and `Priority` values in
   `issueFields`.

   The issue field is looked up by name in `repository.issueFields`, which lists
   only the fields the token can actually read. A field that exists at org level
   but is invisible to the PAT therefore fails with a message naming the field,
   rather than GitHub's opaque `Could not resolve to a node with the global id`.
4. Every attempt is recorded via `recordInteraction`
   (`interactionType: 'ticket_create'`, `status: 'success'` or `'error'`) —
   the PAT and any auth headers are never logged, only the status and message.

> **GraphQL failures arrive as HTTP 200 with an `errors` array**, not as a 4xx.
> `graphql()` inspects `response.data.errors` and maps `FORBIDDEN`,
> `UNAUTHORIZED` and `INSUFFICIENT_SCOPES` to `github_auth_failed`; everything
> else becomes `github_create_failed`. Skipping that check would report a failed
> creation to the user as a success.

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
| `GH_ISSUE_REPO` | (unset — required) | The single fixed target repo, `owner/repo` form (e.g. `Ed-Fi-Alliance-OSS/Fiona`). |
| `GH_ISSUE_TOKEN` | (unset — required) | A fine-grained GitHub PAT with **Issues: write** permission on `GH_ISSUE_REPO`. Never logged. |
| `GH_ISSUE_SLACK_USER_FIELD_NAME` | `Slack User` | **Name** (not node ID) of the org-level text issue field that records the reporter. Resolved to a node ID from the repository lookup on every create, so it survives the field being deleted and recreated. List the available fields with `GET /orgs/{org}/issue-fields`. |
| `GH_ISSUE_BUG_TYPE_NAME` | `Bug` | Native issue type applied to bugs. **Must already exist in the org** — an unknown type fails with a message naming it (recorded as `github_create_failed`). |
| `GH_ISSUE_FEATURE_TYPE_NAME` | `Feature` | Native issue type applied to feature requests. Same pre-existence requirement. |
| `GH_ISSUE_PRIORITY_FIELD_NAME` | `Priority` | **Name** of the org-level single-select field receiving the modal's priority. Its option names must match `PRIORITY_OPTIONS` in `ticket_modal.js` exactly. |
| `TICKET_APPROVAL_REQUIRED` | `false` | When `true` (and `TICKET_TRIAGE_CHANNEL_ID` is set), gates issue creation behind human approval. |
| `TICKET_TRIAGE_CHANNEL_ID` | (unset) | Channel **ID** (e.g. `C0123456789`) where approval drafts are posted. The bot must be a member of that channel to post. |

Feature is disabled — and the modal never opens — until both `GH_ISSUE_REPO`
and `GH_ISSUE_TOKEN` are set (`isGithubConfigured()` /
`isTicketingEnabled()`).

The GraphQL endpoint is **not configurable**. It is fixed at
`https://api.github.com/graphql` because Ed-Fi uses github.com; GitHub Enterprise Server
is not supported. A test asserts that `GITHUB_API_URL` is ignored, so reintroducing a
configurable host is a deliberate change rather than an accident.

### Open items to confirm before enabling in production

- **Repo owner/repo**: `GH_ISSUE_REPO` targets exactly one fixed repository —
  confirm it's the intended one before setting it in any environment.
- **PAT scope**: use a fine-grained PAT restricted to `GH_ISSUE_REPO` with only
  **Issues: write** permission — do not use a classic PAT with broader repo
  access.
- **PAT writing the `Slack User` field** — ✅ **verified working** against
  `Ed-Fi-Alliance-OSS/Automation-Testing` on 2026-07-31: a fine-grained PAT with
  **Issues: write** on the single target repo successfully set the org-level,
  `organization_members_only` field. No additional organization permission was
  needed. Note that the field value is set *inside* the `createIssue` mutation, so
  if a future org policy does reject the field write, the whole mutation fails and
  **no issue is created at all**; the fallback would be to create the issue first
  and set the field in a second `updateIssue`/`createIssueFieldValue` call.
- **Configure the field by NAME**, e.g. `Slack User` — not its node ID. Putting a
  node ID in `GH_ISSUE_SLACK_USER_FIELD_NAME` will fail the name lookup.
- **Issue types and fields must pre-exist**: the `Bug` and `Feature` issue types,
  and the `Slack User` and `Priority` issue fields, must already exist at
  organization level. Fiona creates none of them, and each is resolved by name —
  a rename in GitHub org settings breaks issue creation until the corresponding
  env var is updated. The `question` type needs nothing configured, because it
  files with no native issue type at all.
- **Priority options must match the modal**: `PRIORITY_OPTIONS` in
  `ticket_modal.js` and the GitHub `Priority` field's options are two lists that
  must be kept in sync by hand. `tests/listeners/views/ticket-modal.test.js`
  pins the Slack side; nothing can pin the GitHub side.

## Privacy note

> **No reporter identity is written into the issue body.** `buildBody`
> (`apps/fiona-slack/src/agent/ticket-service.js`) emits only the description,
> priority, bug sections and a provenance line — the issue body is world-readable
> when the target repo is public, so it deliberately carries nothing about who
> filed the ticket.
>
> The reporter goes to the org-level **`Slack User`** issue field instead, as
> `<display name> [<slack user id>]` (`formatSlackUser`). That field's visibility
> is `organization_members_only`, so **the reporter is not exposed publicly even
> on a public repo** — only Ed-Fi organization members can read it.
>
> Fiona resolves the display name from the `slack-users` Cosmos DB container,
> falling back to a live `users.info` Slack call. When both fail the field records
> `Unknown [<slack user id>]` — the ID is still written, so an org member can
> always identify the reporter.
>
> **The requester's email address is no longer collected or stored anywhere.**

## Slack scopes

Beyond what Fiona already uses for chat, `users:read` is required for the
`users.info` display-name fallback described above, and `commands` for the
`/fiona` slash command itself.

`users:read.email` is **not** used by this feature any more (nothing here reads
email addresses), but it stays in `manifest.json` because
`scripts/load-slack-users.js` needs it to populate the `email` field in the
`slack-users` Cosmos container from `users.list` — see
[slack-users-cosmosdb.md](./slack-users-cosmosdb.md). Do not remove it.

> ⚠️ **Editing `manifest.json` does not grant scopes.** This file is not connected
> to the installed app — the scope must be present in the app's own configuration at
> api.slack.com and the app then **reinstalled** to the workspace.
>
> If `users:read` is declared here but not installed, `users.info` fails with
> `An API error occurred: missing_scope (needs scope: users:read)`,
> `resolveReporter` falls back to the raw ID, and the `Slack User` field records
> `Unknown [U…]`. **This is a Slack error, not a GitHub PAT problem** — `users:read`
> is a Slack scope name and has no GitHub equivalent. GitHub issue creation
> succeeding while the name is missing is the signature of exactly this failure.
>
> Workaround if a reinstall needs admin approval: populate the `slack-users` Cosmos
> container from an admin CSV export
> (`node scripts/load-slack-users.js --source=csv members.csv`), which needs no
> Slack scopes at all. `resolveReporter` checks Cosmos first, so `users.info` is
> never called for users already in the container. Note `--source=api` does **not**
> work around it — `users.list` needs `users:read` too.

No GitHub-specific Slack scope is needed — GitHub authentication is the PAT
(`GH_ISSUE_TOKEN`), not a Slack OAuth scope.

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
  `apps/fiona-slack/src/listeners/actions/ticket_type.js`,
  `apps/fiona-slack/src/listeners/actions/ticket_approval.js`.
- Env var reference: `apps/fiona-slack/.env.sample`.
- Living product context: `docs/fiona-skills-prd.md`.
