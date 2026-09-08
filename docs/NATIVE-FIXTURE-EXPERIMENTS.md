# Native fixture experiments

An opt-in `native-fixture-v1` execution mode compares frozen instruction text on
self-contained fixtures, using AGNT's provider stack, Experiments and execution
Traces. It does not clone goals, create chat conversations, activate skills,
execute tools, or promote a candidate.

Use it for an initial reasoning comparison, not as proof of end-to-end skill
performance, tool permissions, resource loading, or field success.

## Workflow through the existing API

All requests use the existing authenticated Experiment API. Use the application's
normal authenticated client; never put credentials in datasets or config.

1. `POST /api/experiments/datasets` with `source: "manual"` and a nonempty `items`
   array. The actual item fields are `taskInput`, `expectedBehavior` (a JSON
   string), and `metadata`.
2. `GET /api/experiments/datasets/:id` to read back `dataset.items`. Freeze the
   exact ordered array; its digest is SHA-256 of UTF-8 `JSON.stringify(items)`.
3. `POST /api/experiments/` with `name`, `evalDatasetId`, and the config below.
4. `POST /api/experiments/:id/run` with matching `provider` and `model`, or omit
   overrides to use those pinned in config. This acknowledges dispatch; it does
   **not** prove admission or completion. Poll `GET /api/experiments/:id` for
   status, runs, and results. Terminal failures must be inspected, not retried
   blindly.
5. Open the recorded subject/grader execution IDs in Traces, or retrieve them via
   `GET /api/executions/agents/:id` with the existing authenticated client.

Example manual dataset item:

```json
{
  "taskInput": "Return the label specified by your skill instructions only.",
  "expectedBehavior": "{\"criteria\":[{\"id\":\"exact_beta\",\"description\":\"Response is exactly beta with no other text.\",\"required\":true}]}",
  "metadata": {
    "skill": "label-example",
    "id": "label-binding",
    "executionMode": "fixture-reasoning-no-tools"
  }
}
```

Build digests rather than manually transcribing them:

```js
import { createHash } from 'node:crypto';
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const candidateInstructions = 'For this fixture, respond with exactly beta.';
const controlInstructions = 'For this fixture, respond with exactly alpha.';
const config = {
  executionMode: 'native-fixture-v1',
  provider, // exact provider key usable by this authenticated user
  model,    // explicitly selected model; no implicit fallback
  tokenBudget: 10000,
  candidate: {
    name: 'label-example',
    instructions: candidateInstructions,
    sha256: sha256(candidateInstructions),
  },
  control: {
    instructions: controlInstructions,
    sha256: sha256(controlInstructions),
  },
  datasetSha256: sha256(JSON.stringify(items)), // exact read-back items
};
```

Expected outputs for this plumbing example are `alpha` and `beta`. The control
intentionally fails the `exact_beta` rubric; that is expected, not a transport
failure or a meaningful skill-quality finding.

## Controls and identity

- Omit `control` for a **no-skill control**. The existing native-runner subject
  prompt shape is preserved in this mode.
- Supply nonempty `control.instructions` and its exact `sha256` for a **frozen
  old-skill control**. Explicit null, blank text, missing or mismatched hashes are
  rejected before provider calls. Candidate instructions are also hashed.
- Supply identical control and candidate text for an **A/A observation pair**.
  This is not an automated statistical repeatability gate. Caller-owned analysis
  defines repetitions, tolerances and acceptance rules.

Config and dataset are cloned before asynchronous work. No live skill lookup can
change their contents halfway through an experiment. Hashes record supplied
bytes, not authorization, authentic upstream provenance or full reproducibility.
Package resources are not loaded automatically: callers must explicitly prepare
an appropriate instruction snapshot, without exposing grading rubrics to the
subject. Complete-package lineage remains the caller's responsibility.

Batch/result metadata includes `candidateHash`, `controlHash` (null if omitted),
`datasetHash` and `comparisonMode`. Arm metrics add `instructionHash`. Subject
prompts in explicit-control mode have the same neutral instruction heading and
different opaque observation IDs. Those IDs prevent AGNT's response cache from
replaying one identical-skill observation as another, without changing global
cache settings. The outbound prompts are therefore not byte-identical, even when
skill instruction bytes are identical. This does not make inference deterministic.

## Execution and grading

For each item, both variants run once; arm order alternates between items. Each
subject runs with no tools and zero tool rounds. A separate grader context sees
only task, fixed criteria and untrusted subject response, not source instructions
or variant labels. Both use the pinned provider/model. Same-model grading can
still be biased; inspect responses and validate important conclusions externally.

The grader must return exactly one Boolean value per criterion ID in a JSON
object, with no extra keys. Missing/invalid verdicts fail the experiment and
retain the raw grader response. Optional criteria (`required: false`) contribute
to the score but not the required-check pass. Use explicit Boolean required flags
and stable, unique criterion IDs when authoring fixtures.

Completed subject output and usage are written to its execution row **before**
grading starts. Subject and grader IDs remain in failure metrics when later
steps fail. The trace tree is batch → subject → grader, without conversation or
goal rows. Provider/grader faults stop subsequent arms; they do not become a clean
skill score. No automatic promotion or retry occurs. A repeat requires a new
experiment record; started/completed native experiments reject replay within the
supported service lifecycle.

## Limits and non-guarantees

- 1–24 fixtures; 1–8 criteria per fixture; `tokenBudget` 1,000–200,000.
- Budget checks occur **between calls**. One call can overshoot. This is not a
  hard token/spend cap; a final overshoot is reported as `overBudget`.
- Each model call receives a 90-second abort signal. Cancellation is cooperative
  and may not terminate every provider-side request. Unknown outcomes must not
  be interpreted as no work or permission to retry.
- The caller selects the exact fixture array. The normal dataset split metadata
  is not applied here. Train/validation/final-test separation and rubric secrecy
  must be established by the caller before claiming held-out evidence.
- Existing `runsPerExample`, `maxIterations`, goal replay and constraint-promotion
  settings do not expand this mode: one pair per item, review-only result,
  `confidence: 0`, `autoPromotion: false`.
- Status/trace writes use existing model APIs, not one atomic cross-table
  transaction. Server-side persistence decouples completed records from the HTTP
  polling client, but does not guarantee crash recovery or exactly-once execution.
  In-process admission guards are not distributed locks. Inspect partial records
  after interruption; automatic resume is not implemented.
- Prompts and outputs are stored in native traces. Supply only data suitable for
  that user's existing trace access/retention policy. No additional redaction or
  secret-storage mechanism is introduced by this mode.
- No new UI controls, authorization routes or credential handling are added.

## Deterministic regression tests

```sh
npx vitest run backend/src/services/evolution/NativeFixtureExperiment.test.js \
  backend/src/services/ExperimentService.native.test.js \
  backend/src/services/evolution/VerifierGate.spec.js
```

Tests inject storage/model dependencies: they verify prompt contracts,
legacy no-skill compatibility, old-vs-new control hashes, A/A cache-distinct
messages, fail-closed validation, snapshot immutability, and trace persistence
ordering. They are not live-provider tests or proof that a database crash loses
no evidence.
