# SkillForge Implementation Plan

> Branch: `feat/skillforge`
> Based on: PRD-SkillForge-Autonomous-Skill-Evolution.md
> Approach: Simple, additive, zero breaking changes

---

## Overview

SkillForge adds an autonomous learn-from-execution loop to AGNT. After a goal completes, a TraceAnalyzer extracts patterns from the execution trace, a SkillEvolver generates/refines a skill candidate and A/B tests it, then keeps or discards it based on a single composite metric (SES). Exceptional skills get promoted to Gold Standards.

**6 new files, 2 new DB tables, 2 single-line additions to existing files.**

---

## Phase 1: Data Layer (Models + Schema)

### Step 1.1 — Add `skill_versions` and `skill_evaluations` tables

**File**: `backend/src/models/database/index.js`
**Change**: Add two `CREATE TABLE IF NOT EXISTS` statements in the existing schema init function.

```sql
-- skill_versions: tracks evolutionary lineage of skills
CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  instructions TEXT NOT NULL,
  instructions_diff TEXT,
  effectiveness_score REAL,
  parent_version_id TEXT,
  source_goal_id TEXT,
  trace_analysis_summary TEXT,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- skill_evaluations: A/B test experiment log
CREATE TABLE IF NOT EXISTS skill_evaluations (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  skill_version_id TEXT,
  user_id TEXT NOT NULL,
  source_goal_id TEXT NOT NULL,
  baseline_ses REAL,
  baseline_completion REAL,
  baseline_tool_calls INTEGER,
  baseline_errors INTEGER,
  baseline_duration_ms INTEGER,
  treatment_ses REAL,
  treatment_completion REAL,
  treatment_tool_calls INTEGER,
  treatment_errors INTEGER,
  treatment_duration_ms INTEGER,
  delta REAL,
  decision TEXT NOT NULL,
  trace_analysis TEXT,
  judge_reasoning TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

No indexes needed initially — these tables will be small (dozens to hundreds of rows). Add indexes later if needed.

### Step 1.2 — Create `SkillVersionModel.js`

**File**: `backend/src/models/SkillVersionModel.js` (NEW)
**Pattern**: Follow `SkillModel.js` conventions — static methods, UUID ids, `getDb()` helper.

Methods:
- `create(data)` — Insert new version record
- `findBySkillId(skillId)` — All versions of a skill, ordered by version ASC
- `findLatest(skillId)` — Latest active version
- `findById(versionId)` — Single version
- `supersede(versionId)` — Set status to 'superseded'
- `getLineage(skillId)` — Full version chain with parent refs
- `getEvolutionStats(skillId)` — SES progression over versions

Simple CRUD — ~80 lines.

### Step 1.3 — Create `SkillEvalModel.js`

**File**: `backend/src/models/SkillEvalModel.js` (NEW)
**Pattern**: Same as above.

Methods:
- `create(data)` — Record an A/B test result
- `findBySkillId(skillId)` — All evaluations for a skill
- `findByGoalId(goalId)` — All evaluations from a goal
- `findByUserId(userId, limit)` — All evaluations for a user
- `getWinRate(skillId)` — % of evals where delta > threshold
- `getAverageDelta(skillId)` — Mean SES improvement
- `getLeaderboard(userId, limit)` — Top skills by avg delta

Simple CRUD — ~90 lines.

---

## Phase 2: TraceAnalyzer

### Step 2.1 — Create `TraceAnalyzer.js`

**File**: `backend/src/services/goal/TraceAnalyzer.js` (NEW)
**Dependencies**: GoalModel, TaskModel, GoalIterationModel, GoalEvaluator, StreamEngine

This is the "LLM-as-Judge" that reviews execution traces and extracts skill-worthy patterns.

**Core logic:**

```
analyzeTrace(goalId, userId)
  1. Fetch goal, tasks, iterations, evaluation from existing models
  2. Guard: skip if <3 tasks or <2 iterations (not enough signal)
  3. Guard: if score <30%, analyze for antipatterns only, no skill candidate
  4. Build trace document (structured text from execution data)
  5. Send to LLM with judge prompt (temperature=0 for consistency)
  6. Parse + validate JSON response
  7. Return TraceAnalysis object
