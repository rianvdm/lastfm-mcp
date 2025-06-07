/**
 * Environment variables and bindings for the Cloudflare Worker
 */
export interface Env {
  // Discogs OAuth credentials
  DISCOGS_CONSUMER_KEY: string
  DISCOGS_CONSUMER_SECRET: string
  
  // JWT secret for signing session cookies
  JWT_SECRET: string
  
  // KV namespaces (will be added in later steps)
  // MCP_LOGS: KVNamespace
  // MCP_RL: KVNamespace
  // MCP_SESSIONS: KVNamespace
} 