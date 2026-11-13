// ABOUTME: Runs the landing page's hero-wave script against a tiny fake DOM, a manual clock and a seeded Math.random.
// ABOUTME: Lets tests pause, resume and resize the wave and its insight labels, and inspect timers, label state and a change log.

const WAVE_SCRIPT_START = '// The hero wave:'

interface Timer {
	id: number
	due: number
	callback: () => void
}

/** What one insight slot looks like at a moment: its text, whether it's faded in, and its inline styles. */
export interface InsightState {
	text: string
	visible: boolean
	left: string
	top: string
	bottom: string
	transition: string
	fade: string
	/** The label's rendered size in px, as the harness measures it. */
	width: number
	height: number
}

/** One change to a slot: faded in, started fading out, or had its text set. `slots` is every slot's state just after it. */
export interface InsightEvent {
	time: number
	slot: number
	type: 'in' | 'out' | 'text'
	slots: InsightState[]
}

export interface WaveHarness {
	heroWidth: number
	heroHeight: number
	/** Every slot's current state, in slot order. */
	insights: () => InsightState[]
	/** Every change to a slot so far, in order. */
	events: InsightEvent[]
	now: () => number
	/** Moves the clock forward, firing timeouts in order. Throws on a negative step: the clock never runs backwards. */
	advance: (ms: number) => void
	/** Timeouts still scheduled. */
	pendingTimers: () => number
	/** Animation frames requested and not yet cancelled. */
	pendingFrames: () => number
	setReducedMotion: (reduce: boolean) => void
	setTabHidden: (hidden: boolean) => void
	setHeroOnScreen: (onScreen: boolean) => void
	/** Changes the viewport and hero width (the hero's height follows), then delivers the ResizeObserver callbacks. */
	setViewportWidth: (width: number) => void
}

export interface WaveOptions {
	reducedMotion?: boolean
	/** Viewport and hero width in px. 1300 by default. */
	width?: number
	/** Seed for Math.random, so a run is repeatable. */
	seed?: number
	/** Whether document.fonts.ready resolves at once, rejects, or never settles. */
	fonts?: 'loaded' | 'failed' | 'pending'
}

/** Pulls the wave IIFE out of the built page: from its opening comment to the end of the inline script. */
export function extractWaveScript(html: string): string {
	const start = html.indexOf(WAVE_SCRIPT_START)
	const end = html.indexOf('</script>', start)
	if (start === -1 || end === -1) throw new Error('Wave script not found in the landing page')
	return html.slice(start, end)
}

