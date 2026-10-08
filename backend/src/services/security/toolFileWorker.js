// This process runs inside agnt-tool-run. No backend database/credential modules.
// Use IPC rather than stdout: existing file tools emit diagnostic console logs.
if (process.env.AGNT_TOOL_SANDBOX !== '1' || !process.send) throw new Error('File worker requires the tool sandbox');
process.on('disconnect', () => process.exit(0));
let queue = Promise.resolve();
process.on('message', (request) => {
  queue = queue.then(async () => {
    try {
      let result;
      if (request.kind === 'read-bytes') {
        const fs = await import('node:fs/promises');
        const handle = await fs.open(request.args.path, 'r');
        try {
          const stat = await handle.stat();
          if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('File is not a regular file under 32 MiB');
          result = (await handle.readFile()).toString('base64');
        } finally { await handle.close(); }
      } else if (request.kind === 'code-file') {
        const { executeCodeFunction } = await import('../orchestrator/codeTools.js');
        result = await executeCodeFunction(request.name, request.args);
      } else if (request.kind === 'legacy-file') {
        const { executeLegacyFileOperation } = await import('../orchestrator/legacyFileOperation.js');
        result = await executeLegacyFileOperation(request.args, null, {});
      } else if (request.kind === 'workflow-file') {
        const { default: tool } = await import('../../tools/library/utilities/file-system-operation.js');
        result = await tool.execute(request.args, {}, {});
      } else throw new Error('Unknown isolated file operation');
      process.send({ id: request.id, result });
    } catch (error) {
      process.send({ id: request.id, error: error.message });
    }
  });
});
