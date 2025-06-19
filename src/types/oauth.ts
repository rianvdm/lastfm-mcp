// ABOUTME: OAuth 2.0 data types and interfaces for Claude native integration support
// ABOUTME: Defines TypeScript interfaces for OAuth clients, authorization codes, and access tokens

/**
 * OAuth client registration data stored in OAUTH_CLIENTS KV namespace
 */
export interface OAuthClient {
	/** Unique client identifier */
	id: string
	/** Client secret for authentication */
	secret: string
	/** Human-readable client name */
	name: string
	/** Allowed redirect URIs for this client */
	redirectUris: string[]
	/** Allowed OAuth scopes for this client */
	allowedScopes: string[]
	/** Timestamp when client was created */
	createdAt: number
	/** Whether client is active */
	active: boolean
}

/**
 * Temporary authorization code data stored in OAUTH_CODES KV namespace
 * These expire after 10 minutes per OAuth 2.0 spec
 */
export interface OAuthAuthorizationCode {
	/** Authorization code value */
	code: string
	/** Client ID that requested this code */
	clientId: string
	/** User ID from Last.fm session */
	userId: string
	/** Last.fm username */
	username: string
	/** Approved scopes for this authorization */
	scope: string
	/** Original redirect URI to validate against */
	redirectUri: string
	/** Timestamp when code was created */
	createdAt: number
	/** Timestamp when code expires (createdAt + 10 minutes) */
	expiresAt: number
}

/**
 * OAuth access token data stored in OAUTH_TOKENS KV namespace
 * Links OAuth tokens to Last.fm user sessions
 */
export interface OAuthAccessToken {
	/** Access token value (JWT) */
	token: string
	/** Client ID that owns this token */
	clientId: string
	/** User ID from Last.fm session */
	userId: string
	/** Last.fm username */
	username: string
	/** Granted scopes for this token */
	scope: string
	/** Timestamp when token was created */
	createdAt: number
	/** Timestamp when token expires */
	expiresAt: number
	/** Optional refresh token for token renewal */
	refreshToken?: string
}

/**
 * OAuth scope definitions for Claude integrations
 */
export const OAUTH_SCOPES = {
	/** Read user's Last.fm listening history */
	READ_LISTENING_HISTORY: 'read:listening_history',
	/** Get music recommendations based on user data */
	READ_RECOMMENDATIONS: 'read:recommendations',
	/** Access user's basic profile information */
	READ_PROFILE: 'read:profile',
	/** Access user's loved tracks and library */
	READ_LIBRARY: 'read:library',
} as const

export type OAuthScope = typeof OAUTH_SCOPES[keyof typeof OAUTH_SCOPES]

/**
 * OAuth authorization request parameters
 */
export interface OAuthAuthorizationRequest {
	/** Client ID requesting authorization */
	client_id: string
	/** Redirect URI for callback */
	redirect_uri: string
	/** Must be 'code' for authorization code flow */
	response_type: 'code'
	/** Requested scopes (space-separated) */
	scope?: string
	/** Anti-CSRF state parameter */
	state?: string
}

/**
 * OAuth token request parameters
 */
export interface OAuthTokenRequest {
	/** Grant type - 'authorization_code' or 'refresh_token' */
	grant_type: 'authorization_code' | 'refresh_token'
	/** Authorization code (for authorization_code grant) */
	code?: string
	/** Refresh token (for refresh_token grant) */
	refresh_token?: string
	/** Client ID */
	client_id: string
	/** Client secret */
	client_secret: string
	/** Redirect URI (must match authorization request) */
	redirect_uri?: string
}

/**
 * OAuth token response
 */
export interface OAuthTokenResponse {
	/** Access token for API requests */
	access_token: string
	/** Token type - always 'Bearer' */
	token_type: 'Bearer'
	/** Token expiration time in seconds */
	expires_in: number
	/** Granted scopes (space-separated) */
	scope?: string
	/** Refresh token for token renewal */
	refresh_token?: string
}

/**
 * OAuth error response
 */
export interface OAuthErrorResponse {
	/** Error code */
	error: string
	/** Human-readable error description */
	error_description?: string
	/** URI with error information */
	error_uri?: string
}

/**
 * Authentication context derived from OAuth token
 */
export interface OAuthAuthContext {
	/** User ID from Last.fm */
	userId: string
	/** Last.fm username */
	username: string
	/** Client ID that owns the token */
	clientId: string
	/** Granted scopes */
	scopes: string[]
	/** Whether user is authenticated */
	isAuthenticated: true
}

/**
 * Utility type for OAuth-related errors
 */
export class OAuthError extends Error {
	constructor(
		public readonly error: string,
		public readonly description?: string,
		public readonly statusCode: number = 400
	) {
		super(description || error)
		this.name = 'OAuthError'
	}
}

/**
 * OAuth 2.0 standard error codes
 */
export const OAUTH_ERRORS = {
	INVALID_REQUEST: 'invalid_request',
	INVALID_CLIENT: 'invalid_client',
	INVALID_GRANT: 'invalid_grant',
	UNAUTHORIZED_CLIENT: 'unauthorized_client',
	UNSUPPORTED_GRANT_TYPE: 'unsupported_grant_type',
	INVALID_SCOPE: 'invalid_scope',
	ACCESS_DENIED: 'access_denied',
	SERVER_ERROR: 'server_error',
} as const

export type OAuthErrorCode = typeof OAUTH_ERRORS[keyof typeof OAUTH_ERRORS]