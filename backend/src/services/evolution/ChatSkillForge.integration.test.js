// End-to-end: three identical chat turns produce a real skill row.
//
// The unit suite proves the DECISION logic with everything mocked. This proves
// the wiring against real SQLite — the extraction_gate counter, the real
// SkillEvolver, the real SkillModel/SkillVersionModel writes — because every
// interesting bug in this feature lives in the seams between those, not inside
// any one of them.
//
// Only the LLM judge is stubbed. Everything below it is the shipping code.
import { describe, it, expect, beforeAll, vi } from 'vitest';

const db = (await import('../../models/database/index.js')).default;
const { default: ChatSkillForge } = await import('./ChatSkillForge.js');
const { default: TraceAnalyzer } = await import('../goal/TraceAnalyzer.js');
const { default: SkillModel } = await import('../../models/SkillModel.js');
const { default: SkillVersionModel } = await import('../../models/SkillVersionModel.js');

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) { return err ? reject(err) : resolve(this); });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
});

const USER = 'user-forge-int';
const TOOLS = ['read_file', 'edit_file', 'execute_shell_command'];

// The judge's verdict, held constant so the test measures the pipeline rather
// than a model's mood. Instructions are deliberately rich enough to clear
// SkillEvolver._evaluateSkillQuality, which is real and still runs.
const VERDICT = {
  traceQuality: 'high',
  overallAssessment: 'Repeatable homelab deployment procedure.',
  patterns: [{ name: 'verify-before-restart', type: 'tool_sequence', effectiveness: 0.9 }],
  antipatterns: [],
  insights: [],
  skillCandidate: {
    shouldGenerate: true,
    confidence: 0.85,
    name: 'Homelab Operations',
    category: 'general',
    description: 'Deploy and verify homelab service changes',
    allowedTools: TOOLS,
    estimatedEffectiveness: 0.8,
    rationale: 'Extracted from three separate homelab sessions.',
    instructions: `# Homelab Operations

## Strategy
Read the current config first, then edit, then restart and verify.

## Steps
1. read_file the service unit and the config it references.
2. edit_file with the minimal change.
3. execute_shell_command to restart, then verify status before moving on.

## Anti-patterns
- Do not restart before verifying the edit parsed; a failed parse leaves the
  service down and the error is easy to miss.

## Recovery
If the restart fails, retry once, then roll the file back and report the error
rather than continuing. Handle a timeout as a failure, not as success.`,
  },
};

async function seedExecution(id) {
  await run(
    `INSERT INTO agent_executions (id, agent_id, agent_name, user_id, conversation_id, status,
       start_time, end_time, tool_calls_count, initial_prompt, final_response, provider, model)
     VALUES (?, NULL, 'Orchestrator', ?, ?, 'completed', ?, ?, ?, ?, ?, 'anthropic', 'claude-sonnet-4-5')`,
    [id, USER, `conv-${id}`, '2026-08-12T10:00:00Z', '2026-08-12T10:01:00Z', TOOLS.length,
      'redeploy the homelab dns container', 'Done — dns is back up and verified.']
  );
  for (const [i, toolName] of TOOLS.entries()) {
    await run(
      `INSERT INTO agent_tool_executions (id, execution_id, tool_name, status, input, output)
       VALUES (?, ?, ?, 'completed', ?, ?)`,
      // Arguments differ per run on purpose: the signature must ignore them, or
      // three real sessions against three different hosts would never converge.
      [`${id}-t${i}`, id, toolName, JSON.stringify({ path: `/etc/${id}.conf` }), '"ok"']
    );
  }
  await run(
    `INSERT OR IGNORE INTO conversation_logs (conversation_id, user_id, full_history)
     VALUES (?, ?, ?)`,
    [`conv-${id}`, USER, JSON.stringify([{ role: 'user', content: 'redeploy the homelab dns container' }])]
  );
}

const skillsFor = async () => (await SkillModel.findAll(USER)).filter((s) => !s.is_builtin);

beforeAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500)); // let createTables settle
  await run(`INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)`, [USER, 'forge@test.local', 'Forge']);
  for (const id of ['exec-a', 'exec-b', 'exec-c', 'exec-d']) await seedExecution(id);

  // Stub ONLY the model call. Gathering, gating, evolving and persisting are real.
  vi.spyOn(TraceAnalyzer, '_llmJudgeAnalysis').mockResolvedValue(VERDICT);
});

describe('three identical chats forge one skill', () => {
  it('writes nothing on the first two turns', async () => {
    expect(await ChatSkillForge.onChatCompleted('exec-a', USER)).toBeNull();
    expect(await ChatSkillForge.onChatCompleted('exec-b', USER)).toBeNull();
    expect(await skillsFor()).toHaveLength(0);
    expect(TraceAnalyzer._llmJudgeAnalysis).not.toHaveBeenCalled();
  });

  it('counts the repeats in extraction_gate under its own source_type', async () => {
    const row = await get(
      `SELECT occurrence_count, scope_id FROM extraction_gate
       WHERE user_id = ? AND source_type = 'chat_procedure'`, [USER]
    );
    expect(row.occurrence_count).toBe(2);
    expect(row.scope_id).toBe('orchestrator');
  });

  it('forges a real skill on the third', async () => {
    const result = await ChatSkillForge.onChatCompleted('exec-c', USER);
    expect(result.action).toBe('kept');

    const skills = await skillsFor();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('Homelab Operations');
    expect(skills[0].slug).toBe('homelab-operations');
    expect(skills[0].instructions).toContain('read_file the service unit');
  });

  it('records the conversation it came from as provenance', async () => {
    // Not a goal id. This is the whole point — the skill points back at the
    // chat that produced it, which is what makes the receipt inspectable later.
    const [skill] = await skillsFor();
    const meta = JSON.parse(skill.metadata);
    expect(meta.provenance['source-trace']).toBe('chat:exec-c');
    expect(meta.provenance.rationale).toContain('three separate homelab sessions');
  });

  it('lands as a DRAFT — it could not be A/B tested, so it is not claimed as validated', async () => {
    // A chat cannot be re-run against a baseline, so there is no measured delta
    // to promote on. Marking it validated anyway would be the dishonest version
    // of this feature.
    const [skill] = await skillsFor();
    expect(JSON.parse(skill.metadata).skillforge.status).toBe('draft');
  });

  it('is live in the catalog immediately, not quarantined', async () => {
    // SkillModel.findAll has no status filter, so a draft is already visible to
    // the next turn's skill catalog. That is what makes the loop closed: forged,
    // then usable, with no approval step.
    const names = (await SkillModel.findAll(USER)).map((s) => s.name);
    expect(names).toContain('Homelab Operations');
  });

  it('has a version-1 record for lineage and revert', async () => {
    const [skill] = await skillsFor();
    const versions = await SkillVersionModel.findBySkillId(skill.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].source_goal_id).toBe('chat:exec-c');
    expect(versions[0].status).toBe('active');
  });

  it('goes quiet on the fourth identical turn instead of forging a duplicate', async () => {
    expect(await ChatSkillForge.onChatCompleted('exec-d', USER)).toBeNull();
    expect(await skillsFor()).toHaveLength(1);
  });

  it('called the judge exactly once across four turns', async () => {
    // The cost argument for shipping this on by default. Four turns, one model
    // call — and that one only after the user had genuinely repeated themselves.
    expect(TraceAnalyzer._llmJudgeAnalysis).toHaveBeenCalledTimes(1);
  });
});