/** mulberry32: a small seeded generator, good enough for repeatable test runs. */
function seededRandom(seed: number): () => number {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const WIDE_QUERY = '(min-width: 700px)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export async function runWave(html: string, options: WaveOptions = {}): Promise<WaveHarness> {
	let now = 0
	let nextId = 1
	let width = options.width ?? 1300
	const heroHeight = () => (width >= 700 ? 535 : 600)
	const timers = new Map<number, Timer>()
	const frames = new Set<number>()
	const listeners = new Map<string, () => void>()
	const events: InsightEvent[] = []
	let intersect: (entries: { isIntersecting: boolean }[]) => void = () => {}
	const resizeCallbacks: (() => void)[] = []

	const setTimeout = (callback: () => void, ms: number) => {
		const id = nextId++
		timers.set(id, { id, due: now + ms, callback })
		return id
	}
	const clearTimeout = (id: number) => void timers.delete(id)

	// A slot's size follows its text and the screen width, like the real 20px (16px narrow) label with its padding
	const makeInsight = (index: number) => {
		let text = ''
		const classes = new Set<string>()
		const custom = new Map<string, string>()
		const style = {
			left: '',
			top: '',
			bottom: '',
			transition: '',
			setProperty: (name: string, value: string) => void custom.set(name, value),
			getPropertyValue: (name: string) => custom.get(name) ?? '',
		}
		const log = (type: InsightEvent['type']) => events.push({ time: now, slot: index, type, slots: insights() })
		const fake = {
			style,
			get textContent() {
				return text
			},
			set textContent(value: string) {
				text = value
				log('text')
			},
			get offsetWidth() {
				return width >= 700 ? text.length * 10 + 24 : text.length * 8 + 20
			},
			get offsetHeight() {
				return width >= 700 ? 38 : 30
			},
			classList: {
				add: (name: string) => {
					if (classes.has(name)) return
					classes.add(name)
					if (name === 'is-in') log('in')
				},
				remove: (name: string) => {
					if (!classes.delete(name)) return
					if (name === 'is-in') log('out')
				},
				contains: (name: string) => classes.has(name),
			},
			state: (): InsightState => ({
				text,
				visible: classes.has('is-in'),
				left: style.left,
				top: style.top,
				bottom: style.bottom,
				transition: style.transition,
				fade: custom.get('--fade') ?? '',
				width: fake.offsetWidth,
				height: fake.offsetHeight,
			}),
		}
		return fake
	}
	const slots = [0, 1, 2].map(makeInsight)
	const insights = () => slots.map((slot) => slot.state())

	const hero = {
		get clientWidth() {
			return width
		},
		get clientHeight() {
			return heroHeight()
		},
		querySelectorAll: (selector: string) => (selector === '.wave-insight' ? slots : []),
	}
	// Every 2D context method is a no-op; drawing is checked in the browser, not here
	const context = new Proxy({}, { get: () => () => {}, set: () => true })
	const canvas = {
		get clientWidth() {
			return width
		},
		get clientHeight() {
			return heroHeight()
		},
		width: 0,
		height: 0,
		getContext: () => context,
		closest: () => hero,
	}
	const mediaQuery = (query: string, matches: () => boolean) => ({
		get matches() {
			return matches()
		},
		addEventListener: (_type: string, listener: () => void) => listeners.set(query, listener),
	})
	let reduce = options.reducedMotion ?? false
	const queries: Record<string, ReturnType<typeof mediaQuery>> = {
		[REDUCED_MOTION_QUERY]: mediaQuery(REDUCED_MOTION_QUERY, () => reduce),
		[WIDE_QUERY]: mediaQuery(WIDE_QUERY, () => width >= 700),
	}
	const matchMedia = (query: string) => {
		if (!queries[query]) throw new Error(`The harness doesn't fake the media query ${query}`)
		return queries[query]
	}

	const fontsReady = {
		loaded: () => Promise.resolve(),
		failed: () => Promise.reject(new Error('font failed to load')),
		pending: () => new Promise<void>(() => {}),
	}[options.fonts ?? 'loaded']()
	const document = {
		hidden: false,
		fonts: { ready: fontsReady },
		getElementById: () => canvas,
		addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
	}
	class IntersectionObserver {
		constructor(callback: typeof intersect) {
			intersect = callback
		}
		observe() {}
	}
	class ResizeObserver {
		constructor(callback: () => void) {
			resizeCallbacks.push(callback)
		}
		observe() {}
	}
	const window = { devicePixelRatio: 2, matchMedia, IntersectionObserver, ResizeObserver }
	const random = seededRandom(options.seed ?? 1)
	const fakeMath = Object.create(Math, { random: { value: random } })

	const fakes = {
		window,
		document,
		IntersectionObserver,
		ResizeObserver,
		Math: fakeMath,
		requestAnimationFrame: () => {
			const id = nextId++
			frames.add(id)
			return id
		},
		cancelAnimationFrame: (id: number) => frames.delete(id),
		setTimeout,
		clearTimeout,
	}
	new Function(...Object.keys(fakes), extractWaveScript(html))(...Object.values(fakes))
	// Let document.fonts.ready settle before the test drives the clock
	await new Promise((resolve) => globalThis.setTimeout(resolve, 0))

	return {
		get heroWidth() {
			return width
		},
		get heroHeight() {
			return heroHeight()
		},
		insights,
		events,
		now: () => now,
		advance: (ms) => {
			if (ms < 0) throw new Error(`advance(${ms}): the clock can't run backwards`)
			const until = now + ms
			for (;;) {
				const next = [...timers.values()].filter((t) => t.due <= until).sort((a, b) => a.due - b.due || a.id - b.id)[0]
				if (!next) break
				now = next.due
				timers.delete(next.id)
				next.callback()
			}
			now = until
		},
		pendingTimers: () => timers.size,
		pendingFrames: () => frames.size,
		setReducedMotion: (value) => {
			reduce = value
			listeners.get(REDUCED_MOTION_QUERY)?.()
		},
		setTabHidden: (hidden) => {
			document.hidden = hidden
			listeners.get('visibilitychange')?.()
		},
		setHeroOnScreen: (onScreen) => intersect([{ isIntersecting: onScreen }]),
		setViewportWidth: (value) => {
			width = value
			resizeCallbacks.forEach((callback) => callback())
		},
	}
}
