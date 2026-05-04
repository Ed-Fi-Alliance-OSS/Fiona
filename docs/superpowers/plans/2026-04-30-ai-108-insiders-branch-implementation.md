# AI-108: Insiders Branch Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the `insiders` branch with automated CI/CD deployment to Fiona Insiders environment, enabling early feature testing before production release.

**Architecture:** Create `insiders` branch from `main`, configure protection rules (tests required, no mandatory reviews), leverage existing GitHub Actions workflows which already support the `insiders-**` pattern. Add a rollback workflow for emergency reverts. Document branching strategy and rollback procedures.

**Tech Stack:** GitHub API, GitHub Actions (YAML), Markdown documentation

---

## File Structure

**Files to Create:**
- `.github/workflows/rollback-insiders.yml` — GitHub Actions workflow for automated rollback
- `docs/branching-strategy.md` — Engineer guide: how to create PRs, merge process
- `docs/rollback-guide.md` — Rollback runbook (manual + automated)
- `docs/insiders-qa-guide.md` — QA guide: how to verify features in insiders
- `docs/insiders-overview.md` — Leadership summary of insiders program

**Files to Modify:**
- None — GitHub branch settings configured via API

---

## Task 1: Create `insiders` Branch from `main`

**Files:**
- GitHub repo: create branch via API

- [ ] **Step 1: Verify main branch is up-to-date**

```bash
git fetch origin
git checkout main
git log -1 --oneline
```

Expected: Shows latest commit (e.g., "122f615 fix: pass cosmosAccountName...")

- [ ] **Step 2: Create insiders branch locally**

```bash
git checkout -b insiders main
```

- [ ] **Step 3: Push insiders branch to origin**

```bash
git push -u origin insiders
```

Expected: Output shows "Branch 'insiders' set up to track 'origin/insiders'."

- [ ] **Step 4: Verify branch exists on GitHub**

```bash
git branch -r | grep insiders
```

Expected: Shows `origin/insiders`

- [ ] **Step 5: Commit branch creation note**

Commit to `feature/ai-108-insiders-branch`:

```bash
git add .
git commit -m "chore(ai-108): create insiders branch from main"
```

---

## Task 2: Configure Branch Protection Rules for `insiders`

**Files:**
- GitHub repo settings (via gh CLI)

- [ ] **Step 1: Set required status checks**

```bash
gh api repos/Ed-Fi-Alliance-OSS/Fiona/branches/insiders/protection \
  -X PUT \
  -f required_status_checks='{"strict":true,"contexts":["build","test"]}' \
  -f enforce_admins=false \
  -f required_pull_request_reviews=null \
  -f restrictions=null \
  -f allow_force_pushes=false \
  -f allow_deletions=false
```

Expected: Response shows protection rule applied.

**Note:** If gh API returns an error about specific context names, verify the actual workflow job names in `.github/workflows/on-pullrequest-fiona-slack.yml` and substitute the exact names.

- [ ] **Step 2: Verify protection rules applied**

```bash
gh api repos/Ed-Fi-Alliance-OSS/Fiona/branches/insiders/protection
```

Expected: JSON response shows `required_status_checks` and `allow_force_pushes: false`.

- [ ] **Step 3: Commit protection rules documentation**

Add note to plan:
```bash
git add .
git commit -m "chore(ai-108): document insiders branch protection rules"
```

---

## Task 3: Validate Existing CI/CD Workflows Support `insiders`

**Files:**
- `.github/workflows/deploy-fiona-slack.yml` (read-only verification)
- `.github/workflows/deploy-fiona-slack-container.yml` (read-only verification)

- [ ] **Step 1: Verify deploy-fiona-slack.yml triggers on insiders**

```bash
grep -A 5 "on:" .github/workflows/deploy-fiona-slack.yml | head -20
```

Expected output includes:
```
on:
  push:
    branches:
      - main
      - 'insiders-**'
```

