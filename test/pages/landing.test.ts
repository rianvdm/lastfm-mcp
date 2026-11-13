// ABOUTME: Tests for the landing page builder in src/pages/landing.ts.
// ABOUTME: Checks the copy, origin-filled setup snippets, share and search metadata, the FAQ, and no-JavaScript readability.
import { describe, it, expect } from 'vitest'

import { FAQ_ITEMS } from '../../src/pages/faq'
import { buildLandingPage } from '../../src/pages/landing'
import { runWave, type WaveHarness } from './wave-harness'

const ORIGIN = 'https://staging.example'

const TITLE = 'Last.fm MCP: connect your Last.fm history to Claude, ChatGPT and other AI assistants'
const DESCRIPTION =
	'Ask your AI when you first heard an album, what you had on repeat last summer, or what to play next. Free and open source, and it only reads.'
const IMAGE_ALT = "Last.fm MCP: Ask your AI about everything you've ever listened to."

/** Attributes of every tag named `tag`, parsed loosely so Prettier's `/>` and line breaks don't matter. */
function tagAttributes(html: string, tag: string): Record<string, string>[] {
	const tags = html.match(new RegExp(`<${tag}\\b[^>]*>`, 'g')) ?? []
	return tags.map((t) => Object.fromEntries([...t.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value])))
}

/** The content of the one meta tag whose `key` attribute (name or property) equals `value`. */
function metaContent(html: string, key: 'name' | 'property', value: string): string | undefined {
	const matches = tagAttributes(html, 'meta').filter((attributes) => attributes[key] === value)
	expect(matches.length, `meta ${key}="${value}"`).toBeLessThanOrEqual(1)
	return matches[0]?.content
}

/** The page's one JSON-LD block, parsed. */
function structuredData(html: string): { '@context': string; '@graph': Record<string, unknown>[] } {
	const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
	expect(blocks).toHaveLength(1)
	return JSON.parse(blocks[0][1])
}

