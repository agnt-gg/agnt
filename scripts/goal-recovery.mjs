#!/usr/bin/env node
// Operator surface: uses the supplied AGNT token; never searches credential stores.
import fs from 'node:fs/promises';
const [command,goalId,evidenceFile]=process.argv.slice(2);
if(!['inspect','resolve'].includes(command)||!goalId||(command==='resolve'&&!evidenceFile)){
 console.error('Usage: node scripts/goal-recovery.mjs inspect GOAL_ID\n       node scripts/goal-recovery.mjs resolve GOAL_ID evidence.json\nRequires AGNT_AUTH_TOKEN. Resolve records evidence; it does not start the goal.');process.exit(2);
}
if(!process.env.AGNT_AUTH_TOKEN){console.error('AGNT_AUTH_TOKEN required');process.exit(2)}
let body;
if(command==='resolve'){
 const stat=await fs.stat(evidenceFile);if(stat.size>1000000)throw Error('Evidence JSON exceeds 1 MB');
 body=JSON.parse(await fs.readFile(evidenceFile,'utf8'));
 if(typeof body.runId!=='string'||typeof body.evidence!=='string'||!Array.isArray(body.decisions))throw Error('Evidence requires runId, evidence, decisions');
}
const endpoint='http://127.0.0.1:3333/api/goals/'+encodeURIComponent(goalId)+'/recovery'+(command==='resolve'?'/resolve':'');
const response=await fetch(endpoint,{method:command==='resolve'?'POST':'GET',headers:{Authorization:'Bearer '+process.env.AGNT_AUTH_TOKEN,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
const result=await response.json();console.log(JSON.stringify(result,null,2));if(!response.ok)process.exitCode=1;
