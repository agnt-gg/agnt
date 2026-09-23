import {expect,it} from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'node:fs/promises';
it('Given old execution table When additive migration runs twice Then retain existing rows and telemetry',async()=>{
 const source=await fs.readFile(new URL('./index.js',import.meta.url),'utf8');
 const sql=source.match(/db\.run\('(ALTER TABLE agent_executions ADD COLUMN execution_telemetry TEXT)'/)[1];
 const db=new sqlite3.Database(':memory:');const run=q=>new Promise((r,j)=>db.run(q,e=>e?j(e):r()));const get=q=>new Promise((r,j)=>db.get(q,(e,x)=>e?j(e):r(x)));
 try {await run("CREATE TABLE agent_executions(id TEXT PRIMARY KEY,status TEXT)");await run("INSERT INTO agent_executions VALUES('old','failed')");await run(sql);expect(await get('SELECT * FROM agent_executions')).toEqual({id:'old',status:'failed',execution_telemetry:null});await run("UPDATE agent_executions SET execution_telemetry='kept'");await expect(run(sql)).rejects.toThrow(/duplicate column name/);expect((await get('SELECT * FROM agent_executions')).execution_telemetry).toBe('kept');}finally{await new Promise(r=>db.close(r));}
});

it('Receipt column migration preserves old rows and rejects duplicate without rewriting data',async()=>{
 const source=await fs.readFile(new URL('./index.js',import.meta.url),'utf8');const sql=source.match(/db\.run\('(ALTER TABLE agent_executions ADD COLUMN returned_tool_receipts TEXT)'/)[1];
 const db=new sqlite3.Database(':memory:');const run=q=>new Promise((r,j)=>db.run(q,e=>e?j(e):r()));const get=q=>new Promise((r,j)=>db.get(q,(e,x)=>e?j(e):r(x)));
 try{await run('CREATE TABLE agent_executions(id TEXT PRIMARY KEY)');await run("INSERT INTO agent_executions VALUES('old')");await run(sql);expect((await get('SELECT * FROM agent_executions')).returned_tool_receipts).toBeNull();await run("UPDATE agent_executions SET returned_tool_receipts='kept'");await expect(run(sql)).rejects.toThrow(/duplicate column/);expect((await get('SELECT * FROM agent_executions')).returned_tool_receipts).toBe('kept');}finally{await new Promise(r=>db.close(r));}
});
