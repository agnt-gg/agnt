const personal = ['transactions','agents','tools','workflows','groups','content_outputs','user_data','workflow_executions','daily_usage_stats','goals','golden_standards','conversation_logs','conversation_settings','routing_decisions','codex_threads','webhooks','oauth_tokens','api_keys','custom_openai_providers','agent_executions','llm_calls','widget_definitions','widget_layouts','skills','security_policies','skillforge_settings','evolution_settings','evolution_performance_snapshots','evolution_core_runs','experiments','eval_datasets','insights','agent_memory','schedules','wallets','contracts','mutation_history','conversation_prompt_state','extraction_gate'];
const creatorOwned = new Set(['agents','tools','golden_standards']);
const inherited = {
 workflow_versions:['workflows','workflow_id'],node_executions:['workflow_executions','execution_id'],tasks:['goals','goal_id'],task_executions:['tasks','task_id'],goal_outputs:['goals','goal_id'],goal_evaluations:['goals','goal_id'],task_evaluations:['tasks','task_id'],goal_iterations:['goals','goal_id'],experiment_runs:['experiments','experiment_id'],experiment_results:['experiments','experiment_id'],skill_versions:['skills','skill_id'],skill_evaluations:['skills','skill_id'],schedule_runs:['schedules','schedule_id'],wallet_ledger:['wallets','wallet_id'],contract_violations:['contracts','contract_id'],agent_tool_executions:['agent_executions','execution_id'],agent_resources:['agents','agent_id'],agent_workflows:['agents','agent_id']
};
export const OWNERSHIP_INVENTORY = Object.freeze([
 ...personal.map(table=>({table,kind:'personal',ownerColumn:creatorOwned.has(table)?'created_by':'user_id'})),
 ...Object.entries(inherited).map(([table,[parentTable,parentColumn]])=>({table,kind:'inherited',parentTable,parentColumn})),
 ...['ownership_scopes','ownership_resource_types','scope_resource_owners','scope_api_audit','execution_principals','scoped_connections','execution_connection_grants','goal_lifecycle_versions','activation_milestone_outbox','users','estimate_calibration','model_metadata_cache','ledger_write_failures','installed_plugin_assets','schema_markers'].map(table=>({table,kind:'system'}))
].map(Object.freeze));
/** Audit before migration. Unknown schemas stop migration rather than infer visibility. */
export async function inspectOwnershipInventory(repository) {
 const tables=await repository.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
 const descriptors=new Map(OWNERSHIP_INVENTORY.map(entry=>[entry.table,entry]));
 const results=[];
 for(const {name} of tables){
  if(!/^[a-z][a-z0-9_]*$/.test(name)){results.push({table:name,status:'unclassified'});continue;}
  if (/^(conversation_logs|agent_executions|content_outputs|insights|agent_memory|workflow_versions)_fts(_(data|idx|content|docsize|config))?$/.test(name)) {results.push({table:name,kind:'derived_index',status:'classified'});continue;}
  const descriptor=descriptors.get(name);
  if(!descriptor){results.push({table:name,status:'unclassified'});continue;}
  const columns=await repository.all(`PRAGMA table_info("${name}")`);
  const expected=descriptor.ownerColumn||descriptor.parentColumn;
  results.push({...descriptor,status:expected&&!columns.some(column=>column.name===expected)?'schema_mismatch':'classified'});
 }
 return {ready:results.every(entry=>entry.status==='classified'),tables:results};
}
