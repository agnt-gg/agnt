export class TeamBrokerClient {
  constructor({baseUrl=process.env.REMOTE_URL||'https://api.agnt.gg',teamId,tenantSlug,workspaceId,authorization,accessRevision,principalId,principalToken,connectionId,fetchImpl=fetch}) {
    Object.assign(this,{baseUrl:baseUrl.replace(/\/$/,''),teamId,tenantSlug,workspaceId,authorization,accessRevision,principalId,principalToken,connectionId,fetchImpl});
  }
  async execute(operation) {
    if(!this.teamId||!this.tenantSlug||!this.workspaceId||!Number.isSafeInteger(this.accessRevision)||!this.authorization?.startsWith('Bearer '))throw new Error('Verified workspace execution context required');
    const path='/teams/'+encodeURIComponent(this.teamId)+'/instances/'+encodeURIComponent(this.tenantSlug)+'/workspaces/'+encodeURIComponent(this.workspaceId)+'/execute';
    const response=await this.fetchImpl(this.baseUrl+path,{method:'POST',headers:{Authorization:this.authorization,'X-AGNT-Principal-Token':this.principalToken,'Content-Type':'application/json'},body:JSON.stringify({principalId:this.principalId,connectionId:this.connectionId,accessRevision:this.accessRevision,operation}),signal:AbortSignal.timeout(100000),redirect:'error'});
    const result=await response.json();
    if(!response.ok)throw Object.assign(new Error(result.error||'Workspace broker failed'),{status:response.status});
    return result;
  }
  sdk(){const request=(path,body)=>this.execute({name:'llm.request',path,body:{...body,stream:false}});return {chat:{completions:{create:body=>request('/chat/completions',body)}},responses:{create:body=>request('/responses',body)},messages:{create:body=>request('/messages',body)}};}
}
