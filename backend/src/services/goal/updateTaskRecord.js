import GoalModel from '../../models/GoalModel.js';
import TaskModel from '../../models/TaskModel.js';
import { broadcastToUser, RealtimeEvents } from '../../utils/realtimeSync.js';

export async function updateTaskRecord(args, userId) {
  if (!userId) throw new Error('Authenticated user context required');
  const goal = await GoalModel.findOne(args.goal_id);
  if (!goal || goal.user_id !== userId) throw new Error('Goal not found');
  const task = await TaskModel.findOne(args.task_id);
  if (!task || task.goal_id !== goal.id) throw new Error('Task not found in goal');
  if (args.status !== undefined && !['pending','running','completed','failed','paused'].includes(args.status)) throw new Error('Invalid task status');
  if (args.progress !== undefined && (!Number.isFinite(args.progress) || args.progress < 0 || args.progress > 100)) throw new Error('Invalid task progress');
  const changed = await TaskModel.updateStatus(task.id,args.status ?? task.status,args.progress ?? null,null,null,null,args.output ?? null,args.error ?? null);
  if (changed !== 1) throw new Error('Task update did not persist');
  const after = await TaskModel.findOne(task.id);
  if (!after || after.goal_id !== goal.id || (args.status !== undefined && after.status !== args.status) || (args.progress !== undefined && after.progress !== args.progress)) throw new Error('Task update readback mismatch');
  broadcastToUser(userId,RealtimeEvents.GOAL_TASK_UPDATED,{goalId:goal.id,taskId:task.id,status:after.status,progress:after.progress});
  return {success:true,goal_id:goal.id,task_id:task.id,status:after.status,progress:after.progress,message:'Task status persisted and verified'};
}