```

**Key design decisions:**
- Use the user's configured provider/model (from settings, like GoalEvaluator does)
- Use `StreamEngine.generateContent()` for model-agnostic LLM access (same pattern as GoalEvaluator)
- Cap trace document at ~15K tokens — truncate task outputs to 2000 chars each
- Validate LLM output with try/catch JSON.parse + schema check
- Return `null` if analysis fails (non-critical, should never block goal flow)

**Trace document structure** — assembled from existing data:
```
=== GOAL ===
Title, description, success criteria, status, total iterations

=== TASKS ===
Per task: title, status, agent, tools used, output (truncated), errors, duration

=== ITERATION HISTORY ===
Per iteration: score, tasks completed, tasks replanned, world state delta

=== EVALUATION ===
Overall score, per-task scores, evaluator feedback
```

**LLM judge prompt**: As specified in PRD section 6.1.3 — structured rubric covering tool sequences, prompt strategies, error recovery, efficiency, and transferability. Output is JSON with patterns, antipatterns, insights, and a skill candidate.

Estimated: ~150 lines.

### Step 2.2 — Guard Rails

- `skillCandidate.confidence >= 0.7` required to proceed to evolution
- `traceQuality === 'low'` → log and skip
- JSON parse failure → return null, log warning
- LLM timeout → return null (non-blocking)

---

## Phase 3: SkillEvolver

### Step 3.1 — Create `SkillEvolver.js`

**File**: `backend/src/services/goal/SkillEvolver.js` (NEW)
**Dependencies**: SkillModel, SkillVersionModel, SkillEvalModel, GoldenStandardModel, GoalEvaluator, TaskOrchestrator, StreamEngine

This is the A/B testing engine.

**Core logic:**

```
evolveSkill(traceAnalysis, sourceGoalId, userId)
  1. Check for similar existing skill (_findSimilarSkill)
     - Same category + >50% tool overlap → route to refineSkill()
     - No match → create new skill
  2. Create draft skill in SkillModel (from traceAnalysis.skillCandidate)
  3. Create v1 record in SkillVersionModel
  4. Run A/B test:
     a. Derive reference goal (clone source goal structure, type='skill_eval')
     b. Run baseline: execute reference goal WITHOUT new skill → measure SES
     c. Run treatment: execute SAME reference goal WITH new skill → measure SES
     d. Calculate delta = treatment_SES - baseline_SES
  5. Decision:
     - delta > 2.0 → KEEP (update skill, record in SkillEvalModel)
     - delta <= 2.0 → DISCARD (delete draft, record in SkillEvalModel)
     - treatment_SES > 90 → PROMOTE to Gold Standard
  6. Clean up reference goals (delete type='skill_eval' goals)
  7. Return EvolutionResult
```

**SES calculation** (`_calculateSES`):
```
SES = (0.30 × Completion) + (0.20 × Efficiency) + (0.15 × Recovery)
    + (0.15 × Speed) + (0.10 × Quality) + (0.10 × Consistency)
