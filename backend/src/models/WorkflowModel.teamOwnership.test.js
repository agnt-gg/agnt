import {it,expect,vi} from 'vitest';
const {database}=vi.hoisted(()=>({database:{run:vi.fn()}}));
vi.mock('./database/index.js',()=>({default:database}));
import WorkflowModel from './WorkflowModel.js';
it('rejects cross-user saves before any mutation',async()=>{const spy=vi.spyOn(WorkflowModel,'findOne').mockResolvedValue({user_id:'alice'});await expect(WorkflowModel.createOrUpdate('w','{}','bob',false)).rejects.toMatchObject({status:404});expect(database.run).not.toHaveBeenCalled();spy.mockRestore();});
it('keeps ownership immutable and scopes the update predicate',async()=>{const spy=vi.spyOn(WorkflowModel,'findOne').mockResolvedValue({user_id:'alice'});database.run.mockImplementation((sql,args,callback)=>callback.call({changes:1},null));await WorkflowModel.createOrUpdate('w','{}','alice',false);const [sql,args]=database.run.mock.calls.at(-1);expect(sql).toContain('WHERE id = ? AND user_id = ?');expect(sql.split('WHERE')[0]).not.toMatch(/user_id\s*=/);expect(args.slice(-2)).toEqual(['w','alice']);spy.mockRestore();});
