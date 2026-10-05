import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../models/ScheduleModel.js', () => ({ default: { updateAfterRun: vi.fn().mockResolvedValue(), startRun: vi.fn().mockResolvedValue(null), setEnabled: vi.fn().mockResolvedValue() } }));
vi.mock('../auth/planEntitlements.js', () => ({ canRunScheduledGoals: vi.fn() }));
import SchedulerService from './SchedulerService.js';
import ScheduleModel from '../../models/ScheduleModel.js';
import { canRunScheduledGoals } from '../auth/planEntitlements.js';
beforeEach(() => { vi.clearAllMocks(); SchedulerService._userResolver=null; });
it('does not execute a scheduled goal or allocate a run for a free owner', async () => {
  canRunScheduledGoals.mockResolvedValue(false);
  const execute=vi.fn();SchedulerService.registerExecutor('goal',execute);
  const result=await SchedulerService._startRun({id:'s',user_id:'free-owner',target_type:'goal',target_id:'g',cron:'0 9 * * *',timezone:'UTC'},new Date());
  expect(canRunScheduledGoals).toHaveBeenCalledWith('free-owner');expect(result).toEqual({fired:false,reason:'upgrade_required'});
  expect(execute).not.toHaveBeenCalled();expect(ScheduleModel.startRun).not.toHaveBeenCalled();
  expect(ScheduleModel.updateAfterRun).toHaveBeenCalledWith('s',expect.objectContaining({status:'upgrade_required'}));
});
it('runs a paid owner independently of the active browser account', async () => {
  canRunScheduledGoals.mockResolvedValue(true);const execute=vi.fn().mockResolvedValue({status:'completed'});
  SchedulerService.registerExecutor('goal',execute);
  const result=await SchedulerService._startRun({id:'s',user_id:'paid-owner',target_type:'goal',target_id:'g',cron:'0 9 * * *',timezone:'UTC'},new Date());
  await result.completion;expect(canRunScheduledGoals).toHaveBeenCalledWith('paid-owner');expect(execute).toHaveBeenCalledWith('g','paid-owner',expect.any(Object));
});
