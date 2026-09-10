import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('../../models/GoalModel.js',()=>({default:{findOne:vi.fn()}}));
vi.mock('../../models/TaskModel.js',()=>({default:{findOne:vi.fn(),updateStatus:vi.fn()}}));
vi.mock('../../utils/realtimeSync.js',()=>({broadcastToUser:vi.fn(),RealtimeEvents:{GOAL_TASK_UPDATED:'task'}}));
import Goal from '../../models/GoalModel.js';import Task from '../../models/TaskModel.js';import {updateTaskRecord} from './updateTaskRecord.js';
beforeEach(()=>{vi.clearAllMocks();Goal.findOne.mockResolvedValue({id:'g',user_id:'u'});Task.findOne.mockResolvedValue({id:'t',goal_id:'g',status:'completed',progress:100});Task.updateStatus.mockResolvedValue(1);});
describe('persisted task updates, never simulated success',()=>{
 it('Given a valid update, Then persist and verify without replacing output',async()=>{Task.findOne.mockResolvedValueOnce({id:'t',goal_id:'g',status:'completed',progress:100}).mockResolvedValueOnce({id:'t',goal_id:'g',status:'failed',progress:0});expect((await updateTaskRecord({goal_id:'g',task_id:'t',status:'failed',progress:0},'u')).success).toBe(true);expect(Task.updateStatus.mock.calls[0][6]).toBeNull();});
 it('Given no changed row, Then no success',async()=>{Task.updateStatus.mockResolvedValue(0);await expect(updateTaskRecord({goal_id:'g',task_id:'t',status:'failed'},'u')).rejects.toThrow(/persist/);});
 it('Given wrong goal owner, Then no write',async()=>{await expect(updateTaskRecord({goal_id:'g',task_id:'t'},'other')).rejects.toThrow();expect(Task.updateStatus).not.toHaveBeenCalled();});
 it('Given task belongs elsewhere, Then no write',async()=>{Task.findOne.mockResolvedValue({id:'t',goal_id:'other'});await expect(updateTaskRecord({goal_id:'g',task_id:'t'},'u')).rejects.toThrow();expect(Task.updateStatus).not.toHaveBeenCalled();});
 it('Given readback mismatch, Then report failure',async()=>{await expect(updateTaskRecord({goal_id:'g',task_id:'t',status:'failed'},'u')).rejects.toThrow(/readback/);});
});
