// ABOUTME: Runs the landing page's hero-wave script against a tiny fake DOM and a manual clock.
// ABOUTME: Lets tests pause and resume the wave (reduced motion, hidden tab, hero off screen) and inspect timers and labels.

const WAVE_SCRIPT_START = '// The hero wave:'

interface Timer {
	id: number
	due: number
	every: number | null
	callback: () => void
}

interface FakeLabel {
	textContent: string
	fading: boolean
	classList: { add: (name: string) => void; remove: (name: string) => void }
}

export interface WaveHarness {
	early: FakeLabel
	late: FakeLabel
	/** Moves the clock forward, firing timeouts and intervals in order. */
	advance: (ms: number) => void
	/** Timeouts and intervals still scheduled. */
	pendingTimers: () => number
	/** Animation frames requested and not yet cancelled. */
	pendingFrames: () => number
	setReducedMotion: (reduce: boolean) => void
	setTabHidden: (hidden: boolean) => void
	setHeroOnScreen: (onScreen: boolean) => void
}

/** Pulls the wave IIFE out of the built page: from its opening comment to the end of the inline script. */
export function extractWaveScript(html: string): string {
	const start = html.indexOf(WAVE_SCRIPT_START)
	const end = html.indexOf('</script>', start)
	if (start === -1 || end === -1) throw new Error('Wave script not found in the landing page')
	return html.slice(start, end)
}

export function runWave(html: string, options: { reducedMotion?: boolean } = {}): WaveHarness {
	let now = 0
	let nextId = 1
	const timers = new Map<number, Timer>()
	const frames = new Set<number>()
	const listeners = new Map<string, () => void>()
	let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {}

	const schedule = (callback: () => void, ms: number, repeat: boolean) => {
		const id = nextId++
		timers.set(id, { id, due: now + ms, every: repeat ? ms : null, callback })
		return id
	}
	const clear = (id: number) => void timers.delete(id)

	const label = (text: string): FakeLabel => {
		const fake: FakeLabel = {
			textContent: text,
			fading: false,
			classList: {
				add: (name) => name === 'is-fading' && (fake.fading = true),
				remove: (name) => name === 'is-fading' && (fake.fading = false),
			},
		}
		return fake
	}
	const early = label('2009 · post-rock phase')
	const late = label('2024 · jazz, apparently')

	const hero = { querySelector: (selector: string) => (selector === '.wave-label-early' ? early : late) }
	// Every 2D context method is a no-op; drawing is checked in the browser, not here
	const context = new Proxy({}, { get: () => () => {}, set: () => true })
	const canvas = { clientWidth: 1300, clientHeight: 535, width: 0, height: 0, getContext: () => context, closest: () => hero }
	const reducedMotion = {
		matches: options.reducedMotion ?? false,
		addEventListener: (_type: string, listener: () => void) => listeners.set('reduced-motion', listener),
	}
	const document = {
		hidden: false,
		getElementById: () => canvas,
		addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
	}
	class IntersectionObserver {
		constructor(callback: typeof intersect) {
			intersect = callback
		}
		observe() {}
	}
	const window = { devicePixelRatio: 2, matchMedia: () => reducedMotion, IntersectionObserver }

	const fakes = {
		window,
		document,
		IntersectionObserver,
		requestAnimationFrame: () => {
			const id = nextId++
			frames.add(id)
			return id
		},
		cancelAnimationFrame: (id: number) => frames.delete(id),
		setTimeout: (callback: () => void, ms: number) => schedule(callback, ms, false),
		setInterval: (callback: () => void, ms: number) => schedule(callback, ms, true),
		clearTimeout: clear,
		clearInterval: clear,
	}
	new Function(...Object.keys(fakes), extractWaveScript(html))(...Object.values(fakes))

	return {
		early,
		late,
		advance: (ms) => {
			const until = now + ms
			for (;;) {
				const next = [...timers.values()].filter((t) => t.due <= until).sort((a, b) => a.due - b.due || a.id - b.id)[0]
				if (!next) break
				now = next.due
				if (next.every === null) timers.delete(next.id)
				else next.due += next.every
				next.callback()
			}
			now = until
		},
		pendingTimers: () => timers.size,
		pendingFrames: () => frames.size,
		setReducedMotion: (reduce) => {
			reducedMotion.matches = reduce
			listeners.get('reduced-motion')?.()
		},
		setTabHidden: (hidden) => {
			document.hidden = hidden
			listeners.get('visibilitychange')?.()
		},
		setHeroOnScreen: (onScreen) => intersect([{ isIntersecting: onScreen }]),
	}
}
