import sqlite3 from 'sqlite3';
import path from 'node:path';
import {inspectOwnershipInventory} from '../src/services/authorization/OwnershipInventory.js';
const databasePath=process.argv[2];
if(!databasePath)throw new Error('Usage: node backend/scripts/inspect-team-ownership.mjs <database-copy-path>');
const db=await new Promise((resolve,reject)=>{const connection=new sqlite3.Database(path.resolve(databasePath),sqlite3.OPEN_READONLY,error=>error?reject(error):resolve(connection));});
const repository={all:(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(error,rows)=>error?reject(error):resolve(rows)))};
try{const report=await inspectOwnershipInventory(repository);console.log(JSON.stringify(report,null,2));if(!report.ready)process.exitCode=2;}finally{await new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve()));}
