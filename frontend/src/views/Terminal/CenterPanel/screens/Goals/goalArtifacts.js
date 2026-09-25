/**
 * What a goal produced, in the form the chat's ArtifactCards already reads:
 * a text body plus the tool calls. The body holds only deliverables: files the
 * work WROTE (as file:/// links), and the file links and generated images its
 * final answers name. Code snippets in those answers are explanation, not
 * output, so they are left out; files it only read are not artifacts.
 */

// Deliverables a reviewer opens first; helper scripts and data files follow.
const DELIVERABLE = /\.(html?|md|markdown|pdf|png|jpe?g|webp|gif|svg|avif|mp4|webm|mov|mp3|wav|m4a|csv|xlsx?|docx?|pptx?|zip)$/i;
const MAX_FILES = 12;

const parseOutput = (output) => {
  if (!output || typeof output !== 'string') return output || null;
  try {
    return JSON.parse(output);
  } catch {
    return { content: output };
  }
};

const argsOf = (execution) => {
  const raw = execution?.arguments ?? execution?.args ?? execution?.input ?? {};
  if (typeof raw !== 'string') return raw || {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const joinPath = (root, rel) => (root ? `${String(root).replace(/[\\/]+$/, '')}/${String(rel).replace(/^[\\/]+/, '')}` : rel);

/** The path a tool call wrote, or null when it only read, listed or ran. */
export function writtenPath(execution) {
  const name = String(execution?.name || execution?.toolName || '');
  const args = argsOf(execution);
  if (name === 'write_file' || name === 'edit_file') return args.path || null;
  if (name === 'file_operations') {
    if (args.operation === 'write') return args.path || null;
    if (args.operation === 'copy' || args.operation === 'move') return args.destination || null;
    return null;
  }
  if (name === 'file_system_operation' && ['writeFile', 'appendFile'].includes(args.operation)) return joinPath(args.rootDirectory, args.path);
  return null;
}

export const toFileUrl = (path) => 'file:///' + encodeURI(String(path).replace(/\\/g, '/').replace(/^\/+/, ''));

/**
 * @param {Array<{output?: any}>} tasks
 * @returns {{ content: string, toolCalls: object[], files: string[] }}
 */
export function goalArtifactSource(tasks = []) {
  const texts = [];
  const toolCalls = [];
  const written = [];
  for (const task of tasks) {
    const output = parseOutput(task?.output);
    if (!output) continue;
    if (typeof output.content === 'string') {
      texts.push(...(output.content.match(/file:\/\/\/[^\s)"'<>`]+|\{\{IMAGE_REF:[^}]+\}\}/g) || []));
    }
    for (const execution of output.toolExecutions || output.tool_executions || []) {
      toolCalls.push(execution);
      const path = writtenPath(execution);
      if (path && typeof path === 'string') written.push(path);
    }
  }
  const unique = [...new Set(written.map((p) => p.replace(/\\/g, '/')))];
  const files = [...unique.filter((p) => DELIVERABLE.test(p)), ...unique.filter((p) => !DELIVERABLE.test(p))].slice(0, MAX_FILES);
  const content = [...files.map(toFileUrl), ...new Set(texts)].join('\n\n');
  return { content, toolCalls, files };
}
