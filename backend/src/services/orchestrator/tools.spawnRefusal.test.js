import { describe, it, expect, vi } from 'vitest';

// Bravo live re-test, 2026-11-01: a member pointing execute_shell_command at the owner's folder was
// correctly refused by the tool sandbox, but the refusal escaped the tool as a thrown error instead of
// coming back as its result. The sandbox throws from spawn; both code tools must report it.
vi.mock('../security/toolProcess.js', async (importOriginal) => ({
  ...(await importOriginal()),
  spawn: () => { throw Object.assign(new Error('Hosted tools must execute inside the workspace (/app/data/workspaces/m); /app/data/projects is outside it'), { code: 'tool_workspace_required' }); },
}));
const { TOOLS } = await import('./tools.js');

describe('a sandbox refusal is the tool\'s result, not a crash', { timeout: 30000 }, () => {
  it('execute_shell_command', async () => {
    const result = JSON.parse(await TOOLS.execute_shell_command.execute({ command: 'ls', cwd: '/app/data/projects' }, null, { userId: 'member' }));
    expect(result).toMatchObject({ success: false, code: 'tool_workspace_required', error: expect.stringMatching(/inside the workspace/) });
  });

  it('execute_javascript_code', async () => {
    const result = JSON.parse(await TOOLS.execute_javascript_code.execute({ code: '1' }, null, { userId: 'member' }));
    expect(result).toMatchObject({ success: false, code: 'tool_workspace_required' });
  });
});
