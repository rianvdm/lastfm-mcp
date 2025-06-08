/**
 * MCP (Model Context Protocol) Type Definitions
 * Based on the MCP specification
 */

// Protocol version
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
	capabilities: ClientCapabilities
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

// Server info
export const SERVER_INFO = {
	name: 'discogs-mcp',
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
