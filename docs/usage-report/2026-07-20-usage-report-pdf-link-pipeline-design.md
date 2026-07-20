# Design: Executive PDF Link in the Weekly Slack Report

## Purpose

`WeeklyReportTrigger` posts a text-only KPI summary to Slack every Monday.
The narrative executive PDF (`lib/pdf/generate-executive-report-pdf.js` +
`lib/report-data.js#buildExecutiveReportData`) already exists, but by
explicit prior design decision
(`2026-07-10-usage-report-narrative-pdf-redesign-design.md`) it only ever
runs ad hoc via the agent — Puppeteer's bundled Chromium was judged unsafe
to run inside the deployed Consumption-plan Function.

This adds a link to that PDF in every Monday's Slack message, generated
automatically with no manual/agent step, without changing the Function's
hosting plan.

## Approaches Considered

1. **Move PDF generation into the deployed Function, upgrade its hosting
   plan** (Premium/Elastic Premium) to tolerate Puppeteer's Chromium
   footprint. Rejected: real infra/cost change, and it reverses the
   specific reason Chromium was kept out of the Function in the first
   place.
2. **Render a lighter, Chromium-free report** (plain HTML/text) for the
   automated link, keeping the rich Puppeteer-rendered PDF agent-only.
   Rejected: produces a materially worse artifact than the PDF that's
   already been designed and reviewed, just to avoid Chromium.
3. **Generate the PDF in a scheduled GitHub Actions workflow, host it in
   Blob Storage, link to it from the unchanged Function** *(chosen)*.
   GitHub's `ubuntu-latest` runners have no Consumption-plan-style
   Chromium constraint, so the existing PDF pipeline runs completely
   unmodified. The Function stays as the sole owner of "what gets posted to
   Slack" — no duplicated KPI-formatting logic in two places.

## Architecture

```
GitHub Actions (generate-usage-report-pdf.yml, cron a few hours before
REPORT_SCHEDULE, plus workflow_dispatch)
  → scripts/generate-executive-report-artifact.js computes the same
    [oneWeekAgo, endOfReport) window WeeklyReportTrigger uses, then calls
    buildExecutiveReportData + generateExecutiveReportPdf (unmodified)
  → az storage blob upload the PDF to fionausagereportsa / usage-reports,
    per-week blob name
  → az storage blob generate-sas (--as-user, AAD user delegation, no
    shared account key) for that blob
  → write/overwrite usage-reports/latest-link.json:
      { url, weekStart, weekEnd, deploymentType }

WeeklyReportTrigger (unchanged Consumption-plan Function, existing schedule)
  → computes KPIs (unchanged)
  → lib/report-link.js#getLatestReportLink reads latest-link.json via
    the Function's managed identity (Storage Blob Data Reader on the
    container)
  → if the pointer's weekEnd + deploymentType match this run's window
      → append a link line to the Slack message
    else
      → post KPI text only, log a warning
  → posts one Slack message (unchanged webhook call)
```

