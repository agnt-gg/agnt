// Runs ONE plugin tool call inside the kernel tool sandbox (pluginSandbox.js), then exits.
// Nothing here can reach the server's database, secrets or process: only the caller's folder is mounted.
import { pathToFileURL } from 'node:url';

process.once('message', async ({ entry, params, inputData, engine }) => {
  try {
    const loaded = await import(pathToFileURL(entry).href);
    const tool = [loaded, loaded.default].find((candidate) => candidate && typeof candidate.execute === 'function');
    if (!tool) throw new Error('This plugin tool has no execute() function');
    const result = await tool.execute(params, inputData, { ...(engine || {}), sandboxed: true });
    let payload = null;
    try { payload = JSON.parse(JSON.stringify(result ?? null)); } catch { payload = { result: String(result) }; }
    process.send({ result: payload }, () => process.exit(0));
  } catch (error) {
    process.send({ error: String(error?.message || error).slice(0, 2000) }, () => process.exit(1));
  }
});
