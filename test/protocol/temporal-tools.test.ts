/**
 * Tests for temporal query tools
 * Tests get_weekly_chart_list, get_weekly_artist_chart, and get_weekly_track_chart
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAuthenticatedToolsCall } from '../../src/protocol/handlers'
import { LastfmClient } from '../../src/clients/lastfm'
import { CachedLastfmClient } from '../../src/clients/cachedLastfm'
import type { SessionPayload } from '../../src/auth/jwt'
import type { Env } from '../../src/types/env'

// Mock the clients
vi.mock('../../src/clients/lastfm')
vi.mock('../../src/clients/cachedLastfm')

describe('Temporal Query Tools', () => {
	let mockLastfmClient: LastfmClient
	let mockCachedClient: CachedLastfmClient
	let mockSession: SessionPayload
	let mockEnv: Env

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Mock the clients
		mockLastfmClient = {
			getWeeklyChartList: vi.fn(),
			getWeeklyArtistChart: vi.fn(),
			getWeeklyTrackChart: vi.fn(),
		} as unknown as LastfmClient

		mockCachedClient = {
			getWeeklyChartList: vi.fn(),
			getWeeklyArtistChart: vi.fn(),
			getWeeklyTrackChart: vi.fn(),
		} as unknown as CachedLastfmClient

		// Mock environment
		mockEnv = {
			LASTFM_API_KEY: 'test-api-key',
			LASTFM_SHARED_SECRET: 'test-secret',
			JWT_SECRET: 'test-jwt-secret',
		} as Env

		// Mock session
		mockSession = {
			userId: 'testuser',
			sessionKey: 'test-session-key',
			username: 'testuser',
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 3600,
		}

		// Mock constructor
		vi.mocked(LastfmClient).mockImplementation(() => mockLastfmClient)
		vi.mocked(CachedLastfmClient).mockImplementation(() => mockCachedClient)
	})

	describe('get_weekly_chart_list', () => {
		it('should get weekly chart list for authenticated user', async () => {
			// Mock the API response
			const mockChartList = {
				weeklychartlist: {
					chart: [
						{ from: '1609459200', to: '1610064000' }, // Jan 1-7, 2021
						{ from: '1610064000', to: '1610668800' }, // Jan 8-14, 2021
						{ from: '1610668800', to: '1611273600' }, // Jan 15-21, 2021
					],
				},
			}

			mockCachedClient.getWeeklyChartList = vi.fn().mockResolvedValue(mockChartList)

			const result = await handleAuthenticatedToolsCall(
				{
					name: 'get_weekly_chart_list',
					arguments: { username: 'testuser' },
				},
				mockSession,
				mockEnv,
			)

			expect(mockCachedClient.getWeeklyChartList).toHaveBeenCalledWith('testuser')
			expect(result.content[0].text).toContain('Weekly Chart Periods for testuser')
			expect(result.content[0].text).toContain('Available Date Ranges')
			expect(result.content[0].text).toContain('Total periods available:** 3')
			expect(result.content[0].text).toContain('1609459200')
			expect(result.content[0].text).toContain('1610064000')
		})

		it('should use session username when no username provided', async () => {
			const mockChartList = {
				weeklychartlist: {
					chart: [{ from: '1609459200', to: '1610064000' }],
				},
			}

			mockCachedClient.getWeeklyChartList = vi.fn().mockResolvedValue(mockChartList)

			await handleAuthenticatedToolsCall(
				{
					name: 'get_weekly_chart_list',
					arguments: { username: 'testuser' },
				},
				mockSession,
				mockEnv,
			)

			expect(mockCachedClient.getWeeklyChartList).toHaveBeenCalledWith('testuser')
		})

		it('should handle empty chart list', async () => {
			const mockChartList = {
				weeklychartlist: {
					chart: [],
				},
			}

			mockCachedClient.getWeeklyChartList = vi.fn().mockResolvedValue(mockChartList)

			const result = await handleAuthenticatedToolsCall(
				{
					name: 'get_weekly_chart_list',
					arguments: { username: 'testuser' },
				},
				mockSession,
				mockEnv,
			)

			expect(result.content[0].text).toContain('Total periods available:** 0')
		})
	})

	describe('get_weekly_artist_chart', () => {
		it('should get weekly artist chart for specific time period', async () => {
			const mockArtistChart = {
				weeklyartistchart: {
					artist: [
						{
							name: 'Radiohead',
							playcount: '25',
							'@attr': { rank: '1' },
						},
						{
							name: 'Led Zeppelin',
							playcount: '18',
							'@attr': { rank: '2' },
						},
					],
					'@attr': {
						user: 'testuser',
						from: '1609459200',
						to: '1610064000',
					},
				},
			}

			mockCachedClient.getWeeklyArtistChart = vi.fn().mockResolvedValue(mockArtistChart)

			const result = await handleAuthenticatedToolsCall(
				{
					name: 'get_weekly_artist_chart',
					arguments: {
						username: 'testuser',
						from: 1609459200,
						to: 1610064000,
					},
				},
				mockSession,
				mockEnv,
			)

			expect(mockCachedClient.getWeeklyArtistChart).toHaveBeenCalledWith('testuser', 1609459200, 1610064000)
			expect(result.content[0].text).toContain('Weekly Artist Chart for testuser')
			expect(result.content[0].text).toContain('Radiohead (25 plays)')
			expect(result.content[0].text).toContain('Led Zeppelin (18 plays)')
			expect(result.content[0].text).toContain('Total artists in this period:** 2')
		})

		it('should get most recent week when no dates provided', async () => {
			const mockArtistChart = {
				weeklyartistchart: {
					artist: [
						{
							name: 'Radiohead',
							playcount: '25',
							'@attr': { rank: '1' },
						},
					],
					'@attr': {
						user: 'testuser',
						from: '',
						to: '',
					},
				},
			}

			mockCachedClient.getWeeklyArtistChart = vi.fn().mockResolvedValue(mockArtistChart)

			const result = await handleAuthenticatedToolsCall(
				{
					name: 'get_weekly_artist_chart',
					arguments: { username: 'testuser' },
				},
				mockSession,
				mockEnv,
			)

			expect(mockCachedClient.getWeeklyArtistChart).toHaveBeenCalledWith('testuser', undefined, undefined)
			expect(result.content[0].text).toContain('Period:** Most Recent Week')
		})

		it('should limit results to top 30 artists', async () => {
			// Create a mock with 50 artists
			const artists = Array.from({ length: 50 }, (_, i) => ({
				name: `Artist ${i + 1}`,
				playcount: `${50 - i}`,
				'@attr': { rank: `${i + 1}` },
			}))

			const mockArtistChart = {
				weeklyartistchart: {
					artist: artists,
					'@attr': {
						user: 'testuser',
						from: '1609459200',
						to: '1610064000',
					},
				},
			}

			mockCachedClient.getWeeklyArtistChart = vi.fn().mockResolvedValue(mockArtistChart)

			const result = await handleAuthenticatedToolsCall(
				{
					name: 'get_weekly_artist_chart',
					arguments: { username: 'testuser' },
				},
				mockSession,
				mockEnv,
			)

			expect(result.content[0].text).toContain('Total artists in this period:** 50')
			expect(result.content[0].text).toContain('Showing top 30 artists only')
			// Should show first 30 artists
			expect(result.content[0].text).toContain('30. Artist 30')
			// Should not show 31st artist
			expect(result.content[0].text).not.toContain('31. Artist 31')
		})
	})

	describe('get_weekly_track_chart', () => {
		it('should get weekly track chart for specific time period', async () => {
			const mockTrackChart = {
				weeklytrackchart: {
					track: [
						{
							name: 'Creep',
							artist: { '#text': 'Radiohead' },
							playcount: '12',
							'@attr': { rank: '1' },
						},
						{
							name: 'Stairway to Heaven',
							artist: { '#text': 'Led Zeppelin' },
							playcount: '10',
							'@attr': { rank: '2' },
						},
					],
					'@attr': {
						user: 'testuser',
						from: '1609459200',
						to: '1610064000',
					},
				},
			}

			mockCachedClient.getWeeklyTrackChart = vi.fn().mockResolvedValue(mockTrackChart)

			const result = await handleAuthenticatedToolsCall(
				{
					name: 'get_weekly_track_chart',
					arguments: {
						username: 'testuser',
						from: 1609459200,
						to: 1610064000,
					},
				},
				mockSession,
				mockEnv,
			)

			expect(mockCachedClient.getWeeklyTrackChart).toHaveBeenCalledWith('testuser', 1609459200, 1610064000)
			expect(result.content[0].text).toContain('Weekly Track Chart for testuser')
			expect(result.content[0].text).toContain('Radiohead - Creep (12 plays)')
			expect(result.content[0].text).toContain('Led Zeppelin - Stairway to Heaven (10 plays)')
			expect(result.content[0].text).toContain('Total tracks in this period:** 2')
		})

		it('should get most recent week when no dates provided', async () => {
			const mockTrackChart = {
				weeklytrackchart: {
					track: [
						{
							name: 'Creep',
							artist: { '#text': 'Radiohead' },
							playcount: '12',
							'@attr': { rank: '1' },
						},
					],
					'@attr': {
						user: 'testuser',
						from: '',
						to: '',
					},
				},
			}

			mockCachedClient.getWeeklyTrackChart = vi.fn().mockResolvedValue(mockTrackChart)

			const result = await handleAuthenticatedToolsCall(
				{
					name: 'get_weekly_track_chart',
					arguments: { username: 'testuser' },
				},
				mockSession,
				mockEnv,
			)

			expect(mockCachedClient.getWeeklyTrackChart).toHaveBeenCalledWith('testuser', undefined, undefined)
			expect(result.content[0].text).toContain('Period:** Most Recent Week')
		})

		it('should limit results to top 30 tracks', async () => {
			// Create a mock with 50 tracks
			const tracks = Array.from({ length: 50 }, (_, i) => ({
				name: `Track ${i + 1}`,
				artist: { '#text': `Artist ${i + 1}` },
				playcount: `${50 - i}`,
				'@attr': { rank: `${i + 1}` },
			}))

			const mockTrackChart = {
				weeklytrackchart: {
					track: tracks,
					'@attr': {
						user: 'testuser',
						from: '1609459200',
						to: '1610064000',
					},
				},
			}

			mockCachedClient.getWeeklyTrackChart = vi.fn().mockResolvedValue(mockTrackChart)

			const result = await handleAuthenticatedToolsCall(
				{
					name: 'get_weekly_track_chart',
					arguments: { username: 'testuser' },
				},
				mockSession,
				mockEnv,
			)

			expect(result.content[0].text).toContain('Total tracks in this period:** 50')
			expect(result.content[0].text).toContain('Showing top 30 tracks only')
			// Should show first 30 tracks
			expect(result.content[0].text).toContain('30. Artist 30 - Track 30')
			// Should not show 31st track
			expect(result.content[0].text).not.toContain('31. Artist 31 - Track 31')
		})
	})

	describe('error handling', () => {
		it('should handle Last.fm API errors for chart list', async () => {
			mockCachedClient.getWeeklyChartList = vi.fn().mockRejectedValue(new Error('Last.fm API error 8: Service temporarily unavailable'))

			await expect(
				handleAuthenticatedToolsCall(
					{
						name: 'get_weekly_chart_list',
						arguments: { username: 'testuser' },
					},
					mockSession,
					mockEnv,
				),
			).rejects.toThrow('Last.fm API error 8: Service temporarily unavailable')
		})

		it('should handle Last.fm API errors for artist chart', async () => {
			mockCachedClient.getWeeklyArtistChart = vi.fn().mockRejectedValue(new Error('Last.fm API error 6: User not found'))

			await expect(
				handleAuthenticatedToolsCall(
					{
						name: 'get_weekly_artist_chart',
						arguments: { username: 'nonexistentuser' },
					},
					mockSession,
					mockEnv,
				),
			).rejects.toThrow('Last.fm API error 6: User not found')
		})

		it('should handle Last.fm API errors for track chart', async () => {
			mockCachedClient.getWeeklyTrackChart = vi.fn().mockRejectedValue(new Error('Last.fm API error 11: Service offline'))

			await expect(
				handleAuthenticatedToolsCall(
					{
						name: 'get_weekly_track_chart',
						arguments: { username: 'testuser' },
					},
					mockSession,
					mockEnv,
				),
			).rejects.toThrow('Last.fm API error 11: Service offline')
		})
	})
})
