// ABOUTME: Tool registration entry point for the MCP server.
// ABOUTME: Re-exports tool registration functions from public and authenticated modules.

export { registerPublicTools } from './public'
export {
	registerAuthenticatedTools,
	registerAuthenticatedToolsWithOAuth,
	buildSessionAuthMessages,
	buildOAuthAuthMessages,
	type AuthSession,
	type AuthMessageConfig,
	type LastfmOAuthProps,
} from './authenticated'
