import { codexImageChoiceStatus } from '../backend/src/services/ai/codexImageIntent.js';
import { codexImageRequestSelection } from '../backend/src/services/ai/codexImageCandidates.js';
const status = codexImageChoiceStatus();
const checks = ['latest','latest-fast'].map(policy => ({ policy, ...codexImageRequestSelection(policy), experimental: true }));
const distinct = new Set(checks.map(c => c.resolvedModel)).size === 2;
const experimentalRequestReady = distinct && status.choices.every(choice => choice.available === true);
console.log(JSON.stringify({ checkedAt:new Date().toISOString(),checks,experimentalRequestReady,
  verifiedTwoModeRelease: false, selectionVerified: status.subscriptionSelectionVerified,
  liveRequests:0, note:'Request wiring is inspectable. This is not an empirical quality/speed evaluation, provider identity certification or complete release acceptance. No API billing fallback.' },null,2));
process.exitCode = experimentalRequestReady && process.argv.includes('--experimental') ? 0 : 2;
