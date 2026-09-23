// Versioned, content-free measurements. Never serialize arbitrary error/context objects.
const roles = ['system', 'user', 'assistant', 'tool'];
const number = x => Number.isSafeInteger(x) && x >= 0;
const metricKeys = ['requestIndex','messageBytes','schemaBytes','totalBytes','systemBytes','userBytes','toolBytes','assistantBytes'];
const outcomes = ['completed','failed','blocked','cancelled','pending'];
export function normalizeExecutionTelemetry(value) {
  if (!value || value.version !== 1 || !outcomes.includes(value.outcome)) throw new Error('Invalid execution telemetry version/outcome');
  const metric = value.requestMetrics;
  let requestMetrics = null;
  if (metric != null) {
    if (metric.boundary !== 'adapter_input_json_utf8' || !Array.isArray(metric.requests) || metric.requests.length > 1000) throw new Error('Invalid request telemetry');
    const requests = metric.requests.map((r,i) => {
      if (metricKeys.some(k => !number(r[k])) || r.requestIndex !== i+1 || r.totalBytes !== r.messageBytes+r.schemaBytes) throw new Error('Invalid request measurement');
      return Object.fromEntries(metricKeys.map(k=>[k,r[k]]));
    });
    requestMetrics = {boundary:'adapter_input_json_utf8',tokenCount:'not_measured',requests,
      peakBytes:Math.max(0,...requests.map(r=>r.totalBytes)),aggregateBytes:requests.reduce((n,r)=>n+r.totalBytes,0)};
    if (!number(requestMetrics.aggregateBytes)) throw new Error('Invalid aggregate measurement');
  }
  const u=value.usage;
  const usage=u==null?null:Object.fromEntries(['inputTokens','outputTokens','totalTokens'].map(k=>{
    if(u[k]!==null&&!number(u[k]))throw new Error('Invalid usage measurement');return [k,u[k]];
  }));
  const coverage=['complete','partial','unknown'].includes(value.usageCoverage)?value.usageCoverage:'unknown';
  const t=value.toolCalls;
  const toolCalls=t==null?null:Object.fromEntries(['started','finished','inFlight'].map(k=>{
    if(!number(t[k]))throw new Error('Invalid tool measurement');return [k,t[k]];
  }));
  if(toolCalls && toolCalls.started!==toolCalls.finished+toolCalls.inFlight)throw new Error('Inconsistent tool measurement');
  return {version:1,outcome:value.outcome,requestMetrics,usage,usageCoverage:coverage,toolCalls,
    effectDisposition:toolCalls===null?'unknown':toolCalls.started===0?'no_tool_calls_dispatched':toolCalls.inFlight>0?'in_flight_or_unknown':'tool_calls_observed_effects_not_verified'};
}
export function unavailableTelemetry(outcome='failed') {
  return normalizeExecutionTelemetry({version:1,outcome,requestMetrics:null,usage:null,usageCoverage:'unknown',toolCalls:null});
}
export function readExecutionTelemetry(raw) {
  if(raw==null)return {availability:'unavailable',value:null};
  try{return {availability:'available',value:normalizeExecutionTelemetry(typeof raw==='string'?JSON.parse(raw):raw)};}
  catch{return {availability:'invalid',value:null};}
}
export function createExecutionTelemetry() {
  const requests=[];let started=0,finished=0,usageReplies=0;
  const totals={inputTokens:0,outputTokens:0,totalTokens:0},seen={inputTokens:0,outputTokens:0,totalTokens:0};
  return {
    request(messages,schemas){
      if(requests.length>=1000)throw new Error('Execution request telemetry limit reached');
      const bytes=x=>Buffer.byteLength(JSON.stringify(x));
      const row={requestIndex:requests.length+1,messageBytes:bytes(messages),schemaBytes:bytes(schemas)};
      row.totalBytes=row.messageBytes+row.schemaBytes;
      for(const role of roles)row[role+'Bytes']=messages.filter(m=>m.role===role).reduce((n,m)=>n+bytes(m),0);
      requests.push(row);
    },
    usage(u){
      if(!u)return;
      const input=u.inputTokens??u.prompt_tokens??u.input_tokens, output=u.outputTokens??u.completion_tokens??u.output_tokens;
      const total=u.totalTokens??u.total_tokens??(number(input)&&number(output)?input+output:null);
      let supplied=false;
      for(const [k,v] of Object.entries({inputTokens:input,outputTokens:output,totalTokens:total}))if(number(v)){totals[k]+=v;seen[k]++;supplied=true;}
      if(supplied)usageReplies++;
    },
    toolStarted(){started++;},toolFinished(){finished++;},
    snapshot(outcome){return normalizeExecutionTelemetry({version:1,outcome,
      requestMetrics:{boundary:'adapter_input_json_utf8',requests},
      usage:usageReplies?Object.fromEntries(Object.keys(totals).map(k=>[k,seen[k]?totals[k]:null])):null,
      usageCoverage:usageReplies===0?'unknown':Object.values(seen).every(n=>n===requests.length)?'complete':'partial',
      toolCalls:{started,finished,inFlight:started-finished}});}
  };
}

// Host provenance for failure measurements; arbitrary exception properties are not trusted.
const failureTelemetry = new WeakMap();
export function retainFailureTelemetry(error, measured) { failureTelemetry.set(error,normalizeExecutionTelemetry(measured)); }
export function takeFailureTelemetry(error) { const measured=failureTelemetry.get(error)??null;failureTelemetry.delete(error);return measured; }
