import {it,expect,vi} from 'vitest';
const {database}=vi.hoisted(()=>({database:{get:vi.fn(),run:vi.fn()}}));
vi.mock('../models/database/index.js',()=>({default:database}));
vi.mock('../utils/realtimeSync.js',()=>({broadcast:vi.fn(),broadcastToUser:vi.fn(),RealtimeEvents:{},notifyWidgetChanged:vi.fn()}));
import service from './WidgetDefinitionService.js';
it('scopes widget edits to the authenticated owner',async()=>{database.get.mockImplementation((sql,args,cb)=>cb(null,null));const res={status:vi.fn().mockReturnThis(),json:vi.fn()};await service.updateWidget({params:{widgetId:'private'},user:{id:'bob'},body:{name:'Changed'}},res);expect(database.get.mock.calls[0][0]).toContain('AND user_id = ?');expect(database.get.mock.calls[0][1]).toEqual(['private','bob']);expect(res.status).toHaveBeenCalledWith(404);expect(database.run).not.toHaveBeenCalled();});
