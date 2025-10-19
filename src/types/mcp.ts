/**
 * MCP (Model Context Protocol) Type Definitions
 * Based on the MCP specification
 */

// Protocol version
// Note: Using 2024-11-05 for Claude Desktop compatibility
// Claude Desktop uses Streamable HTTP transport but expects 2024-11-05 protocol version
export const PROTOCOL_VERSION = '2024-11-05'

// Client capabilities
export interface ClientCapabilities {
	roots?: {
		listChanged?: boolean
	}
	sampling?: Record<string, never>
	experimental?: Record<string, unknown>
}

// Server capabilities
export interface ServerCapabilities {
	prompts?: {
		listChanged?: boolean
	}
	resources?: {
		subscribe?: boolean
		listChanged?: boolean
	}
	tools?: {
		listChanged?: boolean
	}
	logging?: Record<string, never>
	experimental?: Record<string, unknown>
}

// Initialize request params
export interface InitializeParams {
	protocolVersion: string
	capabilities?: ClientCapabilities
	clientInfo: {
		name: string
		version: string
	}
}

// Initialize result
export interface InitializeResult {
	protocolVersion: string
	capabilities: ServerCapabilities
	serverInfo: {
		name: string
		version: string
	}
}

// MCP Resource types
export interface Resource {
	uri: string
	name: string
	description?: string
	mimeType?: string
}

export interface ResourcesListResult {
	resources: Resource[]
}

export interface ResourceContents {
	uri: string
	mimeType?: string
	text?: string
	blob?: string
}

export interface ResourcesReadParams {
	uri: string
}

export interface ResourcesReadResult {
	contents: ResourceContents[]
}

// MCP Prompt types
export interface PromptArgument {
	name: string
	description?: string
	required?: boolean
}

export interface Prompt {
	name: string
	description?: string
	arguments?: PromptArgument[]
}

export interface PromptsListParams {
	cursor?: string
}

export interface PromptsListResult {
	prompts: Prompt[]
	nextCursor?: string
}

export interface PromptsGetParams {
	name: string
	arguments?: Record<string, unknown>
}

export interface PromptMessage {
	role: 'user' | 'assistant'
	content: {
		type: 'text'
		text: string
	}
}

export interface PromptsGetResult {
	description?: string
	messages: PromptMessage[]
}

// MCP Tool types
export interface Tool {
	name: string
	description?: string
	inputSchema: {
		type: 'object'
		properties: Record<string, unknown>
		required?: string[]
	}
}

export interface ToolsListParams {
	cursor?: string
}

export interface ToolsListResult {
	tools: Tool[]
	nextCursor?: string
}

export interface ToolsCallParams {
	name: string
	arguments?: Record<string, unknown>
}

export interface ToolContent {
	type: 'text' | 'image' | 'resource'
	text?: string
	data?: string
	mimeType?: string
}

export interface ToolsCallResult {
	content: ToolContent[]
	isError?: boolean
}

// Server info
export const SERVER_INFO = {
	name: 'lastfm-mcp',
	version: '1.0.0',
}

// Default server capabilities
export const DEFAULT_CAPABILITIES: ServerCapabilities = {
	prompts: {
		listChanged: true,
	},
	resources: {
		subscribe: false,
		listChanged: true,
	},
	tools: {
		listChanged: true,
	},
	logging: {},
}
