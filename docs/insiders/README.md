# Fiona Insiders Documentation

Welcome to Insiders! This folder contains all documentation for the pre-release testing channel.

## Quick Navigation

### For Engineers
- [Workflow Guide](./WORKFLOW.md) — Branch strategy, PR process, merge workflow
- [Rollback Guide](./ROLLBACK.md) — How to revert deployments (manual + automated)

### For QA & Testers
- [Testing Guide](./TESTING.md) — How to verify features and report bugs
- [Monitoring](./MONITORING.md) — Where to see what's live + traceability

### For Leadership & Product
- [Program Overview](./OVERVIEW.md) — Strategy, metrics, roadmap

## 30-Second Quickstart

1. **Engineer:** Create branch → PR to `insiders` → merge → auto-deploys
2. **QA:** Check Deployments tab → test → report bugs
3. **Rollback:** Use automated workflow (1 click)

## Deployment Trigger Coverage

The insiders deployment workflow triggers on:
- **Exact branch:** `insiders`
- **Pattern branches:** `insiders-**` (e.g., `insiders-hotfix`, `insiders-release`)

Both trigger automatic deployment to Fiona Insiders environment.

## Rollback Reliability

The rollback workflow now includes:
- ✅ Strict commit ancestry verification
- ✅ Merge-commit handling (automatic `-m 1` detection)
- ✅ Conflict detection and graceful abort
- ✅ Full git history access for safe operations
