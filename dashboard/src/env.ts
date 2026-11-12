// ABOUTME: Bindings, vars and secrets for the lastfm-mcp-stats dashboard Worker, as dashboard/wrangler.toml declares them.
// ABOUTME: Kept separate from the MCP Worker's Env: the dashboard reads production data through the Cloudflare API, not bindings.

export interface DashEnv {
	/** The dashboard's own cache: summaries the hourly cron writes and the page reads */
	DASH_KV: KVNamespace
	/** Secret: Cloudflare API token for reading the production Worker's OAUTH_KV and Analytics Engine data */
	CF_API_TOKEN: string
	/**
	 * Secret: the HMAC key that turns user IDs into the hashes active-user markers are keyed by. At least 32 characters;
	 * while it's missing or shorter, active users aren't recorded and the page says they're not configured.
	 */
	ACTIVE_USER_HMAC_KEY?: string
	ACCOUNT_ID: string
	/** The production MCP Worker's OAUTH_KV namespace, read through the Cloudflare API */
	OAUTH_KV_NAMESPACE_ID: string
	/** The production MCP Worker's script name */
	SCRIPT_NAME: string
	/** The production Analytics Engine dataset that receives tool-call events */
	TOOL_EVENTS_DATASET: string
	/** The Access team domain that issues and signs the JWTs, without a scheme (e.g. `elezea.cloudflareaccess.com`) */
	ACCESS_TEAM_DOMAIN: string
	/** The Access application's audience tag. When it's empty, every request is refused. */
	ACCESS_AUD: string
}
