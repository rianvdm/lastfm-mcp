// ABOUTME: Tool registration entry point for the MCP server.
// ABOUTME: Re-exports tool registration functions from public and authenticated modules.

export { registerPublicTools } from './public'
export { toolError } from './error-handler'
export { registerAuthenticatedTools, type AuthSession, type LastfmOAuthProps } from './authenticated'
