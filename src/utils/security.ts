// ABOUTME: Security utilities for CSRF protection and Content Security Policy headers.
// ABOUTME: Used by OAuth and manual login flows to prevent cross-site attacks and XSS.

/**
 * Generate a CSRF token and a secure cookie to store it.
 * Uses a Secure, HttpOnly, SameSite=Lax cookie.
 */
export function generateCSRFProtection(): { token: string; setCookie: string } {
	const token = crypto.randomUUID()
	const setCookie = `_csrf_token=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`
	return { token, setCookie }
}

/**
 * Validate that the CSRF token from the state parameter matches the one in the cookie.
 * Returns the clear-cookie header on success, throws on mismatch.
 */
export function validateCSRFToken(stateToken: string, request: Request): { clearCookie: string } {
	const cookieHeader = request.headers.get('Cookie') || ''
	const tokenFromCookie = cookieHeader
		.split(';')
		.find((c) => c.trim().startsWith('_csrf_token='))
		?.split('=')[1]
		?.trim()

	if (!tokenFromCookie) {
		throw new Error('Missing CSRF cookie - login session may have expired')
	}

	if (stateToken !== tokenFromCookie) {
		throw new Error('CSRF token mismatch - please try logging in again')
	}

	return {
		clearCookie: '_csrf_token=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0',
	}
}

/**
 * Build security headers for HTML responses.
 * Includes Content Security Policy, frame protection, and content type sniffing prevention.
 */
export function buildSecurityHeaders(options?: { setCookie?: string; nonce?: string }): HeadersInit {
	const cspDirectives = [
		"default-src 'none'",
		"script-src 'self'" + (options?.nonce ? ` 'nonce-${options.nonce}'` : ''),
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' https:",
		"font-src 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"connect-src 'self'",
	].join('; ')

	const headers: Record<string, string> = {
		'Content-Security-Policy': cspDirectives,
		'X-Frame-Options': 'DENY',
		'X-Content-Type-Options': 'nosniff',
		'Content-Type': 'text/html; charset=utf-8',
	}

	if (options?.setCookie) {
		headers['Set-Cookie'] = options.setCookie
	}

	return headers
}

/**
 * Sanitize text for safe HTML rendering (prevent XSS).
 */
export function sanitizeText(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}