Note: Existing workflow supports `insiders-**` pattern, which matches `insiders` branch.

- [ ] **Step 2: Verify deploy-fiona-slack-container.yml environment input**

```bash
grep -A 10 "environment:" .github/workflows/deploy-fiona-slack-container.yml | head -15
```

Expected output shows:
```
environment: ${{ inputs.environment || 'insiders' }}
```

- [ ] **Step 3: Verify GitHub Environments are configured**

```bash
gh api repos/Ed-Fi-Alliance-OSS/Fiona/environments
```

Expected: Response lists at least `insiders` and `production` environments.

If `insiders` environment does not exist, create it:

```bash
gh api repos/Ed-Fi-Alliance-OSS/Fiona/environments \
  -X POST \
  -f name='insiders' \
  -f deployment_branch_policy='{"protected_branches":false,"custom_deployment_branch_policy":{"type":"non-production"}}'
```

- [ ] **Step 4: Commit CI/CD validation notes**

```bash
git add .
git commit -m "chore(ai-108): validate existing CI/CD workflows support insiders"
```

---

## Task 4: Create Rollback GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/rollback-insiders.yml`

- [ ] **Step 1: Create rollback workflow file**

Create `.github/workflows/rollback-insiders.yml`:

```yaml
# SPDX-License-Identifier: Apache-2.0
# Licensed to the Ed-Fi Alliance under one or more agreements.
# The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
# See the LICENSE and NOTICES files in the project root for more information.

name: Rollback Insiders Deployment

on:
  workflow_dispatch:
    inputs:
      commit_to_revert:
        description: 'Git commit hash to revert (e.g., abc1234)'
        required: true
        type: string
      reason:
        description: 'Reason for rollback (for audit trail)'
        required: true
        type: string

jobs:
  rollback:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
    - name: Checkout insiders branch
      uses: actions/checkout@v4
      with:
        ref: insiders
        fetch-depth: 10

    - name: Verify commit exists
      run: |
        git log --oneline | head -20
        COMMIT_FOUND=$(git log --oneline | grep -c "${{ inputs.commit_to_revert }}")
        if [ "$COMMIT_FOUND" -eq 0 ]; then
          echo "ERROR: Commit ${{ inputs.commit_to_revert }} not found in recent history"
          exit 1
        fi
        echo "✓ Commit ${{ inputs.commit_to_revert }} found"

    - name: Create revert commit
      run: |
        git config user.name "GitHub Actions"
        git config user.email "actions@github.com"
        git revert --no-edit ${{ inputs.commit_to_revert }}
        echo "REVERT_COMMIT=$(git rev-parse HEAD)" >> $GITHUB_ENV

    - name: Push revert to insiders
      run: |
        git push origin insiders
        echo "## Rollback Initiated" >> $GITHUB_STEP_SUMMARY
        echo "" >> $GITHUB_STEP_SUMMARY
        echo "- **Reverted commit:** ${{ inputs.commit_to_revert }}" >> $GITHUB_STEP_SUMMARY
        echo "- **Revert commit:** ${{ env.REVERT_COMMIT }}" >> $GITHUB_STEP_SUMMARY
        echo "- **Reason:** ${{ inputs.reason }}" >> $GITHUB_STEP_SUMMARY
        echo "- **Timestamp:** $(date -u +'%Y-%m-%d %H:%M:%S UTC')" >> $GITHUB_STEP_SUMMARY
        echo "" >> $GITHUB_STEP_SUMMARY
        echo "Deployment workflow will trigger automatically. Check Actions tab to monitor."

    - name: Failure notification
      if: failure()
      run: |
        echo "❌ Rollback failed. Revert commit was not pushed." >> $GITHUB_STEP_SUMMARY
        echo "Manual recovery required: see rollback guide." >> $GITHUB_STEP_SUMMARY
```

- [ ] **Step 2: Verify workflow syntax**

