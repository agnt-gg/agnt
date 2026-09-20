import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {OWNERSHIP_INVENTORY} from './OwnershipInventory.js';
it('classifies every table declared in the consolidated schema and verifies ownership columns',async()=>{
 const source=await readFile(new URL('../../models/database/index.js',import.meta.url),'utf8');
 const descriptors=new Map(OWNERSHIP_INVENTORY.map(entry=>[entry.table,entry]));
 const tables=[...source.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\)`/g)];
 expect(tables.length).toBeGreaterThan(50);
 for(const [,table,definition] of tables){const descriptor=descriptors.get(table);expect(descriptor,table).toBeTruthy();const column=descriptor.ownerColumn||descriptor.parentColumn;if(column)expect(definition,table+'.'+column).toMatch(new RegExp('\\b'+column+'\\s+TEXT'));}
});
