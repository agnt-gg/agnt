// Keep console.log and console.info off the node:test worker stdout pipe.
// Node 20.20.2 reads that pipe as V8 frames. A non-ASCII boot log can land in
// the length field and abort the file at :1:1. stderr is read as text.
// process.stdout.write and fs.writeSync(1) are left alone: swallowing those
// would hide Node's still-open frame-mimic crash.
import { Console } from 'node:console';

const stderrConsole = new Console({ stdout: process.stderr, stderr: process.stderr });
console.log = stderrConsole.log.bind(stderrConsole);
console.info = stderrConsole.info.bind(stderrConsole);
