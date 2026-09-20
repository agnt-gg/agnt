import {it,expect} from 'vitest';
import db,{dbReady} from '../../models/database/index.js';
import {inspectOwnershipInventory} from './OwnershipInventory.js';
it('inspects initialized schema',async()=>{await dbReady;const repository={all:(s,a=[])=>new Promise((resolve,reject)=>db.all(s,a,(e,r)=>e?reject(e):resolve(r)))};const report=await inspectOwnershipInventory(repository);console.log('OWNERSHIP_UNCLASSIFIED',JSON.stringify(report.tables.filter(t=>t.status!=='classified')));expect(report.tables.length).toBeGreaterThan(50);expect(report.ready).toBe(true);},30000);
