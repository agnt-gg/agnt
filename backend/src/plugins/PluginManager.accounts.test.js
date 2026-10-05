import { it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('./PluginAccountStore.js',()=>({default:{assert:vi.fn()}}));
import PluginAccounts from './PluginAccountStore.js';
import PluginManager from './PluginManager.js';
import ToolConfig from '../tools/ToolConfig.js';
beforeEach(()=>{vi.clearAllMocks();PluginManager.toolToPlugin.set('account-fixture','private-pack');PluginManager.loadedTools.set('account-fixture',{default:{execute:vi.fn()}});});
afterEach(()=>{PluginManager.toolToPlugin.delete('account-fixture');PluginManager.loadedTools.delete('account-fixture');delete ToolConfig.triggers['account-fixture'];});
it('checks ownership even before handing out a cached executable module',async()=>{
 PluginAccounts.assert.mockRejectedValueOnce(new Error('not installed'));
 await expect(PluginManager.loadTool('account-fixture','bob')).rejects.toThrow('not installed');
 expect(PluginAccounts.assert).toHaveBeenCalledWith('private-pack','bob');
 PluginAccounts.assert.mockResolvedValueOnce();expect(await PluginManager.loadTool('account-fixture','alice')).toBeDefined();
});
it('does not import or arm a plugin trigger for another account',async()=>{
 await PluginManager.registerPluginTrigger('account-fixture','unused','entry.js');
 PluginAccounts.assert.mockRejectedValueOnce(new Error('not installed'));
 await expect(ToolConfig.triggers['account-fixture'].setup({userId:'bob'},{})).rejects.toThrow('not installed');
 expect(ToolConfig.triggers['account-fixture']._pluginInstance).toBeNull();
});
