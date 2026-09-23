import { describe, it, expect } from 'vitest';
import executeJavaScript from './execute-javascript.js';

// The executor forks a child that imports the app's auth/storage modules. In
// test mode that child must adopt the parent's synthetic store explicitly, like
// the workflow child does; otherwise it refuses to start without a storage
// registration and the tool never runs the code.
describe('execute-javascript child under test storage', () => {
  it('runs code in the forked child and returns its result', async () => {
    const output = await executeJavaScript.execute({ code: 'return 6 * 7;' }, {},
      { workflowId: 'wf-test', userId: 'u-test', outputs: {}, errors: {}, isSubWorkflow: false });
    expect(output).toMatchObject({ success: true, result: 42 });
  }, 30000);
});
