// ABOUTME: Tests for the landing page builder in src/pages/landing.ts.
// ABOUTME: Checks the copy, setup snippets, share and search metadata, the FAQ, no-JavaScript readability, and the hero insights.
import { describe, it, expect } from 'vitest'

import { FAQ_ITEMS } from '../../src/pages/faq'
import { buildLandingPage } from '../../src/pages/landing'
import { runWave, type WaveHarness } from './wave-harness'

const ORIGIN = 'https://staging.example'

const TITLE = 'Last.fm MCP: connect your Last.fm history to Claude, ChatGPT, and other AI assistants'
const DESCRIPTION =
	'Ask your AI when you first played an album, what you had on repeat last summer, or what to play next. Free and open source, and it only reads.'
const IMAGE_ALT = "Last.fm MCP: Ask your AI about everything you've ever listened to."

const INSIGHT_LINES = [
	'2007 · emo, briefly',
	'2009 · post-rock phase',
	'2011 · that one Bon Iver winter',
	'2013 · everything on Pitchfork',
	'2014 · film scores while working',
	'2016 · one album on repeat',
	'2018 · city pop rabbit hole',
	'2019 · back to the 90s',
	'2021 · lockdown ambient',
	'2023 · finally got into Talk Talk',
	'2024 · jazz, apparently',
	'2026 · everything at once',
]
const FIXED_INSIGHTS = [
	{ text: '2009 · post-rock phase', left: '8%', bottom: '150px' },
	{ text: '2018 · city pop rabbit hole', left: '40%', bottom: '110px' },
	{ text: '2024 · jazz, apparently', left: '70%', bottom: '160px' },
]

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

	it('has the hero subline and a setup button that promises no setup time', () => {
		const html = buildLandingPage(ORIGIN)
		const subline = html
			.match(/<p class="subline">([\s\S]*?)<\/p>/)?.[1]
			.replace(/\s+/g, ' ')
			.trim()

		expect(subline).toBe(
			'Connect your Last.fm history to Claude, ChatGPT, or another supported app. Ask when you first played an album, ' +
				'what you had on repeat last summer, or what to play next.',
		)
		expect(html).toContain('<a class="button" href="#setup">Set it up</a>')
		expect(html).not.toMatch(/first heard|two minutes/)
	})

	it('points every copyable address at the origin it was served from', () => {
		const html = buildLandingPage(ORIGIN)
		const blocks = [...html.matchAll(/<div class="code">\s*<pre><code>([\s\S]*?)<\/code><\/pre>\s*<button class="copy"/g)].map(
			([, code]) => code,
		)

		// Every Copy button sits under a block this test reads
		expect(blocks).toHaveLength(html.match(/<button class="copy"/g)?.length ?? 0)
		expect(blocks.length).toBeGreaterThan(0)
		for (const block of blocks) {
			const addresses = block.match(/https?:\/\/[^\s"'<]+/g) ?? []
			expect(addresses, block).not.toHaveLength(0)
			for (const address of addresses) {
				expect([`${ORIGIN}/mcp`, `${ORIGIN}/llms.txt`], block).toContain(address)
			}
		}
		const allAddresses = blocks.flatMap((block) => block.match(/https?:\/\/[^\s"'<]+/g) ?? [])
		expect(allAddresses).toContain(`${ORIGIN}/mcp`)
		expect(allAddresses).toContain(`${ORIGIN}/llms.txt`)
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
		const html = buildLandingPage(ORIGIN)

		it('serves all twelve insight lines, in order', () => {
			const positions = INSIGHT_LINES.map((line) => html.indexOf(`'${line}'`))

			for (const [index, position] of positions.entries()) {
				expect(position, INSIGHT_LINES[index]).toBeGreaterThan(-1)
			}
			expect([...positions].sort((a, b) => a - b)).toEqual(positions)
			expect(html).not.toContain('400 plays')
		})

		it('serves three empty insight slots hidden from assistive tech, and none of the old labels', () => {
			expect(html.match(/<span class="wave-insight" aria-hidden="true"><\/span>/g)).toHaveLength(3)
			expect(html.match(/class="wave-insight/g)).toHaveLength(3)
			expect(html).not.toContain('wave-label')
		})

		it('queries the reduced-motion preference from the script, not only in CSS', () => {
			expect(html).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
		})

		it('listens for visibilitychange and watches the hero with an IntersectionObserver', () => {
			expect(html).toContain('visibilitychange')
			expect(html).toContain('IntersectionObserver')
		})
	})

	describe('the wave script', () => {
		const html = buildLandingPage(ORIGIN)
		const seeds = Array.from({ length: 30 }, (_, index) => index + 1)

		/** When each slot first faded in, or undefined if it never did. */
		const firstShown = (wave: WaveHarness) =>
			[0, 1, 2].map((slot) => wave.events.find((event) => event.slot === slot && event.type === 'in')?.time)

		/** Advances until a label is fading out: it still has its text but has lost `is-in`. Returns its slot. */
		const untilFadingOut = (wave: WaveHarness) => {
			for (let step = 0; step < 2000; step++) {
				wave.advance(50)
				const slot = wave.insights().findIndex((state) => state.text !== '' && !state.visible)
				if (slot !== -1) return slot
			}
			throw new Error('No label started fading out')
		}

		describe('first appearances', () => {
			it('shows nothing before 700 ms, then every slot by 9 s, at least 1500 ms apart', async () => {
				for (const seed of seeds) {
					const wave = await runWave(html, { seed })
					wave.advance(699)
					expect(
						wave.events.filter((event) => event.type === 'in'),
						`seed ${seed}`,
					).toEqual([])

					wave.advance(9000 - 699)
					const times = firstShown(wave)
					expect(
						times.every((time) => time !== undefined && time >= 700 && time <= 9000),
						`seed ${seed}: ${times}`,
					).toBe(true)
					const sorted = (times as number[]).sort((a, b) => a - b)
					expect(sorted[1] - sorted[0], `seed ${seed}`).toBeGreaterThanOrEqual(1500)
					expect(sorted[2] - sorted[1], `seed ${seed}`).toBeGreaterThanOrEqual(1500)
				}
			})

			it('brings the slots in a different order from one load to the next', async () => {
				const orders = new Set<string>()
				for (const seed of seeds) {
					const wave = await runWave(html, { seed })
					wave.advance(9000)
					const times = firstShown(wave) as number[]
					orders.add([0, 1, 2].sort((a, b) => times[a] - times[b]).join(''))
				}

				expect(orders.size).toBeGreaterThan(1)
			})

			it('waits for the web font before placing any label, but not for ever', async () => {
				const wave = await runWave(html, { fonts: 'pending' })
				wave.advance(2999)
				expect(wave.events).toEqual([])

				wave.advance(1 + 9000)
				const times = firstShown(wave)
				expect(times.every((time) => time !== undefined && time >= 3000 + 700)).toBe(true)
			})

			it('still starts the slots when the web font fails to load', async () => {
				const wave = await runWave(html, { fonts: 'failed' })
				wave.advance(9000)

				expect(firstShown(wave).every((time) => time !== undefined)).toBe(true)
			})
		})

		describe('each slot on its own clock', () => {
			for (const width of [1300, 375]) {
				const slotCount = width >= 700 ? 3 : 2

				it(`keeps every line unique, inside the band and clear of the other labels at ${width}px`, async () => {
					for (const seed of seeds) {
						const wave = await runWave(html, { seed, width })
						wave.advance(180_000)
						const shows = wave.events.filter((event) => event.type === 'in')
						expect(shows.length).toBeGreaterThan(20)

						for (const { slot, slots, time } of shows) {
							const where = `seed ${seed}, slot ${slot} at ${time} ms`
							const label = slots[slot]
							const left = parseFloat(label.left)
							const top = parseFloat(label.top)
							expect(label.bottom, where).toBe('')
							expect(left, where).toBeGreaterThanOrEqual(16)
							expect(left + label.width, where).toBeLessThanOrEqual(wave.heroWidth - 16)
							expect(top, where).toBeGreaterThanOrEqual(wave.heroHeight - 200)
							expect(top + label.height, where).toBeLessThanOrEqual(wave.heroHeight - 36)

							const texts = slots.map((state) => state.text).filter((text) => text !== '')
							expect(new Set(texts).size, where).toBe(texts.length)
							for (const [index, other] of slots.entries()) {
								if (index === slot || other.text === '') continue
								const otherLeft = parseFloat(other.left)
								const otherTop = parseFloat(other.top)
								const apartAcross = Math.max(otherLeft - (left + label.width), left - (otherLeft + other.width))
								const apartDown = Math.max(otherTop - (top + label.height), top - (otherTop + other.height))
								expect(Math.max(apartAcross, apartDown), where).toBeGreaterThanOrEqual(16)
							}
						}
					}
				})

				it(`keeps exactly one timer per slot running at ${width}px`, async () => {
					const wave = await runWave(html, { seed: 7, width })
					for (let step = 0; step < 1200; step++) {
						wave.advance(100)
						expect(wave.pendingTimers(), `at ${wave.now()} ms`).toBe(slotCount)
					}
				})
			}

			it('leaves the third slot empty on a narrow screen', async () => {
				const wave = await runWave(html, { seed: 3, width: 375 })
				wave.advance(120_000)

				expect(wave.events.some((event) => event.slot === 2)).toBe(false)
				expect(wave.insights()[2]).toMatchObject({ text: '', visible: false })
			})

			it('holds each label 2.5–8 s, fades it over its own 1.0–1.9 s, then rests 0.8–5 s or, sometimes, 6–11 s', async () => {
				const rests: number[] = []
				for (const seed of seeds) {
					const wave = await runWave(html, { seed })
					wave.advance(180_000)

					for (const slot of [0, 1, 2]) {
						const events = wave.events.filter((event) => event.slot === slot)
						for (const [index, event] of events.entries()) {
							if (event.type !== 'out') continue
							const where = `seed ${seed}, slot ${slot} at ${event.time} ms`
							const shown = events.slice(0, index).findLast((earlier) => earlier.type === 'in')
							expect(event.time - (shown?.time ?? -Infinity), where).toBeGreaterThanOrEqual(2500)
							expect(event.time - (shown?.time ?? Infinity), where).toBeLessThanOrEqual(8000)

							const fade = parseFloat(event.slots[slot].fade)
							expect(event.slots[slot].fade, where).toMatch(/^\d+ms$/)
							expect(fade, where).toBeGreaterThanOrEqual(1000)
							expect(fade, where).toBeLessThanOrEqual(1900)
							expect(shown?.slots[slot].fade, where).toBe(event.slots[slot].fade)

							// The slot lets go of its line exactly one fade later, then rests before trying a new one
							if (event.time + fade > wave.now()) continue
							const cleared = events[index + 1]
							expect(cleared, where).toMatchObject({ type: 'text', time: event.time + fade })
							expect(cleared.slots[slot].text, where).toBe('')
							const next = events.slice(index + 2).find((later) => later.type === 'text' && later.slots[slot].text !== '')
							if (next) rests.push(next.time - cleared.time)
						}
					}
				}

				for (const rest of rests) {
					expect(rest >= 800 && (rest <= 5000 || rest >= 6000) && rest <= 11_000, `rest ${rest}`).toBe(true)
				}
				const longShare = rests.filter((rest) => rest > 5000).length / rests.length
				expect(longShare).toBeGreaterThan(0.15)
				expect(longShare).toBeLessThan(0.35)
			})

			it('starts the third slot when a narrow screen widens, and lets it finish when it narrows again', async () => {
				const wave = await runWave(html, { seed: 5, width: 375 })
				wave.advance(20_000)
				expect(wave.pendingTimers()).toBe(2)

				wave.setViewportWidth(1300)
				expect(wave.pendingTimers()).toBe(3)
				wave.advance(20_000)
				expect(wave.events.some((event) => event.slot === 2 && event.type === 'in')).toBe(true)

				wave.setViewportWidth(375)
				wave.advance(30_000)
				expect(wave.insights()[2]).toMatchObject({ text: '', visible: false })
				expect(wave.pendingTimers()).toBe(2)
			})
		})

		describe('reduced motion', () => {
			const fixedLabels = (count: number) =>
				FIXED_INSIGHTS.map((label, index) =>
					index < count
						? { text: label.text, visible: true, left: label.left, top: '', bottom: label.bottom }
						: { text: '', visible: false, left: '', top: '', bottom: '' },
				)
			const placement = (wave: WaveHarness) =>
				wave.insights().map(({ text, visible, left, top, bottom }) => ({ text, visible, left, top, bottom }))

			it('shows the three fixed labels and schedules nothing when it is on from the start', async () => {
				const wave = await runWave(html, { reducedMotion: true })

				expect(placement(wave)).toEqual(fixedLabels(3))
				expect(wave.pendingFrames()).toBe(0)
				expect(wave.pendingTimers()).toBe(0)
				wave.advance(30_000)
				expect(placement(wave)).toEqual(fixedLabels(3))
			})

			it('shows two fixed labels on a narrow screen', async () => {
				const wave = await runWave(html, { reducedMotion: true, width: 375 })

				expect(placement(wave)).toEqual(fixedLabels(2))
			})

			it('switches to the fixed labels when it turns on, and back to a fresh cycle when it turns off', async () => {
				const wave = await runWave(html, { seed: 11 })
				wave.advance(20_000)

				wave.setReducedMotion(true)
				expect(placement(wave)).toEqual(fixedLabels(3))
				expect(wave.pendingFrames()).toBe(0)
				expect(wave.pendingTimers()).toBe(0)
				wave.advance(30_000)
				expect(placement(wave)).toEqual(fixedLabels(3))

				wave.setReducedMotion(false)
				expect(wave.insights().map(({ text, visible }) => ({ text, visible }))).toEqual(Array(3).fill({ text: '', visible: false }))
				expect(wave.pendingFrames()).toBe(1)
				expect(wave.pendingTimers()).toBe(3)
				const resumedAt = wave.now()
				wave.advance(9000)
				const shown = [0, 1, 2].map(
					(slot) => wave.events.find((event) => event.slot === slot && event.type === 'in' && event.time > resumedAt)?.time,
				)
				expect(shown.every((time) => time !== undefined && time >= resumedAt + 700)).toBe(true)
			})
		})

		const pauses = [
			{ reason: 'the tab is hidden', pause: (w: WaveHarness) => w.setTabHidden(true), resume: (w: WaveHarness) => w.setTabHidden(false) },
			{
				reason: 'the hero leaves the screen',
				pause: (w: WaveHarness) => w.setHeroOnScreen(false),
				resume: (w: WaveHarness) => w.setHeroOnScreen(true),
			},
		]

		for (const { reason, pause, resume } of pauses) {
			describe(`when ${reason}`, () => {
				it('freezes a label that was fading out, fully visible and without a transition, and changes nothing after', async () => {
					const wave = await runWave(html, { seed: 2 })
					wave.advance(10_000)
					const slot = untilFadingOut(wave)

					pause(wave)

					expect(wave.pendingFrames()).toBe(0)
					expect(wave.pendingTimers()).toBe(0)
					expect(wave.insights()[slot]).toMatchObject({ visible: true, transition: 'none' })
					const frozen = wave.insights()
					wave.advance(60_000)
					expect(wave.insights()).toEqual(frozen)
				})

				it('freezes a label that was fading in, fully visible and without a transition', async () => {
					const wave = await runWave(html, { seed: 4 })
					wave.advance(9000)
					const latest = wave.events.filter((event) => event.type === 'in').at(-1)!
					wave.advance(latest.time + 200 - wave.now())

					pause(wave)

					expect(wave.insights()[latest.slot]).toMatchObject({ text: latest.slots[latest.slot].text, visible: true, transition: 'none' })
					const frozen = wave.insights()
					wave.advance(60_000)
					expect(wave.insights()).toEqual(frozen)
				})

				it('resumes with one frame loop and one timer chain per slot, and no stale callbacks', async () => {
					const wave = await runWave(html, { seed: 9 })
					wave.advance(20_000)
					untilFadingOut(wave)
					pause(wave)
					// Less than any fade, so a stale fade-out callback would fire straight after resuming
					wave.advance(500)

					resume(wave)
					pause(wave)
					resume(wave)
					resume(wave)

					expect(wave.pendingFrames()).toBe(1)
					expect(wave.pendingTimers()).toBe(3)
					const before = wave.insights()
					// Visible labels hold for a fresh 2.5–8 s before fading
					wave.advance(2499)
					for (const [slot, state] of before.entries()) {
						if (state.visible) expect(wave.insights()[slot]).toMatchObject({ text: state.text, visible: true })
					}
					for (let step = 0; step < 1200; step++) {
						wave.advance(100)
						expect(wave.pendingTimers(), `at ${wave.now()} ms`).toBe(3)
						const texts = wave
							.insights()
							.map((state) => state.text)
							.filter((text) => text !== '')
						expect(new Set(texts).size).toBe(texts.length)
					}
				})
			})
		}
	})
})
