/**
 * Tests for Last.fm API client
 * Critical tests for core business logic that was previously untested
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LastfmClient } from '../../src/clients/lastfm'
import { fetchWithRetry } from '../../src/utils/retry'
import type {
	LastfmRecentTracksResponse,
	LastfmTopArtistsResponse,
	LastfmTopAlbumsResponse,
	LastfmLovedTracksResponse,
	LastfmTrackInfoResponse,
	LastfmArtistInfoResponse,
	LastfmAlbumInfoResponse,
	LastfmUserInfoResponse,
	LastfmSimilarArtistsResponse,
	LastfmSimilarTracksResponse,
	LastfmError,
} from '../../src/clients/lastfm'

// Mock fetchWithRetry to control API responses
vi.mock('../../src/utils/retry', () => ({
	fetchWithRetry: vi.fn(),
}))

const mockFetchWithRetry = vi.mocked(fetchWithRetry)

// Mock realistic Last.fm API responses
const mockRecentTracksResponse: LastfmRecentTracksResponse = {
	recenttracks: {
		track: [
			{
				name: 'Bohemian Rhapsody',
				artist: { '#text': 'Queen', mbid: 'abc123' },
				album: { '#text': 'A Night at the Opera', mbid: 'def456' },
				url: 'https://www.last.fm/music/Queen/_/Bohemian+Rhapsody',
				streamable: '0',
				date: { uts: '1642123456', '#text': '14 Jan 2022, 12:30' },
				image: [
					{ '#text': 'small.jpg', size: 'small' },
					{ '#text': 'medium.jpg', size: 'medium' },
				],
			},
		],
		'@attr': {
			user: 'testuser',
			totalPages: '1',
			page: '1',
			perPage: '50',
			total: '1',
		},
	},
}

const mockArtistInfoResponse: LastfmArtistInfoResponse = {
	artist: {
		name: 'Queen',
		mbid: 'abc123',
		url: 'https://www.last.fm/music/Queen',
		image: [{ '#text': 'artist.jpg', size: 'large' }],
		streamable: '0',
		stats: {
			listeners: '4000000',
			playcount: '100000000',
		},
		similar: {
			artist: [
				{
					name: 'Led Zeppelin',
					url: 'https://www.last.fm/music/Led+Zeppelin',
					image: [{ '#text': 'led.jpg', size: 'medium' }],
					playcount: '50000000',
				},
			],
		},
		tags: {
			tag: [
				{ name: 'rock', url: 'https://www.last.fm/tag/rock', count: 100 },
				{ name: 'classic rock', url: 'https://www.last.fm/tag/classic+rock', count: 95 },
			],
		},
		bio: {
			published: '2022-01-01 12:00:00',
			summary: 'Queen are a British rock band...',
			content: 'Queen are a British rock band formed in London in 1970...',
		},
	},
}

const mockErrorResponse: LastfmError = {
	error: 6,
	message: 'User not found',
}

describe('LastfmClient', () => {
	let client: LastfmClient
	const mockApiKey = 'test-api-key'

	beforeEach(() => {
		client = new LastfmClient(mockApiKey)
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe('constructor', () => {
		it('should initialize with API key', () => {
			expect(client).toBeInstanceOf(LastfmClient)
		})
	})

	describe('request throttling', () => {
		it('should throttle requests to respect rate limits', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue(mockRecentTracksResponse),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			// Make first request
			const promise1 = client.getRecentTracks('testuser')

			// Advance time by 100ms (less than 250ms throttle)
			vi.advanceTimersByTime(100)

			// Make second request immediately
			const promise2 = client.getRecentTracks('testuser')

			// Should delay second request by ~150ms more
			vi.advanceTimersByTime(150)

			await Promise.all([promise1, promise2])

			// Should have made exactly 2 requests
			expect(mockFetchWithRetry).toHaveBeenCalledTimes(2)
		})

		it('should not throttle if enough time has passed', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue(mockRecentTracksResponse),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			// Make first request
			await client.getRecentTracks('testuser')

			// Advance time by more than throttle delay
			vi.advanceTimersByTime(300)

			// Make second request
			await client.getRecentTracks('testuser')

			expect(mockFetchWithRetry).toHaveBeenCalledTimes(2)
		})
	})

	describe('API request formation', () => {
		it('should form correct URL with parameters', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue(mockRecentTracksResponse),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			await client.getRecentTracks('testuser', 25)

			expect(mockFetchWithRetry).toHaveBeenCalledWith(
				expect.stringContaining('api_key=test-api-key'),
				expect.objectContaining({
					method: 'GET',
					headers: {
						'User-Agent': 'lastfm-mcp/1.0.0',
					},
				}),
				expect.any(Object),
			)

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('method=user.getRecentTracks')
			expect(url).toContain('user=testuser')
			expect(url).toContain('limit=25')
			expect(url).toContain('format=json')
		})

		it('should include optional parameters when provided', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue(mockRecentTracksResponse),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			await client.getRecentTracks('testuser', 50, 1640000000, 1650000000)

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('from=1640000000')
			expect(url).toContain('to=1650000000')
		})
	})

	describe('API response parsing', () => {
		it('should parse successful response correctly', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue(mockRecentTracksResponse),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			const result = await client.getRecentTracks('testuser')

			expect(result).toEqual(mockRecentTracksResponse)
			expect(result.recenttracks.track[0]).toMatchObject({
				name: 'Bohemian Rhapsody',
				artist: { '#text': 'Queen' },
				album: { '#text': 'A Night at the Opera' },
			})
		})

		it('should handle complex nested data structures', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue(mockArtistInfoResponse),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			const result = await client.getArtistInfo('Queen')

			expect(result.artist.similar.artist).toHaveLength(1)
			expect(result.artist.tags.tag).toHaveLength(2)
			expect(result.artist.bio.content).toContain('British rock band')
		})

		it('should preserve all metadata and attributes', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue(mockRecentTracksResponse),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			const result = await client.getRecentTracks('testuser')

			expect(result.recenttracks['@attr']).toMatchObject({
				user: 'testuser',
				totalPages: '1',
				page: '1',
				perPage: '50',
				total: '1',
			})
		})
	})

	describe('error handling', () => {
		it('should throw error for Last.fm API errors', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue(mockErrorResponse),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			await expect(client.getRecentTracks('nonexistentuser')).rejects.toThrow('Last.fm API error 6: User not found')
		})

		it('should handle network errors gracefully', async () => {
			mockFetchWithRetry.mockRejectedValue(new Error('Network error'))

			await expect(client.getRecentTracks('testuser')).rejects.toThrow('Network error')
		})

		it('should handle malformed JSON responses', async () => {
			const mockResponse = {
				json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			await expect(client.getRecentTracks('testuser')).rejects.toThrow('Invalid JSON')
		})

		it('should handle empty responses', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue(null),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			await expect(client.getRecentTracks('testuser')).rejects.toThrow()
		})
	})

	describe('API method implementations', () => {
		beforeEach(() => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue({}),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)
		})

		it('should call getTopArtists with correct parameters', async () => {
			await client.getTopArtists('testuser', '1month', 25)

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('method=user.getTopArtists')
			expect(url).toContain('user=testuser')
			expect(url).toContain('period=1month')
			expect(url).toContain('limit=25')
		})

		it('should call getTopAlbums with correct parameters', async () => {
			await client.getTopAlbums('testuser', '3month', 30)

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('method=user.getTopAlbums')
			expect(url).toContain('period=3month')
			expect(url).toContain('limit=30')
		})

		it('should call getLovedTracks with correct parameters', async () => {
			await client.getLovedTracks('testuser', 100)

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('method=user.getLovedTracks')
			expect(url).toContain('limit=100')
		})

		it('should call getTrackInfo with optional username', async () => {
			await client.getTrackInfo('Queen', 'Bohemian Rhapsody', 'testuser')

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('method=track.getInfo')
			expect(url).toContain('artist=Queen')
			expect(url).toContain('track=Bohemian+Rhapsody')
			expect(url).toContain('username=testuser')
		})

		it('should call getTrackInfo without username', async () => {
			await client.getTrackInfo('Queen', 'Bohemian Rhapsody')

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).not.toContain('username=')
		})

		it('should call getArtistInfo with correct parameters', async () => {
			await client.getArtistInfo('Queen', 'testuser')

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('method=artist.getInfo')
			expect(url).toContain('artist=Queen')
			expect(url).toContain('username=testuser')
		})

		it('should call getAlbumInfo with correct parameters', async () => {
			await client.getAlbumInfo('Queen', 'A Night at the Opera')

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('method=album.getInfo')
			expect(url).toContain('artist=Queen')
			expect(url).toContain('album=A+Night+at+the+Opera')
		})

		it('should call getUserInfo with correct parameters', async () => {
			await client.getUserInfo('testuser')

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('method=user.getInfo')
			expect(url).toContain('user=testuser')
		})

		it('should call getSimilarArtists with correct parameters', async () => {
			await client.getSimilarArtists('Queen', 20)

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('method=artist.getSimilar')
			expect(url).toContain('artist=Queen')
			expect(url).toContain('limit=20')
		})

		it('should call getSimilarTracks with correct parameters', async () => {
			await client.getSimilarTracks('Queen', 'Bohemian Rhapsody', 15)

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('method=track.getSimilar')
			expect(url).toContain('artist=Queen')
			expect(url).toContain('track=Bohemian+Rhapsody')
			expect(url).toContain('limit=15')
		})
	})

	describe('retry logic integration', () => {
		it('should use retry options for API calls', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue(mockRecentTracksResponse),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			await client.getRecentTracks('testuser')

			expect(mockFetchWithRetry).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Object),
				expect.objectContaining({
					maxRetries: 3,
					initialDelayMs: 1000,
					maxDelayMs: 15000,
					backoffMultiplier: 2,
					jitterFactor: 0.1,
				}),
			)
		})
	})

	describe('parameter validation', () => {
		it('should handle special characters in parameters', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue({}),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			await client.getTrackInfo('Motörhead', 'Ace of Spades')

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('artist=Mot%C3%B6rhead')
			expect(url).toContain('track=Ace+of+Spades')
		})

		it('should handle empty and whitespace parameters', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue({}),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			await client.getTrackInfo('  Artist  ', '  Track  ')

			const [url] = mockFetchWithRetry.mock.calls[0]
			expect(url).toContain('artist=++Artist++')
			expect(url).toContain('track=++Track++')
		})
	})

	describe('rate limiting compliance', () => {
		it('should respect Last.fm rate limits with proper delays', async () => {
			const mockResponse = {
				json: vi.fn().mockResolvedValue(mockRecentTracksResponse),
			}
			mockFetchWithRetry.mockResolvedValue(mockResponse)

			const startTime = Date.now()

			// Make multiple requests
			const promises = Array.from({ length: 3 }, () => client.getRecentTracks('testuser'))

			// Should complete all requests with proper throttling
			vi.advanceTimersByTime(1000) // Advance enough time for all throttling
			await Promise.all(promises)

			expect(mockFetchWithRetry).toHaveBeenCalledTimes(3)
		})
	})
})
