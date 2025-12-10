/**
 * Tool registration entry point
 *
 * Re-exports tool registration functions from public and authenticated modules.
 */

export { registerPublicTools } from './public'
export { registerAuthenticatedTools, registerAuthenticatedToolsWithOAuth, type AuthSession, type LastfmOAuthProps } from './authenticated'
