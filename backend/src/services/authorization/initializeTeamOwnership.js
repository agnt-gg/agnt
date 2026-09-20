import sqlite3 from 'sqlite3';
import {databaseRepository} from './ScopeRepository.js';
import {migrateOwnership} from './OwnershipMigration.js';
import {OWNERSHIP_INVENTORY} from './OwnershipInventory.js';
import {installOwnershipTriggers} from './OwnershipTriggers.js';
export async function initializeTeamOwnership(databasePath){
 const db=await new Promise((resolve,reject)=>{const connection=new sqlite3.Database(databasePath,error=>error?reject(error):resolve(connection));});
 const repository=databaseRepository(db);
 try{await repository.run('PRAGMA foreign_keys=ON');await repository.run('PRAGMA busy_timeout=10000');
 const result=await migrateOwnership(repository);
 await repository.run('BEGIN IMMEDIATE');try{await installOwnershipTriggers(repository,OWNERSHIP_INVENTORY);await repository.run('COMMIT');}catch(error){await repository.run('ROLLBACK');throw error;}
 return result;
 }finally{await new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve()));}
}
