// ABOUTME: Scans a range of the user's scrobbles for one artist, a bounded block of Last.fm pages per call.
// ABOUTME: Used by get_recent_tracks when `artist` is set; reports what it scanned so a partial scan reads as partial.
import type { CachedLastfmClient } from '../../clients/cachedLastfm'
import type { LastfmTrack } from '../../clients/lastfm'
import { isSameArtist } from './artistMatch'
import { toArray } from './formatters'

/** Scrobbles per Last.fm page (user.getRecentTracks' maximum). */
export const SCAN_PAGE_SIZE = 1000
/** Last.fm pages one call scans, so a call reads at most 5,000 scrobbles. */
export const SCAN_PAGES_PER_CALL = 5

export interface ArtistScanResult {
	/** Matching scrobbles, newest first, now-playing rows removed. */
	matches: LastfmTrack[]
	/** 1-based index of the first scrobble this call scanned (0 when nothing was scanned). */
	scannedFrom: number
	/** 1-based index of the last scrobble this call scanned (0 when nothing was scanned). */
	scannedTo: number
	/** Dated scrobbles in the range (Last.fm's `@attr.total`). */
	totalInRange: number
	/** True when this call reached the range's last Last.fm page. */
	complete: boolean
	/** The scan block to pass as `page` next, or null when complete. */
	nextPage: number | null
}

/** True for the row Last.fm adds for the track playing now; it can appear even in a past range. */
export function isNowPlaying(track: LastfmTrack): boolean {
	return track['@attr']?.nowplaying === 'true'
}

/**
 * Scans scan block `page` of the range: Last.fm pages `(page - 1) * 5 + 1` to `page * 5`, fetched in order and
 * stopping at the range's last page. A failed fetch rejects the whole scan, so partial matches never pass as complete.
 */
export async function scanArtistScrobbles(
	client: CachedLastfmClient,
	username: string,
	artist: string,
	opts: { from?: number; to?: number; page: number },
): Promise<ArtistScanResult> {
	const firstPage = (opts.page - 1) * SCAN_PAGES_PER_CALL + 1
	const lastPage = opts.page * SCAN_PAGES_PER_CALL

	const matches: LastfmTrack[] = []
	let datedRowsScanned = 0
	let totalInRange = 0
	let complete = false

	for (let lastfmPage = firstPage; lastfmPage <= lastPage; lastfmPage++) {
		const data = await client.getRecentTracks(username, SCAN_PAGE_SIZE, opts.from, opts.to, lastfmPage)
		const attr = data.recenttracks['@attr']
		totalInRange = parseInt(attr.total, 10)

		for (const track of toArray(data.recenttracks.track)) {
			if (isNowPlaying(track)) continue
			datedRowsScanned++
			if (isSameArtist(track.artist['#text'], artist)) matches.push(track)
		}

		if (lastfmPage >= parseInt(attr.totalPages, 10)) {
			complete = true
			break
		}
	}

	const scannedFrom = datedRowsScanned > 0 ? (firstPage - 1) * SCAN_PAGE_SIZE + 1 : 0
	const scannedTo = datedRowsScanned > 0 ? scannedFrom + datedRowsScanned - 1 : 0

	return { matches, scannedFrom, scannedTo, totalInRange, complete, nextPage: complete ? null : opts.page + 1 }
}

const SCROBBLES_PER_CALL = SCAN_PAGE_SIZE * SCAN_PAGES_PER_CALL

const count = (n: number) => n.toLocaleString('en-US')

/**
 * The header lines for an artist scan: what was scanned, whether that covers the range, and what was found.
 * Only a complete scan from block 1 may say the artist has no scrobbles in the range.
 */
export function describeArtistScan(artist: string, scan: ArtistScanResult, page: number): string {
	const total = count(scan.totalInRange)

	if (scan.scannedFrom === 0) {
		if (page === 1) return `🔎 No scrobbles by ${artist} in this range (it has no scrobbles).`
		const lastBlock = Math.ceil(scan.totalInRange / SCROBBLES_PER_CALL)
		const hint = lastBlock > 0 ? `, so the last scan block is \`page: ${lastBlock}\`` : ''
		return `🔎 Nothing left to scan in this range: it has ${total} scrobbles${hint}.`
	}

	const scanned = scan.scannedFrom === 1 ? count(scan.scannedTo) : `${count(scan.scannedFrom)}–${count(scan.scannedTo)}`
	let scanLine = `🔎 Scanned ${scanned} of ${total} scrobbles in range`
	if (scan.complete) {
		scanLine += ' (complete).'
	} else {
		const remaining = scan.totalInRange - scan.scannedTo
		const nextCount = remaining > 0 ? Math.min(remaining, SCROBBLES_PER_CALL) : SCROBBLES_PER_CALL
		scanLine += ` (incomplete): use \`page: ${scan.nextPage}\` to scan the next ${count(nextCount)}, or narrow from/to.`
	}

	const coversWholeRange = scan.complete && page === 1
	const n = scan.matches.length
	let resultLine: string
	if (n > 0) {
		resultLine = `Found ${count(n)} ${n === 1 ? 'scrobble' : 'scrobbles'} by ${artist}${coversWholeRange ? ' in this range' : ' in the scrobbles scanned'}:`
	} else if (coversWholeRange) {
		resultLine = `No scrobbles by ${artist} in this range.`
	} else {
		resultLine = `No matches for ${artist} in the scrobbles scanned${scan.complete ? '' : ' so far'}.`
	}

	return `${scanLine}\n${resultLine}`
}
