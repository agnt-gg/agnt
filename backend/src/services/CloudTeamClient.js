export class CloudTeamClient {
  constructor({ baseUrl = process.env.REMOTE_URL || 'https://api.agnt.gg', fetchImpl = fetch } = {}) {
    this.baseUrl=baseUrl.replace(/\/$/,'');this.fetch=fetchImpl;
  }
  async request(authorization,path,options={}) {
    if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))throw Object.assign(new Error('Sign in required'),{status:401});
    const response=await this.fetch(this.baseUrl+'/teams'+path,{...options,headers:{'Content-Type':'application/json',Authorization:authorization},signal:AbortSignal.timeout(15000),redirect:'error'});
    const result=await response.json();
    if(!response.ok)throw Object.assign(new Error(result.error||'Team operation failed'),{status:response.status,code:result.code});
    return result;
  }
  async access(authorization,teamId) {
    const team=await this.request(authorization,'/'+encodeURIComponent(teamId)+'/access');
    if(process.env.AGNT_TENANT_SLUG && team.tenantSlug!==process.env.AGNT_TENANT_SLUG)throw Object.assign(new Error('Open this team in its own cloud instance'),{status:409,code:'different_tenant'});
    return team;
  }
}
