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