```

Each component normalized to 0-100. Data comes from GoalEvaluator output + task execution metrics.

**Skill refinement** (`refineSkill`):
- When similar skill exists, use LLM to merge existing instructions with new trace insights
- Create new version (v2, v3, etc.)
- A/B test new version against current version (not against no-skill baseline)
- If new version wins → supersede old, activate new
- If old version wins → discard new version

**Reference goal execution**:
- Clone the source goal's structure (title, tasks, success criteria)
- Mark with `type: 'skill_eval'` so it doesn't appear in user's goal list
- Use a fixed time budget (default: 5 minutes)
- Sequential execution (baseline first, then treatment) for fairness
- Same agent, same model, same provider for both runs
- Delete reference goals after A/B test completes

**Gold Standard promotion** (`_promoteToGoldStandard`):
- Uses existing `GoldenStandardModel.create()` — no new code needed
- Stores skill instructions + SES metadata in template_data
- Updates skill's metadata JSON with `skillforge.status: 'gold_standard'`

Estimated: ~250 lines.

---

## Phase 4: Orchestrator + Routes

### Step 4.1 — Create `SkillForgeOrchestrator.js`

**File**: `backend/src/services/goal/SkillForgeOrchestrator.js` (NEW)
**Dependencies**: TraceAnalyzer, SkillEvolver, SkillEvalModel, SkillVersionModel

Top-level coordinator with a single entry point.

```javascript
class SkillForgeOrchestrator {
  // Called after goal completes (fire-and-forget)
  static async onGoalCompleted(goalId, userId) {
    // Guard: score > 30%
    // Guard: iterations >= 2
    // Phase 1: TraceAnalyzer.analyzeTrace()
    // Guard: skillCandidate.confidence >= 0.7
    // Phase 2: SkillEvolver.evolveSkill()
    // Broadcast result via WebSocket
    return result;
  }

  // Manual trigger endpoints
  static async analyzeGoal(goalId, userId) { ... }
  static async evolveFromGoal(goalId, userId) { ... }
  static async getStats(userId) { ... }
  static async getSettings(userId) { ... }
  static async updateSettings(userId, settings) { ... }
}
```

Settings stored in a simple JSON file or in a `skillforge_settings` key in user preferences (existing settings system). Default settings:
```json
{
  "autoAnalyze": false,
  "abTestTimeBudgetMs": 300000,
  "minConfidence": 0.7,
  "minDelta": 2.0,
  "goldStandardThreshold": 90
}
```

Estimated: ~100 lines.

### Step 4.2 — Create `skillForgeRoutes.js`

**File**: `backend/src/routes/skillForgeRoutes.js` (NEW)
**Pattern**: Follow `GoalRoutes.js` structure — Express router, authenticateToken middleware.

Endpoints:
| Method | Endpoint | Handler |
|--------|----------|---------|
| POST | `/analyze/:goalId` | Manual trace analysis |
| GET | `/analysis/:goalId` | Get cached analysis |
| POST | `/evolve/:goalId` | Manual skill evolution |
| GET | `/evaluations` | List user's A/B tests |
| GET | `/evaluations/:skillId` | Evaluations for a skill |
| GET | `/leaderboard` | Top skills by avg SES delta |
| GET | `/skill/:skillId/versions` | Version history |
| GET | `/skill/:skillId/lineage` | Evolutionary lineage |
| GET | `/stats` | Aggregate stats |
| GET | `/settings` | Get SkillForge config |
| POST | `/settings` | Update SkillForge config |

Estimated: ~80 lines.

---

## Phase 5: Integration (2 single-line changes)

### Step 5.1 — Hook into goal completion

**File**: `backend/src/services/goal/TaskOrchestrator.js`
**Change**: After the goal status is set to 'completed'/'validated' in the PASSED exit path (~line 556-577), add:

```javascript
// Fire-and-forget: trigger SkillForge analysis (non-blocking)
import { SkillForgeOrchestrator } from './SkillForgeOrchestrator.js';
SkillForgeOrchestrator.onGoalCompleted(goalId, userId).catch(err => {
  console.error('SkillForge analysis failed (non-critical):', err.message);
});
```

This is a **single addition** to the existing pipeline. If it fails, goal execution is unaffected.

### Step 5.2 — Register routes

**File**: `backend/server.js`
**Change**: Add one import + one `app.use()` line alongside existing route registrations (~line 110-136):

```javascript
import SkillForgeRoutes from './src/routes/skillForgeRoutes.js';
app.use('/api/skillforge', SkillForgeRoutes);
```

---

## Phase 6: Frontend (Follow-up, not in initial scope)

The PRD notes frontend is informational and not required for backend to function. Initial implementation is backend-only. Frontend can be added later:

- SkillForge Dashboard page
- Skill version history with SES progression chart
- A/B test results visualization
- Goal detail → SkillForge analysis tab
- Settings panel

All data will be available through the REST API from Phase 4.

---

## File Summary

### New Files (6)

| # | File | Type | Est. Lines |
|---|------|------|------------|
| 1 | `backend/src/models/SkillVersionModel.js` | Model | ~80 |
| 2 | `backend/src/models/SkillEvalModel.js` | Model | ~90 |
| 3 | `backend/src/services/goal/TraceAnalyzer.js` | Service | ~150 |
| 4 | `backend/src/services/goal/SkillEvolver.js` | Service | ~250 |
| 5 | `backend/src/services/goal/SkillForgeOrchestrator.js` | Service | ~100 |
| 6 | `backend/src/routes/skillForgeRoutes.js` | Routes | ~80 |

**Total**: ~750 lines of new code

### Modified Files (2)

| File | Change |
|------|--------|
| `backend/src/models/database/index.js` | Add 2 CREATE TABLE statements |
| `backend/server.js` | Add 1 import + 1 app.use() for routes |

### Integration Hook (1)

| File | Change |
|------|--------|
| `backend/src/services/goal/TaskOrchestrator.js` | Add fire-and-forget SkillForge call after goal completion |

### Untouched Files

All existing services, models, and routes remain unchanged:
- GoalService, GoalProcessor, GoalEvaluator, TaskOrchestrator (beyond the 1-line hook)
- SkillService, SkillModel, AgentChatService (buildSkillsContext works as-is)
- GoldenStandardModel (used via existing API, no changes)
- All frontend code (Phase 6, follow-up)

---

## Implementation Order

```
1. SkillVersionModel.js + SkillEvalModel.js + schema migration
   └── Pure data layer, testable in isolation

