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
