import { scanOutput } from '../security/nopeService.js';

// Returned receipts are evidence, not authority or proof of tool effects.
// The shared scanner can fail open. Describe processing, never guaranteed secrecy.
export function processReturnedReceipts(rows, measured) {
  let omitted = false, nodes = 0;
  const project = (value, depth = 0) => {
    if (++nodes > 2000 || depth > 8) { omitted = true; return '[omitted:limit]'; }
    if (typeof value === 'string') {
      if (value.length > 8192 || /[A-Za-z0-9+/]{512,}/.test(value)) { omitted = true; return '[omitted:large-or-encoded]'; }
      try { return project(JSON.parse(value), depth + 1); } catch { return value; }
    }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (Array.isArray(value)) { if(value.length > 50) omitted = true; return value.slice(0,50).map(v=>project(v,depth+1)); }
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
      const entries = Object.entries(value); if(entries.length > 50) omitted = true;
      return Object.fromEntries(entries.slice(0,50).map(([k,v]) => {
        // Scanner audit paths contain keys: never send arbitrary keys to it.
        const safeKey = /^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/.test(k) ? k : 'omitted_key';
        if (safeKey !== k || /auth|secret|token|password|credential|api.?key|cookie/i.test(k)) { omitted = true; return [safeKey,'[omitted:sensitive-field]']; }
        return [safeKey,project(v,depth+1)];
      }));
    }
    omitted = true; return '[omitted:unsupported]';
  };
  const valid = Array.isArray(rows);
  const receipts = valid ? rows.slice(0,50).map(row => {
    if (!row || typeof row.name !== 'string' || !Object.hasOwn(row,'response')) { omitted = true; return {availability:'malformed'}; }
    return project({name:row.name, callId:row.callId ?? null, input:row.arguments, output:row.response});
  }) : [];
  const beforeScan = JSON.stringify(receipts);
  const processed = scanOutput(receipts,'saved_agent_receipt','enforce','audit');
  const transformed = JSON.stringify(processed) !== beforeScan;
  const rowCoverage = valid && rows.length <= 50 && rows.length === measured?.toolCalls?.finished && measured?.toolCalls?.inFlight === 0 ? 'returned_set_complete' : 'partial_or_unknown';
  const envelope = {version:1,policy:'bounded-enforce-v1',scannerAssurance:'best_effort_not_guaranteed',
    rowCoverage,contentDisposition:omitted?'omitted':transformed?'transformed':'unchanged',
    completeness:rowCoverage==='returned_set_complete' && !omitted && !transformed ? 'returned_set_complete' : 'partial_or_unknown',receipts:processed};
  if(Buffer.byteLength(JSON.stringify(envelope)) > 65536) return {...envelope,completeness:'partial_or_unknown',contentDisposition:'omitted',receipts:[],omission:'envelope_limit'};
  return envelope;
}

export function returnedOutcome(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.content !== 'string' || (!result.content.trim() && result.executionTelemetry?.outcome !== 'completed')) return 'failed';
  if (['status','outcome'].some(k=>Object.hasOwn(result,k)&&typeof result[k]!=='string') || (Object.hasOwn(result,'success')&&typeof result.success!=='boolean')) return 'failed';
  const states = [result.status,result.outcome,result.executionTelemetry?.outcome].filter(x=>typeof x==='string').map(x=>x.toLowerCase());
  for (const state of ['cancelled','blocked','pending','failed']) if(states.includes(state)) return state;
  if(result.success === false || result.error || states.some(x=>!['completed','success'].includes(x))) return 'failed';
  return 'completed';
}

// Host-owned association: arbitrary properties on exceptions are not receipt provenance.
const failureReceipts = new WeakMap();
export function retainFailureReceipts(error, rows, measured) {
  try { failureReceipts.set(error, processReturnedReceipts(rows, measured)); }
  catch { /* Unknown receipt availability; never preserve raw fallback. */ }
}
export function takeFailureReceipts(error) {
  const value = failureReceipts.get(error) ?? null;
  failureReceipts.delete(error);
  return value;
}

export function readReturnedReceipts(raw) {
  if(raw == null)return {availability:'unavailable',value:null};
  try {
    if(typeof raw !== 'string' || Buffer.byteLength(raw)>65536)throw new Error('size');
    const r=JSON.parse(raw);
    if(r?.version!==1 || r.policy!=='bounded-enforce-v1' || !['returned_set_complete','partial_or_unknown'].includes(r.completeness) || !Array.isArray(r.receipts) || r.receipts.length>50)throw new Error('shape');
    if(r.receipts.some(x=>!x || typeof x!=='object' || (x.availability!=='malformed' && (typeof x.name!=='string'||!Object.hasOwn(x,'output')))))throw new Error('receipt');
    const processed=processReturnedReceipts(r.receipts.filter(x=>x.availability!=='malformed').map(x=>({name:x.name,callId:x.callId,arguments:x.input,response:x.output})),null);
    const degraded=r.receipts.some(x=>x.availability==='malformed') || processed.contentDisposition!=='unchanged';
    const complete=r.completeness==='returned_set_complete' && r.rowCoverage==='returned_set_complete' && r.contentDisposition==='unchanged' && !degraded;
    return {availability:'available',value:{...processed,
      rowCoverage:r.rowCoverage==='returned_set_complete'&&!r.receipts.some(x=>x.availability==='malformed')?'returned_set_complete':'partial_or_unknown',
      contentDisposition:processed.contentDisposition!=='unchanged'?processed.contentDisposition:['omitted','transformed','unchanged'].includes(r.contentDisposition)?r.contentDisposition:'unknown',
      completeness:complete?'returned_set_complete':'partial_or_unknown'}};
  } catch { return {availability:'invalid',value:null}; }
}
