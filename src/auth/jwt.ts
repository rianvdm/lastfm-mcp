// ABOUTME: JWT token creation and verification for session management.
// ABOUTME: Uses the Web Crypto API (HMAC-SHA256) to sign and validate session tokens.

export interface SessionPayload {
	userId: string
	sessionKey: string
	username: string
	iat: number // issued at
	exp: number // expires at
}

/**
 * Create a signed JWT token containing user session data
 */
export async function createSessionToken(
	payload: Omit<SessionPayload, 'iat' | 'exp'>,
	secret: string,
	expiresInHours = 168,
): Promise<string> {
	const now = Math.floor(Date.now() / 1000)
	const fullPayload: SessionPayload = {
		...payload,
		iat: now,
		exp: now + expiresInHours * 3600,
	}

	// Create JWT header
	const header = {
		alg: 'HS256',
		typ: 'JWT',
	}

	// Encode header and payload
	const encodedHeader = base64UrlEncode(JSON.stringify(header))
	const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload))

	// Create signature
	const data = `${encodedHeader}.${encodedPayload}`
	const signature = await sign(data, secret)

	return `${data}.${signature}`
}

/**
 * Verify and decode a JWT session token
 */
export async function verifySessionToken(token: string, secret: string): Promise<SessionPayload | null> {
	try {
		const parts = token.split('.')
		if (parts.length !== 3) {
			return null
		}

		const [encodedHeader, encodedPayload, signature] = parts

		// Verify signature using constant-time comparison to prevent timing attacks
		const data = `${encodedHeader}.${encodedPayload}`
		const expectedSignature = await sign(data, secret)

		if (!timingSafeEqual(signature, expectedSignature)) {
			return null
		}

		// Decode payload
		const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload

		// Check expiration
		const now = Math.floor(Date.now() / 1000)
		if (payload.exp < now) {
			return null
		}

		return payload
	} catch (error) {
		console.error('JWT verification error:', error)
		return null
	}
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 * Encodes both strings as UTF-8 bytes and uses the Workers runtime
 * crypto.subtle.timingSafeEqual so that comparison time does not leak
 * information about the expected value.
 */
function timingSafeEqual(a: string, b: string): boolean {
	const encoder = new TextEncoder()
	const aBuf = encoder.encode(a)
	const bBuf = encoder.encode(b)

	if (aBuf.byteLength !== bBuf.byteLength) {
		return false
	}

	// timingSafeEqual is a Cloudflare Workers extension to SubtleCrypto.
	// The DOM lib types don't include it, but it is present in the runtime
	// and in @cloudflare/workers-types.
	const subtle = crypto.subtle as SubtleCrypto & {
		timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean
	}
	return subtle.timingSafeEqual(aBuf, bBuf)
}

/**
 * Sign data using HMAC-SHA256
 */
async function sign(data: string, secret: string): Promise<string> {
	const encoder = new TextEncoder()
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])

	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
	return base64UrlEncode(new Uint8Array(signature))
}

/**
 * Base64 URL encode (without padding)
 */
function base64UrlEncode(data: string | Uint8Array): string {
	let base64: string

	if (typeof data === 'string') {
		base64 = btoa(data)
	} else {
		// Convert Uint8Array to string
		const binary = Array.from(data, (byte) => String.fromCharCode(byte)).join('')
		base64 = btoa(binary)
	}

	return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Base64 URL decode
 */
function base64UrlDecode(encoded: string): string {
	// Add padding if needed
	let padded = encoded
	while (padded.length % 4) {
		padded += '='
	}

	// Convert URL-safe characters back
	const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')

	return atob(base64)
}
