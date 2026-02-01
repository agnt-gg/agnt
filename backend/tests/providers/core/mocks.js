/**
 * Mock tools, MCP server definitions, and test fixtures
 * used across provider test suites.
 */

// ── Tool schemas (OpenAI function-calling format) ──────────────────────

export const weatherTool = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the current weather for a given city.',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'City name, e.g. "Tokyo"',
        },
      },
      required: ['location'],
    },
  },
};

export const calculatorTool = {
  type: 'function',
  function: {
    name: 'calculate',
    description: 'Evaluate a mathematical expression and return the result.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Mathematical expression, e.g. "2 + 2"',
        },
      },
      required: ['expression'],
    },
  },
};

export const fileReadTool = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read the contents of a file at the given path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute file path',
        },
      },
      required: ['path'],
    },
  },
};

// MCP-style tool (same format, just semantically an MCP tool)
export const mcpFilesystemTool = {
  type: 'function',
  function: {
    name: 'mcp_filesystem_read',
    description: 'Read a file from the filesystem via MCP server.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read',
        },
      },
      required: ['path'],
    },
  },
};

export const mcpDatabaseTool = {
  type: 'function',
  function: {
    name: 'mcp_database_query',
    description: 'Execute a read-only SQL query via MCP database server.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SQL SELECT query',
        },
      },
      required: ['query'],
    },
  },
};

// ── Mock tool results ──────────────────────────────────────────────────

export function mockToolResult(toolCallId, name, data) {
  return {
    tool_call_id: toolCallId,
    role: 'tool',
    name,
    content: JSON.stringify(data),
  };
}

export function mockWeatherResult(toolCallId) {
  return mockToolResult(toolCallId, 'get_weather', {
    location: 'Tokyo',
    temperature: 22,
    unit: 'celsius',
    condition: 'partly cloudy',
  });
}

export function mockCalculatorResult(toolCallId, answer) {
  return mockToolResult(toolCallId, 'calculate', {
    expression: '2 + 2',
    result: answer ?? 4,
  });
}

// ── Message fixtures ───────────────────────────────────────────────────

export const basicMessages = [
  { role: 'system', content: 'You are a helpful assistant. Be concise.' },
  { role: 'user', content: 'What is 2+2? Reply with ONLY the number, nothing else.' },
];

export const toolMessages = [
  { role: 'system', content: 'You are a helpful assistant. Always use tools when available.' },
  { role: 'user', content: 'What is the current weather in Tokyo? Use the get_weather tool.' },
];

export const multiToolMessages = [
  { role: 'system', content: 'You are a helpful assistant. Always use tools when available.' },
  { role: 'user', content: 'What is the weather in Tokyo and London? Use the get_weather tool for each city.' },
];

export const mcpMessages = [
  { role: 'system', content: 'You are a helpful assistant with access to filesystem tools.' },
  { role: 'user', content: 'Read the file at /tmp/test.txt using the mcp_filesystem_read tool.' },
];

export const longContextMessages = (tokenTarget = 4000) => {
  // Generate a long user message to test context management
  const filler = 'The quick brown fox jumps over the lazy dog. ';
  const repeatCount = Math.ceil((tokenTarget * 4) / filler.length); // ~4 chars per token
  return [
    { role: 'system', content: 'Summarize the following text in one sentence.' },
    { role: 'user', content: filler.repeat(repeatCount) },
  ];
};

// ── Tiny base64 PNG for vision tests (1x1 red pixel) ──────────────────

export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

export const visionMessages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Describe what you see in this image in one sentence.' },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/png;base64,${TINY_PNG_BASE64}`,
        },
      },
    ],
  },
];
