# Monitoring & Traceability

## Where to See What's Live

### 1. GitHub Deployments Tab (Primary)
- URL: https://github.com/Ed-Fi-Alliance-OSS/Fiona/deployments
- Shows every deployment to `insiders` environment
- Click deployment to see commit, PR, timestamp
- **Use this for:** Quick status check, traceability chain

### 2. GitHub Actions Tab
- URL: https://github.com/Ed-Fi-Alliance-OSS/Fiona/actions
- Filter by "Deploy Fiona Slack App"
- Expand "Deployment summary" step to see:
  - App directory
  - Environment (insiders vs production)
  - Git commit (short SHA)
  - Triggered by event type

### 3. Build Metadata Format
- Every deployment generates: `TIMESTAMP-COMMIT_HASH`
- Stored in GitHub Actions logs
- Visible in Deployments UI
- Allows tracing "what commit is live right now?"

## Traceability Chain

Commit → PR → Merge → Deployment → Verification

1. **Commit:** Author, message, timestamp
2. **PR:** Reviews, testing, merge decision
3. **Merge:** Merge commit on `insiders`
4. **Deployment:** Automatic trigger, build logs
5. **Verification:** Test in Fiona Insiders workspace

## Future Monitoring (Optional)
- Azure Application Insights dashboard
- Custom alerts if deploy fails
- Metrics: deployment frequency, success rate, bug escape rate
