export class TeamLibraryClient{
 constructor({baseUrl=process.env.REMOTE_URL||'https://api.agnt.gg',fetchImpl=fetch}={}){this.baseUrl=baseUrl.replace(/\/$/,'');this.fetch=fetchImpl;}
 async request(authorization,path,options={}){
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))throw Object.assign(Error('Authentication required'),{status:401});
  const response=await this.fetch(this.baseUrl+path,{...options,headers:{Authorization:authorization,...options.headers},signal:AbortSignal.timeout(60000),redirect:'error'});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw Object.assign(Error(body.error||'Library request failed'),{status:response.status});}return response;
 }
 async publish(authorization,{teamId,collectionId,kind,bytes,sha256,idempotencyKey}){
  const base='/teams/'+encodeURIComponent(teamId)+'/library/'+encodeURIComponent(collectionId);
  const reserved=await this.request(authorization,base+'/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,byteLength:bytes.length,sha256,idempotencyKey})});const upload=await reserved.json();
  if(upload.state==='committed')return{uploadId:upload.id,state:'committed'};
  const response=await this.request(authorization,base+'/uploads/'+encodeURIComponent(upload.id)+'/content',{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytes});return response.json();
 }
}
