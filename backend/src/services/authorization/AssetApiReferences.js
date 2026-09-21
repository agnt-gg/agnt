const tables={agents:'agents',workflows:'workflows','custom-tools':'tools','content-outputs':'content_outputs',goals:'goals','widget-definitions':'widget_definitions',skills:'skills',experiments:'experiments',groups:'groups',schedules:'schedules',wallets:'wallets',contracts:'contracts',mutations:'mutation_history',insights:'insights'};
const reserved=new Set(['health','summary','save','create','import','datasets','benchmarks','preview','root','read-all','reorder','bulk-move','check','stats','settings','route','rollup','memory','eligible-goals','evaluations','leaderboard','target','source','workflow','tool','by-conversation','golden-standards']);
export function assetApiReferences(path,body={}){
 const parts=path.split('/').filter(Boolean).map(part=>{try{return decodeURIComponent(part);}catch{throw Object.assign(new Error('Invalid resource path'),{status:400});}});if(parts[0]==='api')parts.shift();
 const [api,id,...tail]=parts;const result=[];
 const add=(table,value)=>{if(typeof value==='string'&&value)result.push({table,id:value});};
 if(tables[api]&&id&&!reserved.has(id))add(tables[api],id);
 if(api==='experiments'&&id==='datasets'&&tail[0]&&!['generate'].includes(tail[0]))add('eval_datasets',tail[0]);
 if(api==='executions'){if(id==='agents'&&tail[0]&&!['list','clear-completed'].includes(tail[0]))add('agent_executions',tail[0]);else if(id&&!['activity','streak','conversation','agents'].includes(id))add('workflow_executions',id);}
 if(api==='insights'&&id==='memory'&&tail[0]==='entry')add('agent_memory',tail[1]);
 if(api==='memory'&&id==='trace')add('agent_executions',tail[0]);
 if(api==='skillforge'&&id==='skill')add('skills',tail[0]);
 if(api==='webhooks'&&id==='workflow')add('workflows',tail[0]);
 if(['save','create'].includes(id)){
  if(api==='agents')add('agents',body.agent?.id);if(api==='workflows')add('workflows',body.workflow?.id);if(api==='custom-tools')add('tools',body.tool?.id);if(api==='content-outputs')add('content_outputs',body.output?.id||body.id);
 }
 for(const [container,keys]of [['agent',{assignedTools:'tools',assignedWorkflows:'workflows',assignedSkills:'skills'}]]){for(const [key,table]of Object.entries(keys)){for(const id of Array.isArray(body[container]?.[key])?body[container][key]:[])add(table,id);}}
 for(const id of Array.isArray(body.outputIds)?body.outputIds:[])add('content_outputs',id);
 for(const [key,table]of Object.entries({agentId:'agents',workflowId:'workflows',toolId:'tools',goalId:'goals',groupId:'groups'}))add(table,body[key]);
 return result;
}
