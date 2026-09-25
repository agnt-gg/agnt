// Fixture for workflowProcessLifecycle.test.js. Forks orphanChild.mjs, prints
// the child's pid, then waits to be killed HARD by the test (no shutdown code
// runs), which is how a Windows backend dies under an update installer.
//
// detached: on Windows libuv puts every non-detached child in a job object that
// dies with its parent, which would hide the orphan on this OS and let the test
// pass with the fix removed. macOS and Linux have no such net, and that is
// where the orphan was reported, so every OS gets the POSIX behaviour here.
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const child = fork(path.join(here, 'orphanChild.mjs'), [], {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  detached: true,
});
child.on('message', (m) => {
  if (m?.ready) process.stdout.write(`CHILD ${m.ready}\n`);
});
setInterval(() => {}, 1 << 30);
