import assert from 'node:assert/strict';
import { codexImageChoiceStatus } from '../backend/src/services/ai/codexImageIntent.js';
const status = codexImageChoiceStatus();
const checks = [];
for (const policy of ['latest', 'latest-fast']) {
  try {
    assert.equal(status.choices.find(choice => choice.policy === policy)?.available, true,
      `${policy}: no verified subscription selection mechanism; generation cannot be certified`);
    checks.push({ policy, status: 'PASS' });
  } catch (error) { checks.push({ policy, status: 'BLOCKED', reason: error.message.split('\n')[0] }); }
}
console.log(JSON.stringify({ test: 'Given both image policies, When checking release readiness, Then both are supported',
  checkedAt: new Date().toISOString(), checks, ready: checks.every(check => check.status === 'PASS'),
  liveRequests: 0, evidence: status.evidence,
  note: 'Passing this necessary capability gate alone would not prove UI dogfood or provider billing. Full acceptance still requires those separate receipts.' }, null, 2));
if (checks.some(check => check.status !== 'PASS')) process.exitCode = 2;
