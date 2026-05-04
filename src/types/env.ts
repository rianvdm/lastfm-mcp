// ABOUTME: TypeScript interface for Cloudflare Worker environment bindings.
// ABOUTME: Defines API keys, secrets, and KV namespace bindings used by the worker.
export interface Env {
	// Last.fm API credentials
	LASTFM_API_KEY: string
	LASTFM_SHARED_SECRET: string

	// JWT secret for signing session cookies
	JWT_SECRET: string

	// KV namespaces for rate limiting and sessions.
	// Logging goes to Workers Observability (configured in wrangler.toml), not KV.
	MCP_RL: KVNamespace
	MCP_SESSIONS: KVNamespace

	// OAuth provider KV namespace (required by @cloudflare/workers-oauth-provider)
	OAUTH_KV: KVNamespace
}
