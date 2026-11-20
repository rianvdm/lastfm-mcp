// ABOUTME: Writes the README's wave banner (.github/assets/wave.svg) by running the share images' drawWave() against a canvas that records paths.
// ABOUTME: Run by hand (npm run render:readme) after changing src/pages/share/wave.js, and commit the SVG with the change. Needs only Node.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WAVE_JS = join(ROOT, 'src', 'pages', 'share', 'wave.js')
const OUTPUT = join(ROOT, '.github', 'assets', 'wave.svg')

// The share card's wave settings, on a strip just tall enough for five layers at their thickest (5 × 34px)
const WIDTH = 1200
const HEIGHT = 180
const WAVE_OPTIONS = { centre: HEIGHT / 2, maxLayerThickness: 34, columnWidth: 6 }
const LABEL = 'A wave of five coloured bands that swell and narrow, like a stacked chart of listening over time'

/** One decimal place is finer than any screen shows at README width and keeps the file small. */
const coordinate = (n) => String(Math.round(n * 10) / 10)

/**
 * A stand-in for a 2D canvas that implements only the calls drawWave() makes, and records each filled path with the
 * colour and opacity it was filled with.
 */
function recordingCanvas(width, height) {
	const paths = []
	let d = ''
	const context = {
		globalAlpha: 1,
		fillStyle: '#000000',
		beginPath: () => (d = ''),
		moveTo: (x, y) => (d += `M${coordinate(x)} ${coordinate(y)}`),
		lineTo: (x, y) => (d += `L${coordinate(x)} ${coordinate(y)}`),
		closePath: () => (d += 'Z'),
		fill: () => paths.push({ d, fill: context.fillStyle, opacity: context.globalAlpha }),
	}
	return { canvas: { width, height, getContext: () => context }, paths }
}

// wave.js is a classic browser script that declares drawWave() as a global, so it runs in its own context here
const sandbox = vm.createContext({})
vm.runInContext(readFileSync(WAVE_JS, 'utf8'), sandbox, { filename: WAVE_JS })
const drawWave = vm.runInContext('drawWave', sandbox)

const { canvas, paths } = recordingCanvas(WIDTH, HEIGHT)
drawWave(canvas, WAVE_OPTIONS)
if (paths.length === 0) {
	console.error('drawWave() filled no paths; wave.svg not updated')
	process.exit(1)
}

// No background, so the bands sit on GitHub's light and dark themes alike; columns past the right edge are clipped by the viewBox
const svg = [
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="${LABEL}">`,
	`\t<title>${LABEL}</title>`,
	...paths.map(({ d, fill, opacity }) => `\t<path fill="${fill}" fill-opacity="${opacity}" d="${d}"/>`),
	'</svg>',
	'',
].join('\n')

mkdirSync(dirname(OUTPUT), { recursive: true })
writeFileSync(OUTPUT, svg)
console.log(`wave.svg: ${WIDTH}×${HEIGHT}, ${paths.length} layers, ${Buffer.byteLength(svg)} bytes`)
