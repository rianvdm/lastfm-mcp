// ABOUTME: OAuth 2.0 client management utilities for Claude native integration
// ABOUTME: Handles client registration, credential generation, and validation

import type { Env } from '../types/env'
import {
	OAuthClient,
	OAuthAuthorizationCode,
	OAuthAccessToken,
	OAuthError,
	OAUTH_ERRORS,
	OAUTH_SCOPES,
	type OAuthScope,
} from '../types/oauth'

/**
 * Generate a cryptographically secure random OAuth client ID
 */
export function generateClientId(): string {
	const array = new Uint8Array(16)
	crypto.getRandomValues(array)
	return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a cryptographically secure random OAuth client secret
 */
export function generateClientSecret(): string {
	const array = new Uint8Array(32)
	crypto.getRandomValues(array)
	return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a cryptographically secure authorization code
 */
export function generateAuthorizationCode(): string {
	const array = new Uint8Array(24)
	crypto.getRandomValues(array)
	return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Register a new OAuth client in the system
 */
export async function registerOAuthClient(
	env: Env,
	name: string,
	redirectUris: string[],
	allowedScopes: OAuthScope[] = [
		OAUTH_SCOPES.READ_LISTENING_HISTORY,
		OAUTH_SCOPES.READ_RECOMMENDATIONS,
		OAUTH_SCOPES.READ_PROFILE,
		OAUTH_SCOPES.READ_LIBRARY,
	],
): Promise<OAuthClient> {
	const clientId = generateClientId()
	const clientSecret = generateClientSecret()

	const client: OAuthClient = {
		id: clientId,
		secret: clientSecret,
		name,
		redirectUris,
		allowedScopes,
		createdAt: Date.now(),
		active: true,
	}

	// Store client in KV namespace
	await env.OAUTH_CLIENTS.put(clientId, JSON.stringify(client))

	return client
}

/**
 * Retrieve OAuth client by ID
 */
export async function getOAuthClient(env: Env, clientId: string): Promise<OAuthClient | null> {
	try {
		const clientData = await env.OAUTH_CLIENTS.get(clientId)
		if (!clientData) {
			return null
		}

		return JSON.parse(clientData) as OAuthClient
	} catch (error) {
		console.error('Error retrieving OAuth client:', error)
		return null
	}
}

/**
 * Validate OAuth client credentials
 */
export async function validateOAuthClient(env: Env, clientId: string, clientSecret?: string): Promise<OAuthClient> {
	const client = await getOAuthClient(env, clientId)

	if (!client) {
		throw new OAuthError(OAUTH_ERRORS.INVALID_CLIENT, 'Client not found', 401)
	}

	if (!client.active) {
		throw new OAuthError(OAUTH_ERRORS.INVALID_CLIENT, 'Client is inactive', 401)
	}

	// If client secret is provided, validate it
	if (clientSecret !== undefined && client.secret !== clientSecret) {
		throw new OAuthError(OAUTH_ERRORS.INVALID_CLIENT, 'Invalid client credentials', 401)
	}

	return client
}

/**
 * Validate redirect URI against registered URIs
 */
export function validateRedirectUri(client: OAuthClient, redirectUri: string): void {
	if (!client.redirectUris.includes(redirectUri)) {
		throw new OAuthError(OAUTH_ERRORS.INVALID_REQUEST, 'Redirect URI not registered for this client', 400)
	}
}

/**
 * Validate and normalize requested scopes
 */
export function validateScopes(client: OAuthClient, requestedScopes?: string): string[] {
	if (!requestedScopes) {
		// Default to all allowed scopes for this client
		return client.allowedScopes
	}

	const scopes = requestedScopes.split(' ').filter(Boolean)
	const validScopes: string[] = []

	for (const scope of scopes) {
		if (!client.allowedScopes.includes(scope)) {
			throw new OAuthError(OAUTH_ERRORS.INVALID_SCOPE, `Scope '${scope}' not allowed for this client`, 400)
		}
		validScopes.push(scope)
	}

	if (validScopes.length === 0) {
		throw new OAuthError(OAUTH_ERRORS.INVALID_SCOPE, 'No valid scopes requested', 400)
	}

	return validScopes
}

/**
 * Store authorization code with metadata
 */
export async function storeAuthorizationCode(
	env: Env,
	code: string,
	clientId: string,
	userId: string,
	username: string,
	scope: string,
	redirectUri: string,
): Promise<void> {
	const now = Date.now()
	const authCode: OAuthAuthorizationCode = {
		code,
		clientId,
		userId,
		username,
		scope,
		redirectUri,
		createdAt: now,
		expiresAt: now + 10 * 60 * 1000, // 10 minutes
	}

	// Store with 10 minute TTL
	await env.OAUTH_CODES.put(code, JSON.stringify(authCode), {
		expirationTtl: 600, // 10 minutes in seconds
	})
}

/**
 * Retrieve and validate authorization code
 */
export async function validateAuthorizationCode(
	env: Env,
	code: string,
	clientId: string,
	redirectUri: string,
): Promise<OAuthAuthorizationCode> {
	const codeData = await env.OAUTH_CODES.get(code)

	if (!codeData) {
		throw new OAuthError(OAUTH_ERRORS.INVALID_GRANT, 'Authorization code not found or expired', 400)
	}

	let authCode: OAuthAuthorizationCode
	try {
		authCode = JSON.parse(codeData) as OAuthAuthorizationCode
	} catch {
		throw new OAuthError(OAUTH_ERRORS.SERVER_ERROR, 'Failed to parse authorization code', 500)
	}

	// Validate code hasn't expired
	if (Date.now() > authCode.expiresAt) {
		await env.OAUTH_CODES.delete(code) // Clean up expired code
		throw new OAuthError(OAUTH_ERRORS.INVALID_GRANT, 'Authorization code expired', 400)
	}

	// Validate client ID matches
	if (authCode.clientId !== clientId) {
		throw new OAuthError(OAUTH_ERRORS.INVALID_GRANT, 'Client ID mismatch', 400)
	}

	// Validate redirect URI matches
	if (authCode.redirectUri !== redirectUri) {
		throw new OAuthError(OAUTH_ERRORS.INVALID_GRANT, 'Redirect URI mismatch', 400)
	}

	// Delete the code (single use only)
	await env.OAUTH_CODES.delete(code)

	return authCode
}

/**
 * Store OAuth access token
 */
export async function storeAccessToken(
	env: Env,
	token: string,
	clientId: string,
	userId: string,
	username: string,
	scope: string,
	expiresInSeconds: number = 7 * 24 * 60 * 60, // 7 days
): Promise<void> {
	const now = Date.now()
	const accessToken: OAuthAccessToken = {
		token,
		clientId,
		userId,
		username,
		scope,
		createdAt: now,
		expiresAt: now + expiresInSeconds * 1000,
	}

	// Store with appropriate TTL
	await env.OAUTH_TOKENS.put(token, JSON.stringify(accessToken), {
		expirationTtl: expiresInSeconds,
	})
}

/**
 * Retrieve and validate OAuth access token
 */
export async function validateAccessToken(env: Env, token: string): Promise<OAuthAccessToken> {
	const tokenData = await env.OAUTH_TOKENS.get(token)

	if (!tokenData) {
		throw new OAuthError(OAUTH_ERRORS.INVALID_GRANT, 'Access token not found or expired', 401)
	}

	let accessToken: OAuthAccessToken
	try {
		accessToken = JSON.parse(tokenData) as OAuthAccessToken
	} catch {
		throw new OAuthError(OAUTH_ERRORS.SERVER_ERROR, 'Failed to parse access token', 500)
	}

	// Validate token hasn't expired
	if (Date.now() > accessToken.expiresAt) {
		await env.OAUTH_TOKENS.delete(token) // Clean up expired token
		throw new OAuthError(OAUTH_ERRORS.INVALID_GRANT, 'Access token expired', 401)
	}

	return accessToken
}

/**
 * Revoke an OAuth access token
 */
export async function revokeAccessToken(env: Env, token: string): Promise<void> {
	await env.OAUTH_TOKENS.delete(token)
}

/**
 * List all registered OAuth clients (for admin purposes)
 */
export async function listOAuthClients(_env: Env): Promise<Omit<OAuthClient, 'secret'>[]> {
	// Note: KV namespace doesn't have a built-in list operation
	// This would require maintaining a separate index or using List operations
	// For now, this is a placeholder for future implementation
	throw new Error('listOAuthClients not implemented - requires index maintenance')
}

/**
 * Update OAuth client configuration
 */
export async function updateOAuthClient(
	env: Env,
	clientId: string,
	updates: Partial<Pick<OAuthClient, 'name' | 'redirectUris' | 'allowedScopes' | 'active'>>,
): Promise<OAuthClient> {
	const client = await getOAuthClient(env, clientId)

	if (!client) {
		throw new OAuthError(OAUTH_ERRORS.INVALID_CLIENT, 'Client not found', 404)
	}

	const updatedClient: OAuthClient = {
		...client,
		...updates,
	}

	await env.OAUTH_CLIENTS.put(clientId, JSON.stringify(updatedClient))

	return updatedClient
}

/**
 * Create a default Claude integration client for development/testing
 */
export async function createClaudeClient(env: Env): Promise<OAuthClient> {
	return await registerOAuthClient(
		env,
		'Claude AI Integration',
		[
			'https://claude.ai/oauth/callback',
			'https://app.claude.ai/oauth/callback',
			'http://localhost:3000/oauth/callback', // For development
		],
		[OAUTH_SCOPES.READ_LISTENING_HISTORY, OAUTH_SCOPES.READ_RECOMMENDATIONS, OAUTH_SCOPES.READ_PROFILE, OAUTH_SCOPES.READ_LIBRARY],
	)
}
