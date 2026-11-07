// ABOUTME: Tests for the OAuth consent page renderer and its error page.
// ABOUTME: Covers client-name verification states, loopback warning, escaping, form fields and CSP-friendliness.
import { describe, it, expect } from 'vitest'
import type { ConsentDescription } from '@cloudflare/workers-oauth-provider'

import { LASTFM_CONSENT_BRANDING, renderConsentErrorPage, renderConsentPage } from '../../src/auth/consent-page'

const HEADLINE = 'An app wants to read your Last.fm listening data'
const LOOPBACK_WARNING = 'This sends access to an app on your computer. Continue only if you just started connecting from that app.'

const dcr: ConsentDescription = {
	clientId: 'client-1',
	clientName: 'Music Helper',
	redirectUri: 'https://musichelper.example/callback',
	redirectHost: 'musichelper.example',
	redirectIsLoopback: false,
	scope: [],
}

const cimd: ConsentDescription = {
	...dcr,
	clientName: 'Claude',
	clientDomain: 'claude.ai',
	redirectUri: 'https://claude.ai/api/mcp/auth_callback',
	redirectHost: 'claude.ai',
}

const loopback: ConsentDescription = {
	...dcr,
	clientName: 'Cursor',
	redirectUri: 'http://localhost:3000/callback',
	redirectHost: 'localhost',
	redirectIsLoopback: true,
}

const render = (details: ConsentDescription, handle = 'handle-123') => renderConsentPage(details, handle, LASTFM_CONSENT_BRANDING)

describe('renderConsentPage', () => {
	it('should show the verified domain for a CIMD client', () => {
		const html = render(cimd)
		expect(html).toContain('Published by claude.ai (verified)')
		expect(html).not.toContain('been checked')
	})

	it('should quote the name and flag it as unchecked for a registered client', () => {
		const html = render(dcr)
		expect(html).toContain('“Music Helper”')
		expect(html).toMatch(/The app chose this name itself\. It hasn(&#039;|')t been checked\./)
		expect(html).not.toContain('Published by')
	})

	it('should show the redirect hostname', () => {
		expect(render(dcr)).toContain('musichelper.example')
	})

	it('should warn and omit the remember line for a loopback redirect', () => {
		const html = render(loopback)
		expect(html).toContain(LOOPBACK_WARNING)
		expect(html).not.toContain('for a year')
	})

	it('should show the remember line and no warning otherwise', () => {
		const html = render(dcr)
		expect(html).toMatch(/You won(&#039;|')t be asked again for this app for a year\./)
		expect(html).not.toContain(LOOPBACK_WARNING)
	})

	it('should link to the privacy page', () => {
		expect(render(dcr)).toContain('href="https://elezea.com/privacy/#lastfm-mcp-server"')
	})

	it('should escape client-supplied strings', () => {
		const html = render({
			...dcr,
			clientName: '<script>alert(1)</script>"',
			clientDomain: '<img src=x>',
			redirectHost: 'a"><img>',
		})
		expect(html).not.toContain('<script>')
		expect(html).not.toContain('<img')
		expect(html).toContain('&lt;script&gt;')
	})

	it('should post the handle back to /authorize', () => {
		const html = render(dcr, 'a"b<c')
		expect(html).toContain('method="post"')
		expect(html).toContain('action="/authorize"')
		expect(html).toContain('name="handle" value="a&quot;b&lt;c"')
		expect(html).toContain('name="decision" value="approve"')
		expect(html).toContain('name="decision" value="deny"')
		expect(html).toContain('Continue to Last.fm')
		expect(html).toMatch(/Don(&#039;|')t allow/)
	})

	it('should not name the app in the headline', () => {
		const h1 = /<h1>(.*?)<\/h1>/s.exec(render(dcr))
		expect(h1?.[1]).toBe(HEADLINE)
	})

	it('should include the wordmark and a viewport meta tag', () => {
		const html = render(dcr)
		expect(html).toContain('Last.fm MCP')
		expect(html).toContain('<meta name="viewport"')
	})

	it('should load nothing from other origins', () => {
		for (const details of [dcr, cimd, loopback]) {
			const html = render(details)
			expect(html).not.toContain('<link')
			expect(html).not.toContain('<script')
			expect(html).not.toContain('src=')
			expect(html).not.toContain('@import')
		}
	})
})

describe('renderConsentErrorPage', () => {
	it('should show the message and tell the user to start again from their app', () => {
		const html = renderConsentErrorPage('This request has expired.', LASTFM_CONSENT_BRANDING)
		expect(html).toContain('This request has expired.')
		expect(html).toContain('return to your app and connect again')
		expect(html).toContain('Last.fm MCP')
	})

	it('should escape the message', () => {
		const html = renderConsentErrorPage('<script>x</script>', LASTFM_CONSENT_BRANDING)
		expect(html).not.toContain('<script>')
	})

	it('should load nothing from other origins', () => {
		const html = renderConsentErrorPage('x', LASTFM_CONSENT_BRANDING)
		expect(html).not.toContain('<link')
		expect(html).not.toContain('<script')
		expect(html).not.toContain('src=')
	})
})
