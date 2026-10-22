// Schedules are paid whatever they run. Until 2026-10-21 only a schedule that
// ran a GOAL was refused for a free account; one that ran a workflow or an
// agent kept firing after the plan lapsed.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('../auth/licence.js', async (original) => ({ ...(await original()), verifiedPlan: async () => 'free' }));

const { default: db, dbReady } = await import('../../models/database/index.js');
const { default: ScheduleModel } = await import('../../models/ScheduleModel.js');
const { default: SchedulerService } = await import('./SchedulerService.js');

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, (err) => (err ? reject(err) : resolve())));
let user;
const executor = vi.fn(async () => ({ status: 'completed' }));

beforeAll(async () => {
  await dbReady;
  user = randomUUID();
  await run('INSERT INTO users (id, email) VALUES (?, ?)', [user, `${user}@test.local`]);
});

describe('a free account', () => {
  for (const kind of ['workflow', 'agent', 'goal']) {
    it(`does not fire a ${kind} schedule`, async () => {
      const targetType = `plan-gate-${kind}`;
      SchedulerService.registerExecutor(targetType, executor);
      const id = await ScheduleModel.create({ userId: user, targetType, targetId: 'x', cron: '0 9 * * *', timezone: 'UTC', nextRun: null, enabled: true, onMissed: 'skip' });
      // _startRun decides whether a schedule fires (_fireOne only awaits it).
      const result = await SchedulerService._startRun(await ScheduleModel.findOne(id), new Date());
      expect(result).toMatchObject({ fired: false, reason: 'upgrade_required' });
      expect(executor).not.toHaveBeenCalled();
    });
  }
});
