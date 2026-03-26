/*
 * SPDX-License-Identifier: Apache-2.0
 * Licensed to the Ed-Fi Alliance under one or more agreements.
 * The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
 * See the LICENSE and NOTICES files in the project root for more information.
 */

## Plan: Strict-Consistency Sonar Citations in Slack

Implement citation support with strict consistency: do not finalize a Slack message until citation metadata is resolved (or an explicit timeout policy is reached), so footnotes and source blocks always correspond to the exact answer shown. Use a versioned metadata contract, deterministic source indexing, and idempotent finalize behavior.

**Steps**
1. Phase 1: Contract and lifecycle design
2. Define and document a versioned metadata envelope in [apps/fiona-slack/src/agent/llm-caller.js](apps/fiona-slack/src/agent/llm-caller.js) (for example metadata_contract_version: v1).
3. Specify required fields: provider, finalize_state, sources (normalized list), and source_index_map.
4. Specify optional fields: search_results, related_questions, evidence_snippets, tool_trace.
5. Define lifecycle states for strict consistency: streaming_text, collecting_metadata, ready_to_finalize, finalized, degraded_no_metadata.
6. Add invariant rules: links rendered to users must come only from API metadata (citations/search_results), never from model-generated prose links.
7. Phase 2: Streaming/finalization semantics
8. Refactor LLM execution flow in [apps/fiona-slack/src/agent/llm-caller.js](apps/fiona-slack/src/agent/llm-caller.js) so finalization is gated on metadata readiness; handlers should not call final stop until contract state is ready_to_finalize or degraded_no_metadata. Depends on step 5.
9. Implement bounded metadata wait policy (strict consistency default): wait for metadata promise to resolve; on timeout/error, finalize with explicit degraded_no_metadata state and no fabricated sources. Depends on step 8.
10. Add idempotent finalize guard keyed by response id/thread_ts so retries or duplicate completions cannot append duplicate Sources blocks. Depends on step 8.
11. Add deterministic aggregation for recursive tool calls: if multiple Perplexity interactions occur, aggregate citations via first-seen URL ordering and freeze final index map before rendering. Depends on steps 3 and 8.
12. Phase 3: Normalize and render source UX
13. Add source normalization helper (new module) to dedupe URLs, parse hostname/title fallback, keep stable 1..N numbering, and enforce source cap policy. Depends on step 3.
14. Add citation rendering helper (new file under listeners/views) to produce:
15. Answer text with inline [n] markers preserved/remapped to stable indices.
16. Numbered Sources block with n, title/hostname, clickable link, and optional date.
17. Optional Evidence row (short snippet) behind a feature flag for readability.
18. Update [apps/fiona-slack/src/listeners/assistant/message.js](apps/fiona-slack/src/listeners/assistant/message.js) and [apps/fiona-slack/src/listeners/events/app_mention.js](apps/fiona-slack/src/listeners/events/app_mention.js) so they finalize only after metadata state reaches ready_to_finalize/degraded_no_metadata, and render sources block before feedback block. Depends on steps 8 and 14.
19. Phase 4: Prompting and policy alignment
20. Update system guidance in [apps/fiona-slack/src/agent/llm-caller.js](apps/fiona-slack/src/agent/llm-caller.js) to encourage numeric citation markers for factual claims while forbidding fabricated URLs.
21. Add citation density policy: cite externally grounded claims, avoid over-citing conversational filler, cap displayed sources, deterministic truncation.
22. Phase 5: Test strategy and rollout controls
23. Add contract tests (new llm-caller test file) to assert required/optional fields, lifecycle transitions, and strict finalize gating behavior. Depends on steps 2 and 8.
24. Extend [apps/fiona-slack/tests/agent/tools/perplexity-search.test.js](apps/fiona-slack/tests/agent/tools/perplexity-search.test.js) to validate metadata passthrough and multi-call source aggregation behavior.
25. Extend [apps/fiona-slack/tests/listeners/assistant/message.test.js](apps/fiona-slack/tests/listeners/assistant/message.test.js) and [apps/fiona-slack/tests/listeners/events/app-mention.test.js](apps/fiona-slack/tests/listeners/events/app-mention.test.js) to verify:
26. final stop occurs after metadata readiness
27. sources block numbering matches inline markers
28. feedback block ordering remains intact
29. Add helper tests for dedupe/order/truncation/malformed URLs and idempotent rendering.
30. Add rollout flags: citation_metadata_collection_enabled and citation_rendering_enabled (default on in non-prod first), with telemetry on metadata wait duration, citation count, and degraded_no_metadata rate.

