import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'

/**
 * Environment variables and bindings for the Cloudflare Worker
 */
export interface Env {
	// Last.fm API credentials
	LASTFM_API_KEY: string
	LASTFM_SHARED_SECRET: string

	// JWT secret for signing session cookies
	JWT_SECRET: string

	// OAuth encryption key for token storage
	OAUTH_ENCRYPTION_KEY?: string

	// KV namespaces for logging, rate limiting, and sessions
	MCP_LOGS: KVNamespace
	MCP_RL: KVNamespace
	MCP_SESSIONS: KVNamespace

	// OAuth KV namespace (used by workers-oauth-provider)
	OAUTH_KV: KVNamespace

	// OAuth provider helpers (injected by workers-oauth-provider)
	OAUTH_PROVIDER?: OAuthHelpers
}
