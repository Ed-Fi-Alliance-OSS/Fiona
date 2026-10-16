---
name: writing-fiona-weekly-email
description: Use when drafting or updating the weekly Fiona status email (community usage, product alignment, feature work and documentation progress) for stakeholders, or when the user pastes or points to a previous weekly report email and wants this week's version.
---

# Writing the Fiona weekly email

## Overview

The email is rebuilt **one section at a time, as an interview**: pull the data yourself, present a finished draft of one section in last week's format, list numbered points for the user to confirm, apply their answers, then move to the next section. Never ask the user for facts the repo, Cosmos, GitHub or Jira can answer. Ask only about judgment calls.

Skeleton and wording conventions: `template.md` in this directory.

## Interview loop (every section)

1. Gather the data (sources below) without asking.
2. Present the section as send-ready text in the template's shape, including week-over-week comparisons.
3. End with **numbered** "worth checking" items: interpretations you made, scope choices (with your recommendation), tickets whose state looks ambiguous.
4. Apply the answers, show only what changed, then offer the next section.

Order: Community usage → Product alignment → Feature work (Done / Documentation stats → pie chart → Upcoming) → assemble.

## Dates

- **Last week's email:** newest `apps/usage-report-function/reports/weekly-email-*.md`, unless the user pastes or names one. Its filename date is the **since date** for git, PR and Jira queries.
- **Usage window:** 7 whole UTC days ending at the run day's UTC midnight (run Fri 10-23 → 10-16 through 10-22), same as the Slack report. `previous` is the 7 days before.
- **Done this week (AI tickets):** status Done *and* not already listed as Done in last week's email.

## Sources

Commands below run from the repo root unless noted.

| Section | Source | How |
|---|---|---|
| Usage | Production Cosmos | From `apps/usage-report-function`: `COSMOS_ENDPOINT='https://fiona-db-dev-cosmos.documents.azure.com:443/' node scripts/weekly-usage-data.js` (add `--now <ISO>` to rerun a past week). Writes `reports/weekly-usage-production-<start>-to-<end>.json` with `current`, `previous` (for WoW) and `feedbackDetails`. No PDF needed. |
| Product alignment | Merged work since last email | `git fetch origin && git log --oneline --since=<last email date> origin/main`; `gh pr list --state all --search "updated:>=<date>"`; read the diff of any PRD/doc PR (`git show <sha>`) before summarizing it. |
| Product alignment, Feature work | Jira project **AI** | `project = AI AND updated >= "<last email date>" ORDER BY updated DESC`, fields `summary,status,updated,labels`. |
| Documentation stats | Jira project **DOC** | `project = DOC AND labels = improve-fiona`, fields `summary,status,resolutiondate,parent`, maxResults 100. |

Jira: Atlassian MCP `searchJiraIssuesUsingJql`, cloudId `5f018ba4-e506-4058-aaf0-f8b5b887e125` (edfi.atlassian.net).

The account is named `-dev-` but holds production records; `deploymentType: 'production'` separates them. Auth is the user's existing `az login`. If it has expired, ask the user to run `! az login`. Never create credentials or new connections.

## Documentation stats and chart

The DOC search result is too large to return inline; the tool saves it to a file. Pass that file straight to the script (there is no `jq` on this machine):

```bash
node .claude/skills/writing-fiona-weekly-email/scripts/doc-status-pie.mjs <saved-result-file> apps/usage-report-function/reports <YYYY-MM-DD>
```

It prints the status × epic Markdown table (DOC-310 SME Cycle 1, DOC-326 GEO/AIO), lists the tickets it left out (no epic, or another project), and renders `improve-fiona-docs-pie-<date>.png` (1280×680, insert at ~640px) with headless Edge/Chrome. Do not use matplotlib (not installed) or pick new colors. The script uses a validated single-hue ordinal ramp. View the PNG before reporting it done. Present the table first, and render the chart only after the user confirms the counts and scope.

## Judgment calls to raise, not decide

- **Bulk-updated tickets.** Several tickets updated within seconds of each other usually means a sprint move. Ask whether they belong in Upcoming.
- **Internal usage spikes.** These may be team testing, not adoption. Offer a caveat.
- **Feedback volume.** If ratings per interaction drop sharply, flag it.
- **Sprint framing.** Mid-sprint or close? Confirm the sprint number.
- **Status wording for sensitive features** (e.g. ticket creation). Keep last week's wording unless the user changes it.

## Output

- Save `apps/usage-report-function/reports/weekly-email-<YYYY-MM-DD>.md` with an `[INSERT CHART: <png>, ~640px wide]` marker. `reports/` is gitignored on purpose. Emails and charts are not committed.
- Offer an HTML version for pasting into Outlook (Markdown tables don't paste).
- Remind the user to review before sending and to disclose AI assistance. Paraphrase feedback; never invent quotes from users or grantees; no user IDs or names.
