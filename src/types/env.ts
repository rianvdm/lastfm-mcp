// ABOUTME: TypeScript interface for Cloudflare Worker environment bindings.
// ABOUTME: Defines API keys, secrets, KV namespaces and the rate limiting binding used by the worker.
import type { RateLimit } from '@cloudflare/workers-types'

export interface Env {
	// Last.fm API credentials
	LASTFM_API_KEY: string
	LASTFM_SHARED_SECRET: string

	// HMAC key (32+ characters) for the signed cookie that remembers consent approvals.
	// Optional: a secret can be missing at runtime, and then approvals simply aren't remembered.
	CONSENT_SECRET?: string

	// KV namespaces for rate limiting and sessions.
	// Logging goes to Workers Observability (configured in wrangler.toml), not KV.
	MCP_RL: KVNamespace
	MCP_SESSIONS: KVNamespace

	// OAuth provider KV namespace (required by @cloudflare/workers-oauth-provider)
	OAUTH_KV: KVNamespace

	// Per-IP budget for POST /oauth/register (Rate Limiting binding, configured in wrangler.toml)
	REGISTRATION_RATE_LIMITER: RateLimit
}