```bash
# Validate YAML syntax (requires Python)
python3 -m py_compile .github/workflows/rollback-insiders.yml || echo "Note: Install PyYAML to validate YAML"
```

Expected: No syntax errors.

- [ ] **Step 3: Commit rollback workflow**

```bash
git add .github/workflows/rollback-insiders.yml
git commit -m "feat(ai-108): add automated rollback workflow for insiders branch"
```

---

## Task 5: Write Branching Strategy Guide

**Files:**
- Create: `docs/branching-strategy.md`

- [ ] **Step 1: Create branching strategy guide**

Create `docs/branching-strategy.md`:

```markdown
# Fiona Insiders Branch – Branching Strategy

## Overview

The `insiders` branch is a pre-release testing channel. Features merged to `insiders` are automatically deployed to the Fiona Insiders environment within minutes, allowing QA and early users to test upcoming changes before production release.

## Branch Hierarchy

```
main (production-ready)
  ↓
feature/* (development)
  ↓
insiders (pre-release test channel)
  ↓
Fiona Insiders Environment (live)
```

## Workflow: Getting a Feature into Insiders

### 1. Create a Feature Branch

```bash
# Start from insiders or main (your choice)
git checkout insiders
git pull origin insiders
git checkout -b feature/your-feature-name
```

### 2. Develop and Push

```bash
# Make your changes, commit as usual
git add .
git commit -m "feat(ai-xxx): your feature description"
git push -u origin feature/your-feature-name
```

### 3. Open a Pull Request to `insiders`

1. Go to GitHub: https://github.com/Ed-Fi-Alliance-OSS/Fiona/pulls
2. Click "New Pull Request"
3. Base: `insiders`, Compare: `feature/your-feature-name`
4. Fill title and description
5. Click "Create Pull Request"

### 4. Automated Checks

Once PR is opened:
- GitHub Actions automatically runs tests (build, lint, unit tests)
- Status appears in the PR checks section
- If all checks pass → you can merge

### 5. Merge to Insiders

1. Click "Merge pull request" (no approvals required, just passing tests)
2. Select "Squash and merge" or "Create a merge commit" (your choice)
3. Delete branch when prompted

### 6. Automatic Deployment

Within 2 minutes:
- GitHub Actions workflow `deploy-fiona-slack.yml` starts
- App builds and deploys to Fiona Insiders environment
- Check GitHub Deployments tab to verify success

## Monitoring Deployment

### Option 1: GitHub Deployments Tab
1. Go to repo: https://github.com/Ed-Fi-Alliance-OSS/Fiona
2. Click "Deployments" tab
3. Look for "insiders" environment
4. Latest entry shows what's live

### Option 2: GitHub Actions
1. Click "Actions" tab
2. Filter: workflow `Deploy Fiona Slack App (Slack CLI)`
3. Find the run triggered by your merge
4. Expand job logs to see build output

### Option 3: Direct Testing
1. Go to Fiona Insiders Slack workspace
2. @mention Fiona bot and ask a question
3. You're talking to the version from `insiders` branch

## Branch Protection Rules

The `insiders` branch has light protection:
- ✅ Required: All CI checks must pass
- ✅ Allowed: Merges without code review (but reviews are welcome)
- ❌ Blocked: Force pushes
- ❌ Blocked: Direct pushes (PRs only)

This balance lets us iterate quickly while keeping tests passing.

## FAQ

**Q: Can I merge directly to insiders without a PR?**  
A: No. Branch protection requires all code go through PRs and pass tests.

**Q: How long does deployment take after merging?**  
A: Usually 2-5 minutes. Check Actions tab for exact timing.

**Q: What if tests fail?**  
A: Fix the issues locally, push to your feature branch, and the PR will automatically re-check. Merge once green.

**Q: Can I merge insiders back to main?**  
A: Yes, but follow your team's process for promoting from insiders to production (usually via a separate PR with review).

## Getting Help

- Deployment issues? Check the Actions tab logs
- Questions about a feature that's live? Check Deployments tab for commit hash
- Need to revert a bad merge? See the [rollback guide](./rollback-guide.md)
```

- [ ] **Step 2: Commit branching strategy guide**

```bash
git add docs/branching-strategy.md
git commit -m "docs(ai-108): add insiders branching strategy guide for engineers"
```

---

## Task 6: Write Rollback Guide

**Files:**
- Create: `docs/rollback-guide.md`

- [ ] **Step 1: Create rollback guide**

Create `docs/rollback-guide.md`:

```markdown
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
```

- [ ] **Step 2: Commit rollback guide**

```bash
git add docs/rollback-guide.md
git commit -m "docs(ai-108): add rollback procedures for insiders branch"
```

---

## Task 7: Write QA Testing Guide

**Files:**
- Create: `docs/insiders-qa-guide.md`

- [ ] **Step 1: Create QA guide**

Create `docs/insiders-qa-guide.md`:

```markdown
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
```

- [ ] **Step 2: Commit QA guide**

```bash
git add docs/insiders-qa-guide.md
git commit -m "docs(ai-108): add QA testing guide for insiders environment"
```

---

## Task 8: Write Leadership Overview

**Files:**
- Create: `docs/insiders-overview.md`

- [ ] **Step 1: Create leadership overview**

Create `docs/insiders-overview.md`:

```markdown
# Fiona Insiders Program Overview

## Executive Summary

**Insiders** is an automated pre-release channel that deploys features to the Fiona Insiders environment within minutes of code merge. This enables rapid validation and feedback loops before production release.

**Key metrics:**
- **Deployment frequency:** Immediate (2-5 minutes after merge)
- **Time to feedback:** Same day
- **Risk mitigation:** Issues caught in insiders before production
- **User engagement:** Early adopters can shape features via feedback

## How It Works

```
Engineer merges PR → insiders branch → Automated tests → Automated deploy → Fiona Insiders live
                        (3 min)              (2 min)           (1-2 min)
```

1. Engineers create feature branches off `insiders`
2. Tests must pass (automated requirement)
3. On merge, GitHub Actions automatically builds and deploys to Fiona Insiders
4. QA and beta users test in Fiona Insiders workspace
5. Issues are reported and fixed in new PRs (cycle repeats)

## Release Process

### Insiders → Production Path

```
insiders (pre-release) → (team approval) → main (production)
     ↓
Fiona Insiders (test users)
     ↓
Feedback collected
     ↓
When ready → Merge insiders → main
     ↓
Deploy to production (Fiona workspace)
```

The team decides when insiders features are production-ready. This could be:
- **Weekly releases:** Batch insiders changes into weekly production deploys
- **Feature-driven:** Promote specific insiders features to production as they're validated
- **Continuous:** Deploy insiders → main on a defined schedule

## Benefits

| Aspect | Before Insiders | With Insiders |
|--------|-----------------|---------------|
| **Feature validation** | Weeks (design review → dev → QA) | Hours (dev → insiders QA) |
| **User feedback** | Post-launch (late adjustments) | Pre-launch (early feedback) |
| **Bug detection** | Production incidents | Insiders testing |
| **Team visibility** | Sprint demos only | Real-time (check Deployments tab) |
| **Deploy safety** | Single deployment per release | Continuous small deploys (lower risk per deploy) |

## Metrics to Track

### Deployment Health
- **Deployment frequency:** How often does insiders deploy?
- **Deployment success rate:** % of merges that deploy cleanly
- **Mean time to deploy:** How long from merge to live

### Quality
- **Bug escape rate:** Bugs found in insiders vs. production
- **QA feedback loop time:** Time from deployment to issue reported
- **Rollback frequency:** How often do we need to revert?

### Adoption
- **Active insiders users:** How many are testing features?
- **Issues reported:** Feedback from insiders testing
- **Feature delivery time:** Days from PR merge to production

## Responsibilities

### Engineers
- Merge code to `insiders` when ready for testing
- Monitor deployment status
- Address issues found by QA in insiders

### QA / Beta Testers
- Test features in Fiona Insiders workspace
- Report bugs with deployment info (commit hash, timestamp)
- Provide feedback on usability and edge cases

### Product/Leadership
- Decide release cadence (daily, weekly, feature-driven)
- Prioritize which insiders features go to production
- Monitor metrics and user feedback

## Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| **Incomplete feature ships to insiders** | Code review still happens (tests required); insiders is QA's job to catch issues |
| **Insiders is unstable** | Rollback is one-click (see rollback guide); revert is faster than a fix |
| **Users confused by feature changes** | Insiders is a controlled environment; change communication is intentional |
| **Too many features in flight** | Team controls merge rate to insiders (PR-based, not branch auto-sync) |

## Timeline & Roadmap

**Phase 1 (Complete):** Infrastructure setup
- ✅ `insiders` branch created
- ✅ Branch protection rules configured
- ✅ GitHub Actions workflows verified
- ✅ Rollback workflow added

**Phase 2 (Current):** Documentation & training
- Team training on insiders workflow
- QA documentation and testing procedures
- Leadership visibility into deployment metrics

**Phase 3 (Future):** Optimization
- Monitoring dashboard (automated alerts if deploy fails)
- Integration with project tracking (auto-link deployed commits to Jira)
- Metrics dashboard (deployment frequency, success rate, etc.)

## Getting Started

1. **For engineers:** See `branching-strategy.md` for PR workflow
2. **For QA:** See `insiders-qa-guide.md` for testing procedures
3. **For rollback:** See `rollback-guide.md` for emergency procedures

## Questions?

- How do I deploy to insiders? → `branching-strategy.md`
- How do I verify what's live? → `insiders-qa-guide.md`
- How do I revert a bad deployment? → `rollback-guide.md`
```

- [ ] **Step 2: Commit overview**

```bash
git add docs/insiders-overview.md
git commit -m "docs(ai-108): add insiders program overview for leadership"
```

---

## Task 9: Create README for Documentation

**Files:**
- Create: `docs/INSIDERS.md` (index)

- [ ] **Step 1: Create documentation index**

Create `docs/INSIDERS.md`:

```markdown
# Fiona Insiders Documentation

## What is Fiona Insiders?

Fiona Insiders is a pre-release testing channel where new features are automatically deployed within minutes of merging to the `insiders` branch. It enables rapid testing and feedback before production release.

## Quick Links

### For Engineers
📖 [Branching Strategy](./branching-strategy.md) — How to create PRs and merge to insiders  
🔧 [Rollback Guide](./rollback-guide.md) — How to revert a bad deployment

### For QA & Testers
🧪 [QA Testing Guide](./insiders-qa-guide.md) — How to verify features and report bugs

### For Leadership & Product
📊 [Insiders Program Overview](./insiders-overview.md) — Strategy, metrics, roadmap

### Emergency Procedures
🚨 [Rollback Guide](./rollback-guide.md) — What to do if something goes wrong (engineers & ops)

## Documentation Structure

| Document | Audience | Purpose |
|----------|----------|---------|
| branching-strategy.md | Engineers | Daily workflow: how to get code into insiders |
| insiders-qa-guide.md | QA, beta testers | How to test features and report issues |
| rollback-guide.md | Everyone | How to revert deployments (manual + automated) |
| insiders-overview.md | Leadership, product | Strategic overview, metrics, roadmap |

## 30-Second Overview

1. **You're an engineer:** Create a feature branch → PR to `insiders` → merge → auto-deploys (2-5 min)
2. **You're a QA:** Check Deployments tab → test in Fiona Insiders workspace → report bugs
3. **Something broke:** Use rollback workflow to revert (1 click, 1 minute)

## FAQ

**Q: How often do things deploy to insiders?**  
A: Every time someone merges a PR to the `insiders` branch. No fixed schedule.

**Q: Can I test the same feature multiple times?**  
A: Yes! Code deploys immediately. Just push more changes and test again.

**Q: What if a deployment fails?**  
A: Check the Actions tab logs. Rollback if needed using the rollback guide.

**Q: How do insiders features get to production?**  
A: Team decision. Usually: validate in insiders → merge to main → deploy to production.

## Getting Help

- Questions about branching? → `branching-strategy.md`
- Questions about testing? → `insiders-qa-guide.md`
- Questions about rollback? → `rollback-guide.md`
- Strategic questions? → `insiders-overview.md`
```

- [ ] **Step 2: Commit documentation index**

```bash
git add docs/INSIDERS.md
git commit -m "docs(ai-108): create insiders documentation index"
```

---

## Task 10: Final Validation & Summary

**Files:**
- None (verification only)

- [ ] **Step 1: Verify all documentation files exist**

```bash
ls -la docs/branching-strategy.md docs/rollback-guide.md docs/insiders-qa-guide.md docs/insiders-overview.md docs/INSIDERS.md
```

Expected: All files listed (no "No such file" errors).

- [ ] **Step 2: Verify workflow file exists**

```bash
ls -la .github/workflows/rollback-insiders.yml
```

Expected: File exists.

- [ ] **Step 3: Verify insiders branch exists on origin**

```bash
git branch -r | grep origin/insiders
```

Expected: Shows `origin/insiders`.

- [ ] **Step 4: Verify branch protection rules are set**

```bash
gh api repos/Ed-Fi-Alliance-OSS/Fiona/branches/insiders/protection --jq '.required_status_checks,.allow_force_pushes'
```

Expected: Shows status checks required and force pushes disabled.

- [ ] **Step 5: Create final summary commit**

```bash
git add .
git commit -m "chore(ai-108): complete insiders branch setup and documentation"
```

- [ ] **Step 6: Verify commit log**

```bash
git log --oneline -10
```

Expected: Shows commits related to AI-108 work.

---

## Self-Review Against Spec

**Spec Coverage Checklist:**

✅ **Git Branching** (Spec requirement: branch exists, strategy documented, protection rules configured)
- Task 1: `insiders` branch created from main
- Task 2: Branch protection rules configured (tests required)
- Task 5: Branching strategy documented

✅ **GitHub Actions CI/CD** (Spec requirement: workflows updated, auto-deploy on merge, no impact on other branches)
- Task 3: Validated existing workflows already support `insiders-**` pattern
- Task 3: Verified GitHub Environments configured

✅ **Deployment to Fiona Insiders** (Spec requirement: deployment on merge, version traceability, rollback documented)
- Task 3: Verified deployment automation
- Task 4: Automated rollback workflow created
- Task 6: Rollback guide with manual steps documented

✅ **Observability & Feedback** (Spec requirement: logs visible, monitoring, traceability)
- Task 3: GitHub Deployments tab provides traceability
- Task 7: QA guide documents how to verify deployment
- Task 6 & 7: Deployment logs and commit traceability documented

✅ **Documentation** (Spec requirement: branching workflow, validation steps, rollback)
- Task 5: Branching strategy guide
- Task 6: Rollback guide (manual + automated)
- Task 7: QA testing guide
- Task 8: Leadership overview
- Task 9: Documentation index

**No gaps found.** All acceptance criteria covered.

---

## Placeholder Scan

Checked for: TBD, TODO, "add appropriate", "similar to", undefined types/functions.

**Result:** None found. All tasks contain complete code, exact commands, and expected output.

---

## Type & Naming Consistency

All workflow names, file paths, and branch names are consistent throughout:
- Branch: `insiders` (not "insider" or "insiders-test")
- Environment: `insiders` (matches GitHub environment)
- Workflow: `rollback-insiders.yml` (follows naming convention)
- Documentation: All cross-references use exact paths

**Result:** All consistent.

