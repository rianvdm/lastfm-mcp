// ABOUTME: Renders the share card (og.png, 1200×630) and apple-touch-icon.png (180×180) from their HTML sources with headless Chrome.
// ABOUTME: Run by hand (npm run render:share) after changing src/pages/share/*.html; commit the PNGs with the change. Needs macOS (sips).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const SHARE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'pages', 'share')

// Headless Chrome clamps --window-size below 500px, so the icon is drawn at three times its size and downscaled
const IMAGES = [
	{ source: 'og-card.html', output: 'og.png', renderSize: [1200, 630], size: [1200, 630] },
	{ source: 'icon.html', output: 'apple-touch-icon.png', renderSize: [540, 540], size: [180, 180] },
]

// Long enough for the Google Fonts stylesheet and font file to arrive before the capture
const VIRTUAL_TIME_BUDGET_MS = 15000

/**
 * Screenshots `htmlPath` at exactly `width`×`height` CSS pixels, one device pixel each, into `pngPath`, and returns the
 * page's `data-ready` state ('ok', 'failed', or null if it never got that far). Chrome dumps the DOM from the same load
 * it captures, so the state describes the pixels in the screenshot.
 */
function screenshot(htmlPath, pngPath, [width, height]) {
	const dom = execFileSync(
		CHROME,
		[
			'--headless=new',
			'--disable-gpu',
			'--hide-scrollbars',
			'--force-device-scale-factor=1',
			`--window-size=${width},${height}`,
			`--virtual-time-budget=${VIRTUAL_TIME_BUDGET_MS}`,
			'--dump-dom',
			`--screenshot=${pngPath}`,
			pathToFileURL(htmlPath).href,
		],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
	)
	return dom.match(/<html\b[^>]*\sdata-ready="([^"]*)"/)?.[1] ?? null
}

/** Width and height from a PNG's IHDR chunk (bytes 16-23, big-endian). */
function pngSize(pngPath) {
	const bytes = readFileSync(pngPath)
	return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

/** Renders and checks one image inside `workDir`, returning the finished file's path. Throws on any failure. */
function render({ source, output, renderSize, size }, workDir) {
	const captured = join(workDir, `captured-${output}`)
	const state = screenshot(join(SHARE_DIR, source), captured, renderSize)
	if (state !== 'ok') {
		throw new Error(`${source} reported data-ready=${state ?? '(unset)'}; a font or script didn't load in time`)
	}

	let finished = captured
	if (renderSize[0] !== size[0] || renderSize[1] !== size[1]) {
		finished = join(workDir, output)
		execFileSync('sips', ['-z', String(size[1]), String(size[0]), captured, '--out', finished], { stdio: 'ignore' })
	}

	const [width, height] = pngSize(finished)
	if (width !== size[0] || height !== size[1]) {
		throw new Error(`${output} is ${width}×${height}, expected ${size[0]}×${size[1]}`)
	}
	return finished
}

if (!existsSync(CHROME)) {
	console.error(`Chrome not found at ${CHROME}. Set CHROME_PATH to its binary.`)
	process.exit(1)
}

// Every image is rendered and checked in a temp dir first, so a failure leaves the committed PNGs untouched
const workDir = mkdtempSync(join(tmpdir(), 'share-images-'))
try {
	const finished = IMAGES.map((image) => render(image, workDir))
	IMAGES.forEach(({ output, size }, i) => {
		copyFileSync(finished[i], join(SHARE_DIR, output))
		console.log(`${output}: ${size[0]}×${size[1]}`)
	})
} catch (error) {
	console.error(`Share images not updated: ${error instanceof Error ? error.message : 'Unknown error'}`)
	process.exitCode = 1
} finally {
	rmSync(workDir, { recursive: true, force: true })
}