function graphNode(html: string, type: string): Record<string, unknown> {
	const nodes = structuredData(html)['@graph'].filter((node) => node['@type'] === type)
	expect(nodes, type).toHaveLength(1)
	return nodes[0]
}

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

	describe('sharing and search metadata', () => {
		const html = buildLandingPage(ORIGIN)

		it('has the title and description from the spec, and no keywords meta', () => {
			expect(html).toContain(`<title>${TITLE}</title>`)
			expect(metaContent(html, 'name', 'description')).toBe(DESCRIPTION)
			expect(metaContent(html, 'name', 'keywords')).toBeUndefined()
		})

		it('has every Open Graph tag, pointing at production', () => {
			expect(metaContent(html, 'property', 'og:type')).toBe('website')
			expect(metaContent(html, 'property', 'og:site_name')).toBe('Last.fm MCP')
			expect(metaContent(html, 'property', 'og:title')).toBe(TITLE)
			expect(metaContent(html, 'property', 'og:description')).toBe(DESCRIPTION)
			expect(metaContent(html, 'property', 'og:url')).toBe('https://lastfm-mcp.com/')
			expect(metaContent(html, 'property', 'og:image')).toBe('https://lastfm-mcp.com/og.png')
			expect(metaContent(html, 'property', 'og:image:width')).toBe('1200')
			expect(metaContent(html, 'property', 'og:image:height')).toBe('630')
			expect(metaContent(html, 'property', 'og:image:alt')).toBe(IMAGE_ALT)
		})

		it('has a large-image Twitter card that matches the Open Graph tags', () => {
			expect(metaContent(html, 'name', 'twitter:card')).toBe('summary_large_image')
			expect(metaContent(html, 'name', 'twitter:title')).toBe(TITLE)
			expect(metaContent(html, 'name', 'twitter:description')).toBe(DESCRIPTION)
			expect(metaContent(html, 'name', 'twitter:image')).toBe('https://lastfm-mcp.com/og.png')
			expect(metaContent(html, 'name', 'twitter:image:alt')).toBe(IMAGE_ALT)
		})

		it('links the apple-touch-icon', () => {
			const icons = tagAttributes(html, 'link').filter((attributes) => attributes.rel === 'apple-touch-icon')

			expect(icons).toEqual([{ rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }])
		})

		it('has one JSON-LD graph with WebSite, SoftwareApplication and FAQPage nodes', () => {
			expect(structuredData(html)['@context']).toBe('https://schema.org')
			expect(graphNode(html, 'WebSite')).toMatchObject({ name: 'Last.fm MCP', url: 'https://lastfm-mcp.com/' })

			const app = graphNode(html, 'SoftwareApplication')
			expect(app).toMatchObject({
				name: 'Last.fm MCP',
				url: 'https://lastfm-mcp.com/',
				applicationCategory: 'MultimediaApplication',
				operatingSystem: 'Any',
				offers: { '@type': 'Offer', price: '0' },
				author: { '@type': 'Person', name: 'Rian van der Merwe', url: 'https://elezea.com' },
				sameAs: ['https://github.com/rianvdm/lastfm-mcp'],
				screenshot: 'https://lastfm-mcp.com/og.png',
			})
			expect(app).not.toHaveProperty('softwareVersion')
			expect(Array.isArray(app.featureList)).toBe(true)

			expect(graphNode(html, 'FAQPage')).toBeDefined()
		})
	})

	describe('the FAQ', () => {
		const html = buildLandingPage(ORIGIN)

		it('replaces the marker with the FAQ section, between Set it up and What you are agreeing to', () => {
			expect(html).not.toContain('<!-- FAQ -->')
			const setup = html.indexOf('id="setup"')
			const faq = html.indexOf('id="faq"')
			const trust = html.indexOf('id="trust-heading"')
			expect(setup).toBeLessThan(faq)
			expect(faq).toBeLessThan(trust)
		})

		it('shows every question on the page and in the FAQPage JSON-LD', () => {
			const faqPage = graphNode(html, 'FAQPage') as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] }

			expect(faqPage.mainEntity.map((entity) => entity.name)).toEqual(FAQ_ITEMS.map((item) => item.question))
			for (const { question } of FAQ_ITEMS) {
				expect(html).toContain(`<h3>${question}</h3>`)
			}
		})

		it('keeps FAQ answers on the production address whatever origin serves the page', () => {
			const faqSection = html.slice(html.indexOf('id="faq"'), html.indexOf('id="trust-heading"'))

			expect(faqSection).toContain('https://lastfm-mcp.com/mcp')
			expect(faqSection).not.toContain(ORIGIN)
		})
	})

	describe('the wave', () => {
		it('includes every hand-written label line from the spec', () => {
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

		it('queries the reduced-motion preference from the script, not only in CSS', () => {
			expect(buildLandingPage(ORIGIN)).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
		})

		it('listens for visibilitychange and watches the hero with an IntersectionObserver', () => {
			const html = buildLandingPage(ORIGIN)

			expect(html).toContain('visibilitychange')
			expect(html).toContain('IntersectionObserver')
		})
	})

	describe('the wave script', () => {
		const html = buildLandingPage(ORIGIN)
		const swapInterval = 3500
		const fadeDuration = 1300

		it('swaps the early label, then the late one, each after a fade', () => {
			const wave = runWave(html)

			wave.advance(swapInterval)
			expect(wave.early.fading).toBe(true)
			wave.advance(fadeDuration)
			expect(wave.early).toMatchObject({ textContent: '2011 · that one Bon Iver winter', fading: false })

			wave.advance(swapInterval)
			expect(wave.late).toMatchObject({ textContent: '2026 · everything at once', fading: false })
		})

		it('starts nothing when reduced motion is on from the start', () => {
			const wave = runWave(html, { reducedMotion: true })

			expect(wave.pendingFrames()).toBe(0)
			expect(wave.pendingTimers()).toBe(0)
			wave.advance(20_000)
			expect(wave.early.textContent).toBe('2009 · post-rock phase')
			expect(wave.late.textContent).toBe('2024 · jazz, apparently')
		})

		const pauses = [
			{
				reason: 'reduced motion is turned on',
				pause: (w: WaveHarness) => w.setReducedMotion(true),
				resume: (w: WaveHarness) => w.setReducedMotion(false),
			},
			{ reason: 'the tab is hidden', pause: (w: WaveHarness) => w.setTabHidden(true), resume: (w: WaveHarness) => w.setTabHidden(false) },
			{
				reason: 'the hero leaves the screen',
				pause: (w: WaveHarness) => w.setHeroOnScreen(false),
				resume: (w: WaveHarness) => w.setHeroOnScreen(true),
			},
		]

		for (const { reason, pause, resume } of pauses) {
			it(`cancels a label fade in progress and leaves the label visible when ${reason}`, () => {
				const wave = runWave(html)
				wave.advance(swapInterval)
				expect(wave.early.fading).toBe(true)

				pause(wave)

				expect(wave.pendingFrames()).toBe(0)
				expect(wave.pendingTimers()).toBe(0)
				expect(wave.early).toMatchObject({ textContent: '2009 · post-rock phase', fading: false })
				wave.advance(fadeDuration * 2)
				expect(wave.early).toMatchObject({ textContent: '2009 · post-rock phase', fading: false })
			})

			it(`resumes with one frame loop and one label timer, and no stale swap, after ${reason}`, () => {
				const wave = runWave(html)
				wave.advance(swapInterval)
				pause(wave)
				wave.advance(fadeDuration * 2)

				resume(wave)
				resume(wave)

				expect(wave.pendingFrames()).toBe(1)
				expect(wave.pendingTimers()).toBe(1)
				// The interrupted swap is retried: the early label changes first, by one step
				wave.advance(swapInterval + fadeDuration)
				expect(wave.early.textContent).toBe('2011 · that one Bon Iver winter')
				expect(wave.late.textContent).toBe('2024 · jazz, apparently')
			})
		}
	})
})
