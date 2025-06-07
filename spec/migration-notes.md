# Migration Notes: Text Protocol → MCP Protocol

This document outlines the changes needed to migrate from the current text-based protocol to a proper MCP (Model Context Protocol) implementation.

## Current State

We have implemented:

- Basic text command router (`ping` → `pong`)
- HTTP POST endpoint that accepts plain text
- Markdown responses

## Target State

We need to implement:

- JSON-RPC 2.0 message handling
- MCP protocol with proper initialize/capabilities flow
- SSE transport for bidirectional communication
- Resources, Tools, and Prompts as per MCP spec

## Key Changes Required

### 1. Replace Text Router with JSON-RPC Handler

**Current:**

```typescript
// src/router.ts
export async function route(command: string): Promise<string>
```

**Target:**

```typescript
// src/protocol/parser.ts
export function parseMessage(body: string): JSONRPCRequest
export function createResponse(id: string | number, result: any): JSONRPCResponse
export function createError(id: string | number, code: number, message: string): JSONRPCResponse
```

### 2. Update Main Handler

**Current:**

```typescript
// src/index.ts
const command = await request.text()
const response = await route(command)
return new Response(response, { headers: { 'Content-Type': 'text/markdown' } })
```

**Target:**

```typescript
// src/index.ts
const message = await parseMessage(await request.text())
const result = await handleMethod(message.method, message.params)
return new Response(JSON.stringify(createResponse(message.id, result)), {
	headers: { 'Content-Type': 'application/json' },
})
```

### 3. Add MCP Methods

Replace simple commands with MCP standard methods:

- `initialize` → Capability negotiation
- `resources/list` → List available resources
- `resources/read` → Read resource content
- `tools/list` → List available tools
- `tools/call` → Execute a tool
- `prompts/list` → List available prompts
- `prompts/get` → Get prompt content

### 4. Add SSE Transport

Add Server-Sent Events endpoint for server-initiated messages:

- GET `/sse` → SSE connection
- Bidirectional communication support

## Migration Steps

1. **Keep existing tests** - They verify basic connectivity
2. **Add JSON-RPC layer** - Parse/create messages alongside existing code
3. **Implement initialize** - Basic MCP handshake
4. **Convert features** - Migrate text commands to MCP resources/tools
5. **Remove old code** - Clean up text-based routing

## Testing Strategy

- Unit tests for JSON-RPC parsing
- Integration tests for MCP protocol flow
- Use MCP Inspector tool for validation
- Test with Claude Desktop client

## Backwards Compatibility

During migration, we can support both protocols:

- Check Content-Type header
- Route to appropriate handler
- Remove after full migration
