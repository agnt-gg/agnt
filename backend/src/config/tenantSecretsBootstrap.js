// node --import bootstrap: runs before modules that read authentication settings.
// Hosted Docker metadata contains paths only, never credential values.
import fs from 'node:fs';
import path from 'node:path';
if (process.env.AGNT_TENANT_SECRET_DIR) {
  const directory=path.resolve(process.env.AGNT_TENANT_SECRET_DIR);
  if(directory!=='/app/data/secrets') throw new Error('Unexpected tenant secret directory');
  for(const name of ['JWT_SECRET','SESSION_SECRET','AGNT_INSTANCE_KEY']) {
    const filename=path.join(directory,name);
    const stat=fs.lstatSync(filename);
    if(!stat.isFile() || (stat.mode&0o077)!==0)throw new Error('Tenant secret file is not private: '+name);
    const value=fs.readFileSync(filename,'utf8').trim();
    if(!value && name!=='AGNT_INSTANCE_KEY')throw new Error('Required tenant secret is empty: '+name);
    if(value)process.env[name]=value;else delete process.env[name];
  }
}
