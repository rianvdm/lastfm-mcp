// ABOUTME: Tests for the landing page builder in src/pages/landing.ts.
// ABOUTME: Checks the copy, origin-filled setup snippets, head links, and that setup panels stay readable without JavaScript.
import { describe, it, expect } from 'vitest'

import { buildLandingPage } from '../../src/pages/landing'

const ORIGIN = 'https://staging.example'

describe('buildLandingPage', () => {
	it('leads with the headline', () => {
		expect(buildLandingPage(ORIGIN)).toContain("Ask your AI about everything you've ever listened to.")
	})

	it('points every copyable address at the origin it was served from', () => {
		const html = buildLandingPage(ORIGIN)

		expect(html).toContain(`${ORIGIN}/mcp`)
		expect(html).toContain(`${ORIGIN}/llms.txt`)
		expect(html).not.toContain('{{')
	})

	it('keeps the canonical URL on production', () => {
		// Prettier prints void elements as `<link ... />`, so match up to the end of the href
		expect(buildLandingPage(ORIGIN)).toMatch(/<link rel="canonical" href="https:\/\/lastfm-mcp\.com"\s*\/?>/)
	})

	it('loads fonts from Google Fonts and nothing from unpkg', () => {
		const html = buildLandingPage(ORIGIN)

		expect(html).toContain('fonts.googleapis.com')
		expect(html).not.toContain('unpkg.com')
	})

	it('never says access can be revoked', () => {
		expect(buildLandingPage(ORIGIN)).not.toMatch(/revoke/i)
	})

	it('serves every setup panel without the hidden attribute, so they show stacked without JavaScript', () => {
		const panels = buildLandingPage(ORIGIN).match(/<[^>]*role="tabpanel"[^>]*>/g) ?? []

		expect(panels).toHaveLength(3)
		for (const panel of panels) {
			expect(panel).not.toMatch(/\shidden(\s|=|>)/)
		}
	})

	it('has the ask and setup anchors and links llms.txt for agents', () => {
		const html = buildLandingPage(ORIGIN)

		expect(html).toContain('id="ask"')
		expect(html).toContain('id="setup"')
		expect(html).toContain('<link rel="alternate" type="text/plain" href="/llms.txt"')
	})

	describe('the wave', () => {
		it('cycles through every hand-written label from the spec', () => {
			const html = buildLandingPage(ORIGIN)

			for (const label of [
				'2009 · post-rock phase',
				'2011 · that one Bon Iver winter',
				'2016 · 400 plays of one album',
				'2019 · back to the 90s',
				'2024 · jazz, apparently',
				'2026 · everything at once',
			]) {
				expect(html).toContain(label)
			}
		})

		it('checks for reduced motion in the script, not only in CSS', () => {
			expect(buildLandingPage(ORIGIN)).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
		})

		it('pauses when the tab is hidden or the hero scrolls off screen', () => {
			const html = buildLandingPage(ORIGIN)

			expect(html).toContain('visibilitychange')
			expect(html).toContain('IntersectionObserver')
		})
	})
})
