# Fiona Insiders – QA Testing Guide

## What is Fiona Insiders?

Fiona Insiders is a pre-release testing environment where new features are deployed within minutes of merging to the `insiders` branch. It lets QA and early users validate changes before production release.

**Environment:** Dedicated Slack workspace + Fiona bot instance  
**Update cadence:** New features deploy automatically on merge (2-5 minutes)  
**Users:** QA team + beta testers

## Accessing Fiona Insiders

1. **Slack workspace:** Ask your team for the invite link
2. **Bot name:** @Fiona (same as production, different workspace)
3. **Permissions:** You get access when you join the workspace

## Verifying a Feature is Live

### Step 1: Find What Deployed

Go to GitHub repo: https://github.com/Ed-Fi-Alliance-OSS/Fiona

**Option A: Deployments Tab** (Easiest)
1. Click "Deployments" tab
2. Find environment "insiders"
3. Look at the most recent deployment
4. Note the commit hash and timestamp

Example: `Deployment 5: insiders / abc1234 (2 hours ago)`

**Option B: Actions Tab**
1. Click "Actions" tab
2. Find workflow "Deploy Fiona Slack App (Slack CLI)"
3. Look for the most recent successful run
4. Click to expand and note the commit hash
5. Timestamp shows when it was deployed

### Step 2: Test the Feature in Slack

1. Go to Fiona Insiders workspace
2. Open any channel (or DM @Fiona)
3. Type a question for Fiona: `@Fiona what's the capital of France?`
4. You're now talking to the version that was deployed

### Step 3: Verify the Feature Works

Test the specific feature that was deployed:
- If it's a bugfix: verify the bug is gone
- If it's a new feature: verify the new feature exists and works
- Check for any error messages or crashes

## Reporting Issues

### If a Feature Works ✅

1. Go to the GitHub PR that was merged
2. Add a comment: `Verified in insiders – working as expected`
3. Include timestamp of your test

### If You Find a Bug 🐛

1. **Reproduce the issue** in Fiona Insiders
2. **Note the details:**
   - What did you do?
   - What happened?
   - What should have happened?
   - Any error messages?

3. **Check the deployment info:**
   - Go to Deployments tab
   - Note the commit hash of what's live
   - Note the timestamp

4. **Create a GitHub issue (or comment on existing):**

```
**Environment:** Fiona Insiders
**Version deployed:** abc1234 (2026-04-30 14:23 UTC)

**Steps to reproduce:**
1. @mention Fiona bot
2. Ask: "..."
3. ...

**Expected:** Feature should work normally
**Actual:** [describe the bug]

**Error message (if any):** [include full error]
```

5. **Notify the team:** Post in #fiona-dev Slack channel with link to the issue

## Checking Deployment History

Want to see what's been deployed and when?

1. Go to Deployments tab
2. Each entry shows:
   - Commit hash
   - Deployment time
   - Deployment status (active/inactive)

Click on a deployment to see:
- Author of the commit
- Commit message (describes the feature)
- Full logs from the deployment workflow

## Common Questions

**Q: The feature I just tested doesn't match the PR description**  
A: You may be on an older version. Check Deployments tab for current live version.

**Q: Can I request a specific commit to be deployed?**  
A: Merge the PR to insiders branch. It deploys automatically within 2-5 minutes.

**Q: How do I know if a deployment is still happening?**  
A: Check Actions tab. If a "Deploy Fiona Slack App" workflow is running, deployment is in progress.

**Q: What if deployment fails?**  
A: Check Actions tab logs for error details. Notify the engineer on the team.

**Q: Can I test multiple features at the same time?**  
A: Yes! If multiple PRs have merged, they all deploy together. Insiders is your test environment.

## Getting Help

- Slack workspace access? Ask your team lead
- Can't find deployment info? Check both Deployments and Actions tabs
- Found a critical bug? Post in #fiona-dev and mention @here
- Questions about a specific feature? Comment on the GitHub PR
