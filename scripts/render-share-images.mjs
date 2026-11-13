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

/** Screenshots `htmlPath` at exactly `width`×`height` CSS pixels, one device pixel each, into `pngPath`. */
function screenshot(htmlPath, pngPath, [width, height]) {
	execFileSync(
		CHROME,
		[
			'--headless=new',
			'--disable-gpu',
			'--hide-scrollbars',
			'--force-device-scale-factor=1',
			`--window-size=${width},${height}`,
			`--virtual-time-budget=${VIRTUAL_TIME_BUDGET_MS}`,
			`--screenshot=${pngPath}`,
			pathToFileURL(htmlPath).href,
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] },
	)
}

/** Width and height from a PNG's IHDR chunk (bytes 16-23, big-endian). */
function pngSize(pngPath) {
	const bytes = readFileSync(pngPath)
	return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

if (!existsSync(CHROME)) {
	console.error(`Chrome not found at ${CHROME}. Set CHROME_PATH to its binary.`)
	process.exit(1)
}

const workDir = mkdtempSync(join(tmpdir(), 'share-images-'))
try {
	for (const { source, output, renderSize, size } of IMAGES) {
		const outputPath = join(SHARE_DIR, output)
		const rendered = join(workDir, output)
		screenshot(join(SHARE_DIR, source), rendered, renderSize)

		if (renderSize[0] === size[0] && renderSize[1] === size[1]) {
			copyFileSync(rendered, outputPath)
		} else {
			execFileSync('sips', ['-z', String(size[1]), String(size[0]), rendered, '--out', outputPath], { stdio: 'ignore' })
		}

		const [width, height] = pngSize(outputPath)
		if (width !== size[0] || height !== size[1]) {
			throw new Error(`${output} is ${width}×${height}, expected ${size[0]}×${size[1]}`)
		}
		console.log(`${output}: ${width}×${height}`)
	}
} finally {
	rmSync(workDir, { recursive: true, force: true })
}
