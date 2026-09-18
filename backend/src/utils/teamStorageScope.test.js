import {describe,it,expect} from 'vitest';
import {isSecretPath} from './localFileScope.js';
describe('team database cannot be streamed as an artifact',()=>{
 it.each(['teams.db','teams.db-wal','teams.db-shm'])('refuses %s under any root',file=>{expect(isSecretPath('C:/Users/a/AppData/AGNT/Data/'+file)).toBe(true);expect(isSecretPath('/home/user/.agnt/'+file)).toBe(true)});
 it('does not block ordinary shared documents',()=>expect(isSecretPath('/work/teams-guide.md')).toBe(false));
});