2. TraceAnalyzer.js
   └── Depends on: existing models (GoalModel, TaskModel, etc.)
   └── Test: manually call with a completed goal ID

3. SkillEvolver.js
   └── Depends on: TraceAnalyzer, new models
   └── Test: manually trigger evolution, verify A/B test runs

4. SkillForgeOrchestrator.js
   └── Depends on: TraceAnalyzer, SkillEvolver
   └── Test: manual trigger via API

5. skillForgeRoutes.js + server.js registration
   └── Depends on: SkillForgeOrchestrator
   └── Test: hit endpoints via curl/Postman

6. TaskOrchestrator.js hook (1 line)
   └── Depends on: everything above working
   └── Test: complete a goal, verify SkillForge fires
```

---

## Key Design Decisions

1. **Fire-and-forget integration**: SkillForge never blocks goal execution. The hook is wrapped in `.catch()` so failures are logged but don't affect the user.

2. **Manual-first, auto-later**: Phase 1 is manual trigger via API. Auto-trigger (after every goal) is enabled via settings once the system is validated.

3. **User's own LLM**: TraceAnalyzer uses the user's configured AI provider (same as GoalEvaluator). No hardcoded model dependency.

4. **Sequential A/B tests**: Baseline runs first, then treatment. Not parallel — avoids resource contention and ensures fair comparison.

5. **Skill metadata over schema changes**: SkillForge status/stats stored in the existing `metadata` JSON column on skills table. No ALTER TABLE needed for the skills table.

6. **Reference goals are ephemeral**: A/B test goals are marked `type: 'skill_eval'` and deleted after the test. They never appear in the user's goal list.

7. **Binary keep/discard with minimum delta**: Delta must be >2.0 to keep a skill. Prevents accumulating skills that only improve by noise margin.

8. **Version superseding**: When a skill is refined (v1→v2), the old version is marked 'superseded' not deleted. Full lineage is preserved.
