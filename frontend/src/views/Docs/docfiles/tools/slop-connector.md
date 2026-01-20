# SLOP Connector 🔗

## Id

`slop-connector`

## Description

Connects to SLOP AI services with comprehensive API integration. Supports REST, SSE, and WebSocket connections for chat, memory, tools, and resources. Features flexible authentication and streaming capabilities.

## Tags

slop, ai, api, connector, chat, memory, tools, resources

## Input Parameters

### Required

- **baseUrl** (string): Base URL for SLOP service
- **endpoint** (string): API endpoint (info, chat, memory, tools, resources, pay)
- **method** (string): HTTP method (GET, POST, PUT, DELETE)

### Optional

- **resourceId** (string): Resource ID for specific operations
- **toolId** (string): Tool ID for tool operations
- **queryParams** (string): Query parameters as JSON
- **payload** (string): Request payload as JSON
- **authToken** (string): Authentication token
- **streamMode** (string): Streaming mode (none, sse, websocket)

## Output Format

- **success** (boolean): Whether the SLOP operation was successful
- **result** (object): Operation result including API responses or streaming data
- **status** (number): HTTP status code
- **error** (string|null): Error message if the operation failed
