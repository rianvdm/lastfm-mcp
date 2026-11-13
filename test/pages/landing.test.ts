// ABOUTME: Tests for the landing page builder in src/pages/landing.ts.
// ABOUTME: Checks the copy, origin-filled setup snippets, head links, and that setup panels stay readable without JavaScript.
import { describe, it, expect } from 'vitest'

import { buildLandingPage } from '../../src/pages/landing'
import { runWave, type WaveHarness } from './wave-harness'

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
