// ABOUTME: HTML escaping for text interpolated into server-rendered pages.
// ABOUTME: Used by the consent page to keep client-supplied names and URIs from injecting markup.

/**
 * Sanitize text for safe HTML rendering (prevent XSS).
 */
export function sanitizeText(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}
