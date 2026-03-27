---
name: verify
description: Run the full verification suite (type check, lint, tests) for fiona-slack. Use before marking any task complete or creating a PR.
---

Run the following commands from `apps/fiona-slack/` and report the results:

```bash
cd apps/fiona-slack && npm run check && npm run lint && npm test
```

Report:
- Whether each step passed or failed
- Any type errors, lint violations, or failing tests
- What needs to be fixed before the work is done

If any step fails, do not claim the work is complete — fix the issues first, then re-run.
