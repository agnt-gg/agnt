import { createHash } from 'node:crypto';

export const SCHEMA_VERSION = 1;
export const READ_ONLY_CAPABILITIES = Object.freeze(['read_file', 'list_files', 'glob_files', 'grep_files', 'query_data', 'get_trace']);
export const TRANSIENT_ERRORS = Object.freeze(['timeout', 'unavailable']);
export const WORK_STATES = Object.freeze(['received','running','completed','failed','blocked','cancelled','interrupted']);
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const learningError = (code, status = 400) => Object.assign(new Error(code), { code, status });

export function errorKind(value) {
  const text = String(value || '').toLowerCase();
  if (/unauthor|401|credential|authentication/.test(text)) return 'authentication';
  if (/forbidden|permission|403|eperm|policy.block/.test(text)) return 'permission';
  if (/timeout|timed out|etimedout/.test(text)) return 'timeout';
  if (/econnreset|econnrefused|temporarily unavailable|service unavailable|502|503|504/.test(text)) return 'unavailable';
  if (/429|rate.limit/.test(text)) return 'rate_limit';
  if (/enoent|not found|does not exist/.test(text)) return 'missing_resource';
  if (/invalid|validation|schema|argument/.test(text)) return 'invalid_input';
  return 'other';
}

export function toolOutcome(result, thrown) {
  if (thrown) return { outcome: 'failed', errorKind: errorKind(thrown.code || thrown.message) };
  let output = result;
  for(let depth=0;depth<2&&typeof output==='string';depth++) { try { output = JSON.parse(output); } catch { return { outcome: 'unknown', errorKind: null }; } }
  if (!output || typeof output !== 'object') return { outcome: 'unknown', errorKind: null };
  if (output.policy_blocked) return { outcome: 'blocked', errorKind: 'permission' };
  if (output.success === false || output.error || ['failed','blocked','error'].includes(output.status)) {
    return { outcome: output.status === 'blocked' ? 'blocked' : 'failed', errorKind: errorKind(output.code || output.error) };
  }
  return { outcome: output.success === true ? 'succeeded' : 'unknown', errorKind: null };
}

export function canonicalCandidate(capability, kind) {
  if (!READ_ONLY_CAPABILITIES.includes(capability) || !TRANSIENT_ERRORS.includes(kind)) throw learningError('unsupported_candidate');
  return { schema_version: 1, when: { capability, error_kind: kind }, action: { type: 'retry_read_only', max_retries: 1 } };
}

export function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw learningError('invalid_event');
  const allowed = ['eventKey','type','capability','outcome','errorKind','trialId','occurredAt','payload'];
  if (Object.keys(event).some(key => !allowed.includes(key))) throw learningError('unknown_event_field');
  if (typeof event.eventKey !== 'string' || event.eventKey.length > 200 || !event.eventKey) throw learningError('invalid_event_key');
  if (!['work_state','tool_attempt','tool_outcome','policy_exposure','trial_state'].includes(event.type)) throw learningError('invalid_event_type');
  if (event.capability != null && !/^[a-zA-Z0-9_.:-]{1,120}$/.test(event.capability)) throw learningError('invalid_capability');
  if (event.outcome != null && !['succeeded','failed','blocked','unknown',...WORK_STATES].includes(event.outcome)) throw learningError('invalid_outcome');
  if (event.errorKind != null && !['authentication','permission','timeout','unavailable','rate_limit','missing_resource','invalid_input','other'].includes(event.errorKind)) throw learningError('invalid_error_kind');
  if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) throw learningError('invalid_event_time');
  const payload = event.payload ?? {};
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.getPrototypeOf(payload)!==Object.prototype)throw learningError('invalid_event_payload');
  if(event.trialId!==undefined&&event.trialId!==null&&(typeof event.trialId!=='string'||event.trialId.length>100))throw learningError('invalid_trial_reference');
  if(['tool_attempt','tool_outcome','policy_exposure'].includes(event.type)&&(!event.capability||!event.outcome))throw learningError('incomplete_tool_event');
  if (Object.keys(payload).some(key => !['durationMs','attempts','recovered','sourceRevision','candidateHash','from','to','reason'].includes(key))) throw learningError('invalid_event_payload');
  for (const key of ['durationMs','attempts','sourceRevision']) if (payload[key] !== undefined && (!Number.isSafeInteger(payload[key]) || payload[key] < 0)) throw learningError('invalid_measurement');
  if (payload.recovered !== undefined && typeof payload.recovered !== 'boolean') throw learningError('invalid_measurement');
  for (const key of ['candidateHash','from','to','reason']) if (payload[key] !== undefined && (typeof payload[key] !== 'string' || payload[key].length > 200)) throw learningError('invalid_measurement');
  if (JSON.stringify(payload).length > 2000) throw learningError('event_too_large');
  return { ...event, payload };
}

function wilson(cohort) {
  if(!cohort.eligible)return null;
  const n=cohort.eligible,p=cohort.failed/n,z=1.96,denominator=1+z*z/n;
  const center=(p+z*z/(2*n))/denominator;
  const spread=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denominator;
  return {low:Math.max(0,center-spread),high:Math.min(1,center+spread)};
}
export function scoreTrial(baseline, candidate, minimumSamples) {
  const rate = cohort => cohort.eligible > 0 ? cohort.failed / cohort.eligible : null;
  const before = rate(baseline), after = rate(candidate);
  const enough = baseline.eligible >= minimumSamples && candidate.eligible >= minimumSamples && candidate.unknown === 0 && baseline.unknown === 0 && baseline.independent_runs >= 2 && candidate.independent_runs >= 2 && !candidate.incomplete_exposures;
  const delta = before == null || after == null ? null : before - after;
  const intervals={baseline:wilson(baseline),candidate:wilson(candidate)};
  const clearlyBetter=intervals.baseline&&intervals.candidate&&intervals.candidate.high<intervals.baseline.low;
  const clearlyWorse=intervals.baseline&&intervals.candidate&&intervals.candidate.low>intervals.baseline.high;
  const verdict = !enough ? 'inconclusive' : delta >= 0.1 && clearlyBetter ? 'supported' : clearlyWorse ? 'regressed' : 'no_clear_benefit';
  return { method: 'observational_before_after', verdict, before, after, delta, intervals, baseline, candidate,
    explanation: !enough ? 'Not enough known, exposed outcomes to review this change.' : 'Failure-rate comparison on eligible calls; this is observational, not causal proof.' };
}
