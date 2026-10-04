import { observeExecution } from '../learning/learningRuntime.js';

/** Compatibility names for existing completion hooks. Evidence collection only: no LLM extraction, forging or apply sweep. */
class InsightTriggers {
  static async onChatCompleted(executionId,userId) { return this._observe('agent',executionId,userId); }
  static async onGoalCompleted(goalId,userId) { return this._observe('goal',goalId,userId); }
  static async onWorkflowExecutionCompleted(executionId,userId) { return this._observe('workflow',executionId,userId); }
  static async onPeriodicRollup() { return []; }
  static async _observe(type,id,userId) {
    try { return await observeExecution(type,id,userId); }
    catch(error) { console.error('[Learning] Completion evidence failed:',error.code||error.message);return null; }
  }
}
export default InsightTriggers;
