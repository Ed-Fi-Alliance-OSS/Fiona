# AI-108: Insiders Branch Setup – Design Document

**Date:** 2026-04-30  
**Status:** Ready for Implementation  
**Approach:** A (Minimal Setup)

---

## Overview

Establish the `insiders` branch as a stable, automatically-deployed pre-release channel for Fiona. Features merged to `insiders` are automatically deployed to the Fiona Insiders environment, allowing early testing before broader release.

---

## Architecture

### Git Branching Strategy

```
main (production-ready)
  ↓
feature/* (development)
  ↓
insiders (pre-release test channel)
  ↓
Fiona Insiders Environment (live deployment)
```

**Branch Creation:**
- `insiders` branch created from `main`
- Developers create feature branches off `insiders` (or `main`) and open PRs targeting `insiders`
- `insiders` is never force-pushed; maintains linear history
- Manual merges only (no auto-merge from `main`)

**Protection Rules:**
- Required: All CI checks pass (tests, linting, builds)
- Optional: At least one review (lighter than `main`)
- No required code owners
- Allow force-push: disabled
- Dismiss stale reviews: enabled (merge doesn't invalidate old approvals)

---

## CI/CD Pipeline

**Existing Workflows (No Changes Required):**

Both `deploy-fiona-slack.yml` and `deploy-fiona-slack-container.yml` already support the `insiders-**` pattern and target the `insiders` GitHub environment.

**Triggers:**
- `push` or `merge` to `insiders` branch
- Runs: build, lint, test (via existing workflows)
- On success: automatically deploys to Fiona Insiders environment

**Build Metadata:**
- Every deployment generates a build version: `TIMESTAMP-COMMIT_HASH`
- Stored in GitHub Actions logs and deployment summaries
- Visible in GitHub UI under "Deployments"

---

## Observability & Traceability

### A) Git/GitHub UI (Primary)
- GitHub Deployments tab shows every deploy to `insiders` environment
- Commit → PR → Merge → Deployment form a visible chain in GitHub UI
- Quick view: "What's live in insiders now?" via Deployments page

### B) Deployment Logs
- GitHub Actions workflow logs capture every step (build, test, deploy)
- Slack notifications (if configured) announce successful deployments
- Build version in logs links directly to commit

### C) Monitoring (Optional Future)
- Placeholder: Azure Application Insights can track insiders deployments
- Future: Custom dashboard showing deployment timeline + feature status
- **For now:** Use GitHub Deployments as the primary audit trail

---

## Rollback Procedures

### Manual Rollback (Documented)
1. Identify the bad commit/merge in `insiders`
2. Create revert commit: `git revert <commit-hash>`
3. Push to `insiders` → triggers re-deployment with previous working state

### Automated Rollback Workflow
- New GitHub Actions workflow: `.github/workflows/rollback-insiders.yml`
- Workflow dispatcher input: select previous deployment to revert to
- Runs `git revert` and pushes to `insiders`
- Handles case: "deploy went wrong, go back to last known good"

**Safety:** Rollback workflow requires manual trigger (no auto-rollback)

---

## Deployment Verification

**After Merge to `insiders`:**
1. GitHub Actions workflow starts automatically
2. Check workflow status in Actions tab
3. On success, check Deployments tab for new entry
4. Confirm Fiona Insiders Slack workspace shows the new features

**Smoke Test (Manual):**
- QA/testers use Fiona Insiders workspace to verify functionality
- Log any issues as bugs with reference to the deployed commit

---

## Documentation Deliverables

### For Engineers
- **Branch workflow:** How to create feature branches, open PRs to `insiders`, merge process
- **Monitoring dashboard:** GitHub Deployments tab walkthrough
- **Rollback steps:** Manual + automated workflow usage

### For QA/Testers
- **What is insiders?** Pre-release testing environment
- **How to verify a feature is live:** Check Deployments tab, test in Slack workspace
- **How to report issues:** Include deployment commit hash for traceability

### For Leadership
- **Release cadence:** Features can reach `insiders` in hours (automated on merge)
- **Go-to-production:** When ready, merge from `insiders` → `main` (follows existing process)

---

## Success Criteria

✅ `insiders` branch exists with protection rules configured  
✅ Feature PRs targeting `insiders` trigger automatic CI/CD  
✅ Successful merges deploy to Fiona Insiders environment  
✅ Deployment history visible in GitHub Deployments tab  
✅ Rollback workflow available and documented  
✅ Team documentation covers workflow for engineers, QA, and leadership  

---

## Implementation Phases

**Phase 1: Git Setup**
- Create `insiders` branch from `main`
- Configure branch protection rules
- Verify workflows recognize the branch

**Phase 2: CI/CD Validation**
- Merge test PR to `insiders`
- Confirm workflow triggers and deployment succeeds
- Verify build metadata and logs

**Phase 3: Rollback & Automation**
- Create rollback workflow
- Test rollback scenario (deploy → revert)
- Document manual rollback steps

**Phase 4: Documentation**
- Write branching strategy guide
- Rollback runbooks
- QA testing guide
- Engineer workflow guide

---

## Notes

- Workflows already support `insiders` pattern; minimal code changes needed
- Azure environment secrets must be configured for `insiders` (likely already done)
- Version tagging via semver is out of scope; build version (timestamp + hash) is sufficient for pre-release
