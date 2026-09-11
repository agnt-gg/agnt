# Saved-agent execution telemetry v1

## Why this is high priority

`run_agent` is a trust boundary used to delegate real work. Previously it discarded new request measurements, unconditionally completed returned negative outcomes, and replaced failures with empty response/zero call counts. A lost acknowledgement or model failure after a tool could therefore appear to have performed no work. Its failure logger also called `.error` on a function export.

This change makes the saved-agent return and persisted execution-detail record agree. It does not redesign prompts, permission selection, goals, or the cost ledger.

## Contract

`executionTelemetry` (version 1) is additive on run_agent success/failure and `AgentExecutionModel.getExecutionDetails` (the existing trace-detail path). Old records return `executionTelemetry:null, telemetryAvailability:'unavailable'`. Invalid stored JSON/schema returns null and `invalid`, never the raw malformed payload.

Fields:
- outcome: completed / failed / blocked / cancelled. This is execution status, NOT independent acceptance of a deliverable.
- requestMetrics: exact JSON UTF-8 adapter-input sizes, request indices, per-role message bytes, schema bytes, peak and aggregate bytes. `boundary=adapter_input_json_utf8`, `tokenCount=not_measured`. No prompt or tool content stored here. Not tokenizer estimates, final HTTP wire size or provider-internal preamble.
- usage: provider-reported measured sums; absent fields are null. usageCoverage complete / partial / unknown, independent of request count. Explicit measured zero remains zero. Failed responses may have consumed provider tokens that were never reported.
- toolCalls: started / finished / inFlight, or null when the producing path supplied no observations. Finished means the call settled (including error), not that its effects succeeded.
- effectDisposition: no_tool_calls_dispatched / tool_calls_observed_effects_not_verified / in_flight_or_unknown / unknown. No tool dispatch does NOT mean no model/network activity.

Unknown fields are stripped by a whitelist; numeric values and cross-field relationships are checked. Histories are bounded to 1000 adapter requests. Telemetry never serializes arbitrary error objects, messages, arguments, results, credentials, paths or tool names. Existing native tool traces remain the place to inspect detailed effects; this PR does not duplicate raw tool results into a second storage system.

## Persistence and failure behavior

One nullable TEXT column is added to agent_executions via the existing database bootstrap. `AgentExecutionModel.update` accepts an optional trailing envelope and persists it with terminal status in the same SQL update. Existing callers and records remain compatible. No historical backfill is claimed.

The real execution service measures before every actual adapter call, in streaming and nonstreaming paths. It snapshots available evidence on thrown failure/cancellation. A tool that is still running when cancellation is observed is marked inFlight; it is not re-executed or assumed undone. This does not add hard cancellation to the existing streaming path.

`run_agent` preserves success/failure telemetry, reports negative transport statuses as unsuccessful, and does not call the worker again after a database error. If terminal persistence fails, the response reports persistence:unknown with the known execution ID and measurements; it does not overwrite the record with fabricated zeros. A live row may remain running and needs reconciliation. A failed telemetry migration produces a clear log and later affected writes fail; do not repeatedly execute agents to test a broken store.

The legacy top-level trace token fields still use their pre-existing zero defaults. For this feature's missing/partial measurements, executionTelemetry.usage and usageCoverage are authoritative. List views do not carry large request histories. This PR does not retrofit every dashboard or accounting consumer. The execution ledger remains monetary authority; no new billed-cost assertions.

A generic failure is returned without raw provider exception text. Inspect native diagnostics for details. No secret can be introduced by a new telemetry field because only fixed enums and numeric measurements are retained.

## Tests / dogfood

Gherkin-style test names, first RED at run_agent boundary: 7 failures / 1 pass against upstream implementation. A function-export logger defect was exposed while making negative paths observable and fixed in this scope.

- runAgent.telemetry.test.js: returned/persisted equality; post-tool failure; null vs zero; negative outcomes; persistence failure; wrong owner; cancellation.
- LlmExecutionService.telemetry.test.js: actual request counting, usage accumulation and missing metadata; both streaming/plain; tool failure; cancellation with in-flight work.
- AgentExecutionModel.telemetry.test.js: real isolated SQLite update/readback; old/corrupt records; schema/privacy bounds.
- runAgent.telemetry.integration.test.js: real wrapper -> task adapter -> execution service -> SQLite -> execution-detail projection. Model/runtime surface supplied as fixtures; no external model calls. Success and failure after a tool.
- executionTelemetryMigration.test.js: old table, additive column, repeated migration and retained rows.

Tests run in repository CI discovery, with the standard pre-import isolated data setup. An initial integration fixture omitted the required agents row and failed before execution creation; this was fixture setup, not accepted RED evidence. No production database was used.

## Review and rollout

Base: upstream main ca0c61f9. Self-contained producer and consumer instrumentation; does not require the local requestBudget/taskHandoff patches or PR131/138/139. Those branches also touch execution boundaries, so integrations must preserve both sets of behavior; do not overwrite their changes. This PR does not install a request-size policy or shorten prompts.

1. Review contract and privacy surface; run focused and broader regression suites.
2. Deploy database/bootstrap + helper + producer + adapter + wrapper + model together. No frontend build is needed for this backend-only feature.
3. After reload, perform one explicitly authorized read-only saved-agent call. Compare returned envelope with GET execution detail by the same executionId. Verify one controlled failure in a non-production fixture; do not force a real mutation just to obtain an error.
4. Confirm no raw content in metrics, null usage when unavailable, and no fabricated zero after tool dispatch.
5. Only then resume an operational goal. This PR is not live-deployed by publication.

Rollback code without dropping the additive column. Retain historical telemetry and traces. Rolling back future code does not reverse past tool effects. Back up per normal deployment policy; no destructive data migration or automatic rollback execution is included.