**Relevant files**
- [apps/fiona-slack/src/agent/llm-caller.js](apps/fiona-slack/src/agent/llm-caller.js) — metadata envelope, lifecycle states, strict finalize gating, aggregation logic.
- [apps/fiona-slack/src/agent/tools/perplexity-search.js](apps/fiona-slack/src/agent/tools/perplexity-search.js) — tool output metadata alignment.
- [apps/fiona-slack/src/listeners/assistant/message.js](apps/fiona-slack/src/listeners/assistant/message.js) — strict finalize ordering and block composition.
- [apps/fiona-slack/src/listeners/events/app_mention.js](apps/fiona-slack/src/listeners/events/app_mention.js) — strict finalize ordering and block composition.
- [apps/fiona-slack/src/listeners/views/feedback_block.js](apps/fiona-slack/src/listeners/views/feedback_block.js) — retained after sources block.
- New view/helper module under listeners/views — Sources and optional Evidence block builders.
- New helper module under agent utilities — source normalization and index mapping.
- [apps/fiona-slack/tests/agent/tools/perplexity-search.test.js](apps/fiona-slack/tests/agent/tools/perplexity-search.test.js) — metadata passthrough and aggregation tests.
- [apps/fiona-slack/tests/listeners/assistant/message.test.js](apps/fiona-slack/tests/listeners/assistant/message.test.js) — strict finalization behavior tests.
- [apps/fiona-slack/tests/listeners/events/app-mention.test.js](apps/fiona-slack/tests/listeners/events/app-mention.test.js) — strict finalization behavior tests.

**Verification**
1. Unit: contract schema tests validate v1 envelope and required fields are always present.
2. Unit: lifecycle tests validate transition order and that final stop never occurs before ready_to_finalize/degraded_no_metadata.
3. Unit: normalization tests validate stable numbering, dedupe, truncation, and malformed URL handling.
4. Unit: idempotency tests validate duplicate stream completions do not duplicate sources rendering.
5. Handler tests validate sources block appears before feedback block and numbering aligns with inline markers.
6. Manual QA in Slack sandbox:
7. Confirm answer text streams normally, then final message appears only after sources are ready.
8. Confirm source links map exactly to [n] markers and open expected destinations.
9. Confirm timeout/degraded_no_metadata path finalizes safely without fabricated citations.
10. Confirm UX remains readable on desktop and mobile Slack.

**Decisions**
- Chosen mode: strict consistency over speed.
- Include: contract versioning, finalize gating, timeout/degraded path, idempotent finalization, deterministic source indexing, tests, and telemetry.
- Exclude: asynchronous post-finalize citation append in default path.

**Further Considerations**
1. Timeout recommendation: start with a conservative metadata wait ceiling (for example 1.5-2.0s) and tune based on degraded_no_metadata telemetry.
2. Rollout recommendation: enable strict mode in a small cohort/channel first, then expand after observing finalize latency and mismatch rate.
3. Product copy recommendation: when degraded_no_metadata occurs, use a brief transparent note that sources were unavailable for this response.


**Execution Handoff Checklist**
1. Preflight
2. Confirm environment flags and defaults are documented for strict mode (citation metadata on, rendering on).
3. Confirm test entrypoints and local run commands are known before edits.
4. Contract-first implementation
5. Define metadata envelope v1 and lifecycle states in llm-caller flow.
6. Add required/optional field guarantees and enforce invariant: rendered links must originate from API metadata only.
7. Streaming/finalization gating
8. Implement finalize gate so Slack final stop is blocked until ready_to_finalize or degraded_no_metadata.
9. Add bounded wait timeout and deterministic degraded path copy.
10. Add idempotent finalize guard using response/thread identity.
11. Source normalization and rendering
12. Implement URL dedupe and stable first-seen indexing.
13. Implement footnote remap logic so inline markers and Sources numbering always match.
14. Build Sources block (and optional Evidence row behind flag).
15. Handler integration
16. Wire assistant-thread and app-mention handlers to consume metadata envelope and finalize in strict order.
17. Preserve existing feedback controls after Sources block.
18. Tests
19. Add/extend contract tests for envelope shape and lifecycle transitions.
20. Add/extend handler tests for finalize ordering and block ordering.
21. Add helper tests for dedupe, truncation, malformed URLs, and idempotency.
22. Rollout safety
23. Add telemetry for metadata wait duration, source count, degraded_no_metadata rate.
24. Enable rollout flags in non-prod first and observe metrics for at least one release window.
25. Exit criteria
26. No source-footnote mismatches in test suite.
27. No duplicate Sources blocks under retry/reconnect simulation.
28. Manual Slack QA passes on desktop and mobile for normal and degraded paths.
29. Post-merge follow-up
30. Capture observed latency and degraded rate; tune timeout if needed.
31. Decide whether Evidence row remains default-on or feature-flagged for production.
