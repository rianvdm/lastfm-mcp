// ABOUTME: Tests the dashboard's Pacific-time helpers: the Pacific date of an instant, date arithmetic and time formatting.
// ABOUTME: Pins the instants around Pacific and UTC midnight and both 2026 DST changes, where a UTC-based day would go wrong.
import { describe, expect, it } from 'vitest'

import { addDays, formatPacificTime, lastPacificDates, pacificDate } from '../src/pacific'

describe('pacificDate', () => {
	it('should give the Pacific date when UTC has already moved to the next day', () => {
		expect(pacificDate(Date.parse('2026-11-13T01:00:00Z'))).toBe('2026-11-12')
	})

	it('should start the Pacific day at 08:00 UTC in winter', () => {
		expect(pacificDate(Date.parse('2026-11-12T08:00:00Z'))).toBe('2026-11-12')
		expect(pacificDate(Date.parse('2026-11-12T07:59:59Z'))).toBe('2026-11-11')
	})

	it('should start the Pacific day at 07:00 UTC in summer', () => {
		expect(pacificDate(Date.parse('2026-07-01T06:59:00Z'))).toBe('2026-06-30')
		expect(pacificDate(Date.parse('2026-07-01T07:00:00Z'))).toBe('2026-07-01')
	})
})

describe('addDays', () => {
	it('should step whole calendar days across a month and a DST change', () => {
		expect(addDays('2026-03-01', 30)).toBe('2026-03-31')
		expect(addDays('2026-11-02', -2)).toBe('2026-10-31')
	})
})

describe('lastPacificDates', () => {
	it('should return 30 consecutive Pacific dates ending today, across the November DST change', () => {
		const dates = lastPacificDates(new Date('2026-11-13T01:00:00Z'), 30)

		expect(dates).toHaveLength(30)
		expect(new Set(dates).size).toBe(30)
		expect(dates[0]).toBe('2026-10-14')
		expect(dates[29]).toBe('2026-11-12')
		expect(dates).toContain('2026-11-01')
		dates.slice(1).forEach((date, i) => expect(date).toBe(addDays(dates[i], 1)))
	})

	it('should cover the March DST change without skipping or repeating a date', () => {
		const dates = lastPacificDates(new Date('2026-03-10T20:00:00Z'), 5)

		expect(dates).toEqual(['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'])
	})
})

describe('formatPacificTime', () => {
	it('should show winter times in PST on a 24-hour clock', () => {
		expect(formatPacificTime(Date.parse('2026-11-12T15:30:00Z'))).toBe('2026-11-12 07:30 PST')
		expect(formatPacificTime(Date.parse('2026-11-13T08:05:00Z'))).toBe('2026-11-13 00:05 PST')
	})

	it('should show summer times in PDT', () => {
		expect(formatPacificTime(Date.parse('2026-07-01T19:05:00Z'))).toBe('2026-07-01 12:05 PDT')
	})
})
