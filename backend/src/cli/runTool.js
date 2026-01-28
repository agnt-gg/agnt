#!/usr/bin/env node

const toolDebug = process.env.AGNT_TOOL_DEBUG === 'true';
if (!toolDebug) {
  // Suppress noisy initialization logs so the LLM receives clean JSON output.
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
}

let executeToolFn = null;
let nativeTools = null;
let toolRegistry = null;
let modulesLoaded = false;

async function loadModules() {
  if (modulesLoaded) return;
  const toolsModule = await import('../services/orchestrator/tools.js');
  executeToolFn = toolsModule.executeTool;
  nativeTools = toolsModule.TOOLS;
  const toolRegistryModule = await import('../services/orchestrator/toolRegistry.js');
  toolRegistry = toolRegistryModule.default;
  modulesLoaded = true;
}

function parseArgValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) return null;
  if (index + 1 >= argv.length) return null;
  return argv[index + 1];
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function normalizeToolName(toolName) {
  if (!toolName) return null;
  return String(toolName).trim().replace(/-/g, '_');
}

async function listTools() {
  await loadModules();
  await toolRegistry.ensureInitialized();

  const nativeToolNames = Object.keys(nativeTools);
  const registryToolNames = toolRegistry
    .getAllToolsIncludingPlugins()
    .map((tool) => tool.type)
    .filter(Boolean)
    .sort();

  const response = {
    success: true,
    nativeTools: nativeToolNames.sort(),
    registryTools: registryToolNames,
    hint:
      "Run a tool with: node backend/src/cli/runTool.js --tool <tool_name> --args '{\"key\":\"value\"}'",
  };

  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`, () => {
    process.exit(0);
  });
}

async function run() {
  const argv = process.argv.slice(2);

  if (hasFlag(argv, '--list')) {
    await listTools();
    return;
  }

  await loadModules();
  await toolRegistry.ensureInitialized();

  const toolNameInput = parseArgValue(argv, '--tool') || parseArgValue(argv, '-t');
  const argsInput = parseArgValue(argv, '--args') || parseArgValue(argv, '-a');
  const contextInput = parseArgValue(argv, '--context');

  const toolName = normalizeToolName(toolNameInput);
  if (!toolName) {
    process.stderr.write('Missing required --tool argument. Use --list to see available tools.\n');
    process.exitCode = 1;
    return;
  }

  const args = safeJsonParse(argsInput, {});
  if (argsInput && args === null) {
    process.stderr.write('Failed to parse --args JSON.\n');
    process.exitCode = 1;
    return;
  }

  const extraContext = safeJsonParse(contextInput, {});
  if (contextInput && extraContext === null) {
    process.stderr.write('Failed to parse --context JSON.\n');
    process.exitCode = 1;
    return;
  }

  const userId = parseArgValue(argv, '--user-id') || process.env.AGNT_USER_ID || null;
  const conversationId = parseArgValue(argv, '--conversation-id') || process.env.AGNT_CONVERSATION_ID || null;
  const authToken = parseArgValue(argv, '--auth-token') || process.env.AGNT_AUTH_TOKEN || null;

  const context = {
    userId,
    conversationId,
    ...(extraContext || {}),
  };

  try {
    const result = await executeToolFn(toolName, args, authToken, context);
    // result is expected to be a JSON string; print it as-is for LLM parsing.
    process.stdout.write(`${result}\n`, () => {
      process.exit(0);
    });
  } catch (error) {
    const response = {
      success: false,
      error: error.message || 'Tool execution failed',
      tool: toolName,
    };
    process.stdout.write(`${JSON.stringify(response)}\n`, () => {
      process.exit(1);
    });
  }
}

run();