The PDF and KPI text intentionally describe the *same* Mon–Sun window — the
GitHub Actions cron runs shortly before `REPORT_SCHEDULE`, not a multi-day
buffer, specifically to keep both computing the same range. A same-window
mismatch (job didn't finish, failed, or drifted) is handled by simply
omitting the link that week, not by blocking or retrying the Slack post.

## New Files

- **`lib/report-link.js`** — `getLatestReportLink({ deploymentType,
  weekEnd }, logger)`. Reads the pointer via `@azure/storage-blob`; returns
  the URL only on a matching window, `null` otherwise. Never throws — any
  storage/parse failure or window mismatch degrades to `null` plus a
  `logger.warn(...)`, so a storage problem never blocks the KPI Slack post.
- **`scripts/generate-executive-report-artifact.js`** — the workflow's
  Node entry point. Computes the lookback window, calls
  `buildExecutiveReportData` + `generateExecutiveReportPdf` unmodified,
  writes the PDF plus a `report-meta.json` the workflow's later `az` CLI
  steps read.
- **`.github/workflows/generate-usage-report-pdf.yml`** — the scheduled
  workflow. Auth via a dedicated service principal (`Cosmos DB Data
  Reader` on the `chatbot` database, `Storage Blob Data Contributor` +
  `Storage Blob Delegator` scoped to the `usage-reports` container only).

## Changed Files

- **`lib/slack-formatter.js`** — `formatWeeklyReport` appends an optional
  `📎 *Full executive report:* <url>` line when `reportUrl` is present;
  omitted entirely when absent, so the existing no-link message shape is
  unaffected.
- **`WeeklyReportTrigger/index.js`** — calls `getLatestReportLink` before
  formatting the message and passes the result through as `reportUrl`.

## Storage Layout

- Container `usage-reports` in the `fionausagereportsa` account (the same
  account backing `usage-report-function`'s `AzureWebJobsStorage`, in
  `edfi-fiona-rg`). `DEPLOYMENT.md` elsewhere in this repo uses
  `fionastorage`/`fiona-rg` as *generic placeholder names* in unrelated
  example commands — the real resource names discovered while setting this
  up are `fionausagereportsa` and `edfi-fiona-rg`.
- Per-week PDFs: `executive-report-<deploymentType>-<start>-to-<end>.pdf`,
  matching the naming convention the agent already uses for ad hoc runs
  (`.github/agents/azure-usage-report.agent.md` rule 13). Kept indefinitely
  as an audit trail — no lifecycle/retention policy in this scope.
- One pointer blob, `latest-link.json`, overwritten every run.

## SAS Lifetime Constraint (discovered during verification)

The design originally called for a long-lived (~90-day) SAS URL. While
manually verifying the upload/SAS/pointer steps end-to-end, `az storage
blob generate-sas --as-user` (Azure AD user delegation SAS, chosen so the
workflow never needs the storage account's shared key) rejected any expiry
beyond 7 days:

```
ERROR: incorrect usage: --expiry should be within 7 days from now
```

This is a hard Azure platform limit on user delegation SAS, not a
configuration choice. Fixed by using a 6-day expiry instead (leaving margin
for clock skew) rather than switching to account-key-based SAS. Consequence:
each week's report link stays reachable for about a week — roughly through
the next Monday's message — before expiring. The underlying PDF blobs
remain in storage indefinitely; only the previously-issued SAS URL for
them goes stale. Switching to account-key SAS would restore the longer
expiry but reintroduce a shared secret into the pipeline, which the
RBAC-only design was specifically chosen to avoid.

## Error Handling / Observability

- `getLatestReportLink` never throws — degrades to KPI-text-only plus a
  `logger.warn(...)`, matching the existing failure-isolation pattern
  around `SLACK_DRY_RUN` and the handler's outer try/catch.
- GitHub Actions workflow failures surface as a failed Actions run, same
  as `deploy-usage-report-function.yml`; `workflow_dispatch` covers manual
  re-runs. No new alerting, no in-workflow retries — an accepted trade-off
  of running close to `REPORT_SCHEDULE` instead of days ahead.

## Verification

Manual setup and a full dry run were completed against the real `edfi-fiona-rg`
resources (see `DEPLOYMENT.md`'s "Usage Report PDF Pipeline" section for
the setup steps):

- Storage container, dedicated service principal + role assignments
  (`Cosmos DB Data Reader`, `Storage Blob Data Contributor`, `Storage Blob
  Delegator`), and the Function's managed identity (`Storage Blob Data
  Reader`) were all created/granted and confirmed via `az role assignment
  list`.
- `scripts/generate-executive-report-artifact.js` was run locally against
  live Cosmos data, producing a real PDF for the current Mon–Sun window.
- The upload → SAS → pointer steps were run manually (the workflow itself
  can't be triggered via `workflow_dispatch` until it exists on `main` —
  a GitHub platform requirement for newly added `workflow_dispatch`
  workflows). The resulting SAS URL was confirmed reachable (`curl -I` →
  `200 OK`, correct `Content-Type: application/pdf`).
- `lib/report-link.js#getLatestReportLink` was run against the real
  uploaded pointer: returns the URL on a matching window, `null` plus a
  warning on a mismatched one.
- Full workflow-level (`workflow_dispatch`) and Slack-message-level
  end-to-end verification is still pending this branch's merge to `main`.

## Out of Scope

- Retention/lifecycle policy for old PDF blobs.
- Alerting on GitHub Actions workflow failure.
- Any change to the deployed Function's hosting plan.
