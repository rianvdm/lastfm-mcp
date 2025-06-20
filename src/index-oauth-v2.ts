/**
 * ABOUTME: Last.fm MCP Server with OAuth 2.0 - Main entry point
 * ABOUTME: Exports OAuthProvider instance that wraps the entire worker with authentication
 */

import { createOAuthProvider } from './oauth/provider'
import type { Env } from './types/env'

/**
 * Main OAuth-enabled worker export
 * The OAuthProvider handles all routing and authentication automatically
 */
export default createOAuthProvider({} as Env)