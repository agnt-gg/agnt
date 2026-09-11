// Diagnostics are evidence, never success or permission to replay an effect.
function text(value,limit=2000) {
  if(typeof value!=='string')return null;
  return value.replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]')
    .replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]+/g,'[redacted]')
    .replace(/([?&](?:token|key|signature|access_token|api_key)=)[^&\s]+/gi,'$1[redacted]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]').slice(0,limit);
}
export function failureDiagnostic(error) {
  const tools=error?.toolExecutions||error?.tool_executions||[];
  return {message:text(error?.message)||'Execution failed; no diagnostic message available',
    code:text(error?.code,100),name:text(error?.name,100),
    // Do not serialize stacks, tool arguments/results, credentials, or arbitrary Error objects.
    tools:Array.isArray(tools)?tools.slice(-20).map(t=>({name:text(t?.name||t?.toolName,100),status:text(t?.status,80)})):[],
    toolReceiptsAvailable:Array.isArray(tools)&&tools.length>0,
    checkpointEvidence:'Inspect the durable run checkpoint and retained artifacts; diagnostics do not resolve external effects.'};
}
export function validatePartialContinuation(d) {
  if(d.workerStopped!==true||d.effectsReconciled!==true)throw Error('Confirm worker termination and reconciliation of every external effect');
  if(typeof d.attemptId!=='string'||!d.attemptId)throw Error('Exact interrupted attempt required');
  if(typeof d.remainingWork!=='string'||d.remainingWork.trim().length<3||d.remainingWork.length>12000)throw Error('Bounded remaining-work instructions required');
  if(!Array.isArray(d.doNotRepeat)||!d.doNotRepeat.length||d.doNotRepeat.length>100||d.doNotRepeat.some(v=>typeof v!=='string'||!v.trim()||v.length>2000))throw Error('Explicit no-repeat instructions required');
  if(!Array.isArray(d.artifacts)||!d.artifacts.length||d.artifacts.length>100||d.artifacts.some(a=>!a||typeof a.path!=='string'||!a.path.trim()||a.path.length>4096||typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(a.sha256)))throw Error('Reviewed artifact paths and SHA-256 hashes required');
}
