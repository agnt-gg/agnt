import {describe,it,expect} from 'vitest';
import {validateVirtualSql} from './virtualSqlBoundary.js';
describe('virtual data SQL stays on user_data',()=>{
 it('preserves normal virtual-table filters',()=>{
  for(const condition of ["status = 'open'",'amount >= 10 ORDER BY created_at DESC LIMIT 20',"name LIKE '%x%'", "date(created_at) > date('2026-01-01')", "note = 'SELECT is just text'"]){expect(()=>validateVirtualSql({columns:'name,amount',condition})).not.toThrow();}
 });
 it('refuses subqueries, unions, file functions and breaking the enclosing user scope',()=>{
  for(const condition of ['1=1) OR (1=1','1=1) UNION SELECT password FROM users --',"name=(SELECT secret FROM api_keys)","readfile('/app/data/secrets/ENCRYPTION_KEY')",'1=1; ATTACH DATABASE x AS y','1/*comment*/=1'])expect(()=>validateVirtualSql({columns:'*',condition})).toThrow();
  expect(()=>validateVirtualSql({columns:"x') FROM users --"})).toThrow();
  expect(()=>validateVirtualSql({operation:'update',condition:"id OR user_id='other'"})).toThrow();
 });
});
