/**
 * Environment variables and bindings for the Cloudflare Worker
 */
export interface Env {
	// Last.fm API credentials
	LASTFM_API_KEY: string
	LASTFM_SHARED_SECRET: string

	// JWT secret for signing session cookies
	JWT_SECRET: string

	// KV namespaces for logging, rate limiting, and sessions
	MCP_LOGS: KVNamespace
	MCP_RL: KVNamespace
	MCP_SESSIONS: KVNamespace

	// OAuth KV namespaces for Claude native integration
	OAUTH_CLIENTS: KVNamespace
	OAUTH_CODES: KVNamespace
	OAUTH_TOKENS: KVNamespace
}
