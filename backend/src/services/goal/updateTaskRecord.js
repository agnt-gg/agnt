import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import { broadcastToUser, RealtimeEvents } from '../../utils/realtimeSync.js';

export async function updateTaskRecord(args, userId) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid task update');
  const requested = structuredClone(args);
  args = requested;
  if (!userId) throw new Error('Authenticated user context required');
  const goal = await GoalModel.findOne(args.goal_id);
  if (!goal || goal.user_id !== userId) throw new Error('Goal not found');
  const task = await TaskModel.findOne(args.task_id);
  if (!task || task.goal_id !== goal.id) throw new Error('Task not found in goal');
  if (args.status !== undefined && !['pending','running','completed','failed','paused'].includes(args.status)) throw new Error('Invalid task status');
  if (args.progress !== undefined && (!Number.isFinite(args.progress) || args.progress < 0 || args.progress > 100)) throw new Error('Invalid task progress');
  let committed = false;
  try {
  const changed = await TaskModel.updateStatus(task.id,args.status ?? task.status,args.progress ?? null,null,null,null,args.output ?? null,args.error ?? null,{goalId:goal.id,userId,revision:task.lifecycle_revision});
  if (changed !== 1) throw Object.assign(new Error('Task update did not persist'), {code:'TASK_NOT_UPDATED',writeState:'not_applied',retryable:false});
  committed = true;
  const after = await TaskModel.findOne(task.id);
  if (!after || after.goal_id !== goal.id || (args.status !== undefined && after.status !== args.status) || (args.progress !== undefined && after.progress !== args.progress)) throw new Error('Task update readback mismatch');
  if (args.output !== undefined && args.output !== null && after.output !== JSON.stringify(args.output)) throw new Error('Task output readback mismatch');
  if (args.error !== undefined && args.error !== null && after.error !== args.error) throw new Error('Task error readback mismatch');
  let notificationDelivered = true;
  try { broadcastToUser(userId,RealtimeEvents.GOAL_TASK_UPDATED,{goalId:goal.id,taskId:task.id,status:after.status,progress:after.progress}); } catch { notificationDelivered = false; }
  return {success:true,notificationDelivered,goal_id:goal.id,task_id:task.id,status:after.status,progress:after.progress,message:'Task status persisted and verified'};
  } catch (error) {
    if (error.code === 'TASK_NOT_UPDATED') throw error;
    throw Object.assign(new Error(`Task write ${committed ? 'committed but verification failed' : 'outcome unknown'}; inspect before retrying: ${error.message}`), {code:'TASK_UPDATE_UNCERTAIN',writeState:committed?'committed':'unknown',retryable:false});
  }
}
