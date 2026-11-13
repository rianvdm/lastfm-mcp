// ABOUTME: Pacific-time helpers for the dashboard: the America/Los_Angeles date of an instant, date arithmetic and time labels.
// ABOUTME: Every daily bucket and every timestamp on the page goes through here, so days run midnight to midnight Pacific.

/** The dashboard's one time zone: its reader works in Pacific time */
export const TIME_ZONE = 'America/Los_Angeles'

const DAY_MS = 86_400_000

const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })

const timeFormat = new Intl.DateTimeFormat('en-US', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
	timeZoneName: 'short',
})

/** The named parts of an instant formatted by `format` */
function parts(format: Intl.DateTimeFormat, ms: number): Record<string, string> {
	return Object.fromEntries(format.formatToParts(ms).map((part) => [part.type, part.value]))
}

/** The Pacific calendar date (`YYYY-MM-DD`) of an instant in epoch milliseconds */
export function pacificDate(ms: number): string {
	const { year, month, day } = parts(dateFormat, ms)
	return `${year}-${month}-${day}`
}

/**
 * The `YYYY-MM-DD` date `days` calendar days after `date` (before, for a negative count). Pure calendar arithmetic, so a
 * 23- or 25-hour day at a DST change still counts as one day.
 */
export function addDays(date: string, days: number): string {
	return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10)
}

/** The last `count` Pacific dates, oldest first, ending on the Pacific date of `now` */
export function lastPacificDates(now: Date, count: number): string[] {
	const today = pacificDate(now.getTime())
	return Array.from({ length: count }, (_, i) => addDays(today, i - (count - 1)))
}

/** `2026-11-12 07:30 PST` (PDT in summer) for an instant in epoch milliseconds */
export function formatPacificTime(ms: number): string {
	const { year, month, day, hour, minute, timeZoneName } = parts(timeFormat, ms)
	return `${year}-${month}-${day} ${hour}:${minute} ${timeZoneName}`
}
