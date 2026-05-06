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
- Need to revert a bad merge? See the [rollback guide](./insiders/ROLLBACK.md)
