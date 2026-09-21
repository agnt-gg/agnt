import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Fixed read-only check. Expected bytes come from the accepted contract, not a shell command. */
export function createArtifactValidator({ root, saveReceipt, maximumBytes = 16 * 1024 * 1024 }) {
  return async ({ requirement, signal }) => {
    signal?.throwIfAborted();
    const expected = requirement.check;
    if (!expected || typeof expected.path !== 'string' || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw new Error('Invalid artifact check');
    const canonicalRoot = await realpath(root);
    const filename = await realpath(path.resolve(canonicalRoot, expected.path));
    const relative = path.relative(canonicalRoot, filename);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Artifact outside authorized root');
    const handle = await open(filename, 'r');
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > maximumBytes) throw new Error('Artifact is not a bounded regular file');
      const buffer = Buffer.alloc(Math.min(before.size + 1, maximumBytes + 1));
      let offset = 0;
      while (offset < buffer.length) {
        signal?.throwIfAborted();
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (offset !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Artifact changed during verification');
      const digest = createHash('sha256').update(buffer.subarray(0, offset)).digest('hex');
      const passed = digest === expected.sha256;
      const reference = await saveReceipt({validator:'artifact.sha256.v1',path:relative,sha256:digest,passed});
      return {passed,targetVersion:digest,reference};
    } finally {await handle.close();}
  };
}
