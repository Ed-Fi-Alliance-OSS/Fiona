# Fiona Insiders Documentation

## What is Fiona Insiders?

Fiona Insiders is a pre-release testing channel where new features are automatically deployed within minutes of merging to the `insiders` branch. It enables rapid testing and feedback before production release.

## Quick Links

### For Engineers
📖 [Branching Strategy](./insiders/WORKFLOW.md) — How to create PRs and merge to insiders  
🔧 [Rollback Guide](./insiders/ROLLBACK.md) — How to revert a bad deployment

### For QA & Testers
🧪 [QA Testing Guide](./insiders/TESTING.md) — How to verify features and report bugs  
📊 [Monitoring](./insiders/MONITORING.md) — See what's live and traceability

### For Leadership & Product
📈 [Insiders Program Overview](./insiders/OVERVIEW.md) — Strategy, metrics, roadmap

### Emergency Procedures
🚨 [Rollback Guide](./insiders/ROLLBACK.md) — What to do if something goes wrong (engineers & ops)

## Documentation Structure

| Document | Audience | Purpose |
|----------|----------|---------|
| insiders/WORKFLOW.md | Engineers | Daily workflow: how to get code into insiders |
| insiders/TESTING.md | QA, beta testers | How to test features and report issues |
| insiders/MONITORING.md | Engineers, QA | Where to see deployments and traceability |
| insiders/ROLLBACK.md | Everyone | How to revert deployments (manual + automated) |
| insiders/OVERVIEW.md | Leadership, product | Strategic overview, metrics, roadmap |

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

## Key Updates (PR #37)

✅ **Deployment Trigger:** Now covers both `insiders` exact branch and `insiders-**` pattern  
✅ **Rollback Reliability:** Enhanced with strict commit verification, merge-commit handling, and conflict detection  
✅ **Documentation:** Reorganized into dedicated `docs/insiders/` folder with new monitoring guide  

See [Insiders Documentation Hub](./insiders/README.md) for full details.

## Getting Help

- Questions about branching? → [insiders/WORKFLOW.md](./insiders/WORKFLOW.md)
- Questions about testing? → [insiders/TESTING.md](./insiders/TESTING.md)
- Questions about monitoring? → [insiders/MONITORING.md](./insiders/MONITORING.md)
- Questions about rollback? → [insiders/ROLLBACK.md](./insiders/ROLLBACK.md)
- Strategic questions? → [insiders/OVERVIEW.md](./insiders/OVERVIEW.md)
