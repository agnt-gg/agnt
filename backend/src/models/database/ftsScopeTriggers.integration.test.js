import {it,expect} from 'vitest';
import db,{dbReady} from './index.js';
import {databaseRepository,ensureSharedScope} from '../../services/authorization/ScopeRepository.js';
import {migrateOwnership} from '../../services/authorization/OwnershipMigration.js';
import {installOwnershipTriggers} from '../../services/authorization/OwnershipTriggers.js';
import {OWNERSHIP_INVENTORY} from '../../services/authorization/OwnershipInventory.js';

/**
 * THE REGRESSION THIS PINS.
 *
 * Ownership assignment runs as an AFTER INSERT trigger that UPDATEs scope_id.
 * The FTS sync trigger fired on ANY update, so it deleted and re-inserted the
 * row its own AFTER INSERT trigger had written in the same statement, and every
 * insert into an FTS-indexed table failed with a bare SQLITE_CONSTRAINT once the
 * ownership triggers were installed. That is every conversation, output, memory,
 * insight and execution on a migrated hosted tenant — so it is asserted directly,
 * and the search index is asserted to still follow real content edits.
 */
it('FTS-indexed tables still accept inserts and stay searchable once ownership triggers exist',async()=>{
 await dbReady;
 const r=databaseRepository(db);
 await migrateOwnership(r);
 await installOwnershipTriggers(r,OWNERSHIP_INVENTORY);
 const scope=await ensureSharedScope(r,'fts-team','fts-workspace');

 await r.run(
  "INSERT INTO content_outputs(id,user_id,title,content,content_type) VALUES('fts-output',?,'Quarterly plan','searchable original body','markdown')",
  [scope.resourceOwnerId],
 );

 // The ownership trigger assigned the scope without breaking the insert.
 expect((await r.get("SELECT scope_id FROM content_outputs WHERE id='fts-output'")).scope_id).toBe(scope.id);

 const search=async term=>r.all(
  'SELECT doc_id FROM content_outputs_fts WHERE content_outputs_fts MATCH ?',
  [term],
 );
 expect((await search('searchable')).map(row=>row.doc_id)).toContain('fts-output');

 // A mirrored-column edit must still re-index; a scope-only write must not break.
 await r.run("UPDATE content_outputs SET content='replacement narrative' WHERE id='fts-output'");
 expect((await search('searchable')).map(row=>row.doc_id)).not.toContain('fts-output');
 expect((await search('replacement')).map(row=>row.doc_id)).toContain('fts-output');

 // Deletion still clears the index.
 await r.run("DELETE FROM content_outputs WHERE id='fts-output'");
 expect(await search('replacement')).toEqual([]);
},60000);
