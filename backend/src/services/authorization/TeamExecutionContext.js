import {AsyncLocalStorage} from 'node:async_hooks';
const contexts=new AsyncLocalStorage();
export function currentTeamExecution(){return contexts.getStore()||null;}
export function withTeamExecution(context,execute){
 if(!context?.teamId||!context?.principalId||!context?.actorId)throw new TypeError('A verified team execution context is required');
 return contexts.run(Object.freeze({...context}),execute);
}
/** Team jobs must never use a desktop environment key or another person's cached session. */
export function assertPersonalCredentialContext(){
 if(currentTeamExecution())throw Object.assign(new Error('Team runs must use an explicitly granted connection broker'),{code:'team_connection_required'});
}
