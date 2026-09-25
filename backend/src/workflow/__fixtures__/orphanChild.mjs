// Fixture for workflowProcessLifecycle.test.js: a forked child that would live
// forever (like the real one's pollers). WATCH=1 installs the watch under test.
import { exitWhenOrphaned } from '../workflowProcessLifecycle.js';

let shuttingDown = false;
if (process.env.WATCH === '1') {
  exitWhenOrphaned(process, {
    isShuttingDown: () => shuttingDown,
    markShuttingDown: () => { shuttingDown = true; },
    release: () => {},
    log: { warn() {}, error() {} },
  });
}
setInterval(() => {}, 1 << 30);
process.send({ ready: process.pid });
