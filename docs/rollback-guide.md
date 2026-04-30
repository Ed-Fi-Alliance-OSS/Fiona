# Fiona Insiders – Rollback Guide

## When to Rollback

Rollback the `insiders` branch when:
- A critical bug is discovered in the deployed version
- A feature causes widespread failures in Fiona Insiders workspace
- User-facing impact requires immediate revert
- Post-merge testing reveals blocking issues

## Before You Rollback

1. Notify the team in Slack (e.g., #fiona-dev channel)
2. Identify the exact commit hash of the bad deployment
3. Have a clear reason for rollback (for audit trail)

## Option 1: Automated Rollback (Recommended)

### Using GitHub Actions

1. Go to repo: https://github.com/Ed-Fi-Alliance-OSS/Fiona
2. Click "Actions" tab
3. Left sidebar: find workflow "Rollback Insiders Deployment"
4. Click "Run workflow"
5. Enter inputs:
   - **commit_to_revert:** The commit hash (e.g., `abc1234`)
   - **reason:** Why (e.g., "Critical: app crashes on mention")
6. Click "Run workflow"

The workflow will:
- ✓ Verify the commit exists in insiders history
- ✓ Create a revert commit
- ✓ Push to insiders (auto-triggers deployment)
- ✓ Log action in workflow summary

**Status:** Check the workflow run logs for success. Deployment will follow automatically.

### Finding the Commit to Revert

**From Deployments Tab:**
1. Go to "Deployments" tab
2. Find the bad deployment entry
3. Commit hash is shown (click to expand)

**From Actions Tab:**
1. Go to "Actions" → "Deploy Fiona Slack App"
2. Find the failed/bad run
3. Expand "Deployment summary" step
4. Copy the Git commit shown

**From Git:**
```bash
git log insiders --oneline | head -20
# Find the commit you want to revert, copy the hash (first 7 chars)
```

## Option 2: Manual Rollback

If the automated workflow is unavailable:

1. **Clone the repo (if you don't have it)**

```bash
git clone https://github.com/Ed-Fi-Alliance-OSS/Fiona.git
cd Fiona
```

2. **Fetch latest insiders**

```bash
git fetch origin
git checkout insiders
git pull origin insiders
```

3. **Create revert commit**

```bash
git log --oneline | head -10  # Find the commit hash to revert
git revert --no-edit abc1234  # Replace abc1234 with actual hash
```

4. **Push to insiders**

```bash
git push origin insiders
```

The push will trigger the deployment workflow automatically. Check Actions tab for progress.

5. **Verify rollback**

```bash
git log insiders --oneline | head -5
# You should see a "Revert ..." commit at the top
```

## After Rollback

1. **Confirm deployment succeeded**
   - Check Actions tab for the auto-triggered deploy workflow
   - Check Deployments tab for a new entry

2. **Test in Fiona Insiders**
   - @mention Fiona bot in Slack
   - Verify the feature is reverted (bug should be gone)

3. **Root cause analysis**
   - Investigate the reverted commit
   - Fix the issue in a new feature branch
   - Re-test before merging to insiders again

4. **Document in Jira**
   - Add comment to the affected issue
   - Reference the revert commit hash
   - Link to the rollback workflow run

## Safety Notes

- ✓ Rollback is safe: revert commits are normal Git operations
- ✓ No data loss: Cosmos DB and other services are unaffected
- ✓ History preserved: The bad commit stays in git history (revert is a new commit)
- ✓ Audit trail: GitHub logs all rollback workflow runs

## Rollback of a Rollback

If a rollback introduces a new problem:

1. Revert the revert commit (same process as above)
2. Or: Create a new fix-forward commit addressing both issues
3. Push to insiders and re-deploy

## Getting Help

- Rollback workflow errors? Check workflow logs in Actions tab
- Unsure about commit hash? Use Deployments or git log
- Still broken after rollback? Ping #fiona-dev channel
