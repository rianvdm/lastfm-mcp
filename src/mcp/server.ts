// ABOUTME: Creates and configures the McpServer instance using the official MCP SDK.
// ABOUTME: Registers tools, prompts, and resources, and manages per-request auth context.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { CachedLastfmClient } from '../clients/cachedLastfm'
import { LastfmClient } from '../clients/lastfm'
import type { Env } from '../types/env'

import { registerPrompts } from './prompts/analysis'
import { registerResources } from './resources/lastfm'
import {
	registerAuthenticatedTools,
	registerPublicTools,
	buildSessionAuthMessages,
	buildOAuthAuthMessages,
	type AuthSession,
	type AuthMessageConfig,
} from './tools'

// Server metadata
const SERVER_NAME = 'lastfm-mcp'
const SERVER_VERSION = '1.0.0'

/**
 * Request context that can be updated per-request.
 * Tools access this via getter functions captured in closures.
 */
export interface McpRequestContext {
	session: AuthSession | null
	baseUrl: string
	sessionId: string | null
}

/**
 * Result of createMcpServer - includes server and context setter.
 */
export interface McpServerWithContext {
	server: McpServer
	setContext: (ctx: Partial<McpRequestContext>) => void
	getContext: () => McpRequestContext
}

/**
 * Creates a configured MCP server instance with access to environment bindings.
 *
 * Uses a factory function pattern to provide env access to all tools via closure.
 * Returns both the server and a context setter for per-request session management.
 *
 * @param env - Cloudflare Worker environment bindings
 * @param initialBaseUrl - Base URL for the server (used for auth URLs)
 * @param options - Optional configuration (e.g. OAuth mode for auth messages)
 */
export function createMcpServer(env: Env, initialBaseUrl: string, options?: { authMessages?: AuthMessageConfig }): McpServerWithContext {
	const server = new McpServer({
		name: SERVER_NAME,
		version: SERVER_VERSION,
	})

	// Create Last.fm client with caching
	const lastfmClient = new LastfmClient(env.LASTFM_API_KEY)
	const cachedClient = new CachedLastfmClient(lastfmClient, env.MCP_SESSIONS)

	// Mutable request context - updated per-request before handling
	const context: McpRequestContext = {
		session: null,
		baseUrl: initialBaseUrl,
		sessionId: null,
	}

	// Getters that tools use to access current context
	const getSession = () => context.session
	const getBaseUrl = () => context.baseUrl
	const getSessionId = () => context.sessionId

	// Register public tools (no auth required)
	registerPublicTools(server, cachedClient, getBaseUrl)

	// Register authenticated tools with appropriate auth messages
	const authMessages = options?.authMessages ?? buildSessionAuthMessages(getBaseUrl, getSessionId)
	registerAuthenticatedTools(server, cachedClient, getSession, authMessages)

	// Register resources
	registerResources(server, cachedClient, getSession)

	// Register prompts
	registerPrompts(server)

	return {
		server,
		setContext: (ctx: Partial<McpRequestContext>) => {
			if (ctx.session !== undefined) context.session = ctx.session
			if (ctx.baseUrl !== undefined) context.baseUrl = ctx.baseUrl
			if (ctx.sessionId !== undefined) context.sessionId = ctx.sessionId
		},
		getContext: () => ({ ...context }),
	}
}
