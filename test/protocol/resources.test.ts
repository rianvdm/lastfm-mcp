import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleResourcesList, handleResourcesRead } from '../../src/protocol/handlers'
import { LastfmClient } from '../../src/clients/lastfm'
import { CachedLastfmClient } from '../../src/clients/cachedLastfm'

// Mock the Last.fm client
vi.mock('../../src/clients/lastfm')
vi.mock('../../src/clients/cachedLastfm')

const mockLastfmClient = vi.mocked(LastfmClient)
const mockCachedLastfmClient = vi.mocked(CachedLastfmClient)

describe('MCP Resources', () => {
	describe('handleResourcesList', () => {
		it('should return list of available resources', () => {
			const result = handleResourcesList()

			expect(result).toHaveProperty('resources')
			expect(Array.isArray(result.resources)).toBe(true)
			expect(result.resources).toHaveLength(10)

			// Check user recent tracks resource
			const recentResource = result.resources.find((r) => r.uri === 'lastfm://user/{username}/recent')
			expect(recentResource).toBeDefined()
			expect(recentResource?.name).toBe('Recent Tracks')
			expect(recentResource?.description).toContain('recently played tracks')
			expect(recentResource?.mimeType).toBe('application/json')

			// Check track info resource
			const trackResource = result.resources.find((r) => r.uri === 'lastfm://track/{artist}/{track}')
			expect(trackResource).toBeDefined()
			expect(trackResource?.name).toBe('Track Information')
			expect(trackResource?.description).toContain('Detailed information')
			expect(trackResource?.mimeType).toBe('application/json')

			// Check artist info resource
			const artistResource = result.resources.find((r) => r.uri === 'lastfm://artist/{artist}')
			expect(artistResource).toBeDefined()
			expect(artistResource?.name).toBe('Artist Information')
			expect(artistResource?.description).toContain('Detailed information')
			expect(artistResource?.mimeType).toBe('application/json')
		})

		it('should return resources with proper URI schemes', () => {
			const result = handleResourcesList()

			result.resources.forEach((resource) => {
				expect(resource.uri).toMatch(/^lastfm:\/\//)
				expect(resource.name).toBeTruthy()
				expect(resource.mimeType).toBe('application/json')
			})
		})
	})

	describe('handleResourcesRead', () => {
		const mockSession = {
			username: 'testuser',
			userId: 'test-user',
			accessToken: 'test-token',
			accessTokenSecret: 'test-secret',
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 3600,
		}

		const mockEnv = {
			LASTFM_API_KEY: 'test-api-key',
			MCP_SESSIONS: {} as any,
		}

		beforeEach(() => {
			vi.clearAllMocks()
		})

		it('should read recent tracks resource', async () => {
			const mockRecentTracks = {
				recenttracks: {
					track: [
						{
							name: 'Test Track',
							artist: { '#text': 'Test Artist' },
							album: { '#text': 'Test Album' },
							date: { uts: '1640995200' },
						},
					],
					'@attr': { total: '1' },
				},
			}

			const mockCachedClient = {
				getRecentTracks: vi.fn().mockResolvedValue(mockRecentTracks),
			}

			vi.mocked(CachedLastfmClient).mockImplementation(() => mockCachedClient as any)

			const result = await handleResourcesRead({ uri: 'lastfm://user/testuser/recent' }, mockSession, mockEnv)

			expect(result.contents).toHaveLength(1)
			expect(result.contents[0].uri).toBe('lastfm://user/testuser/recent')
			expect(result.contents[0].mimeType).toBe('application/json')
			expect(result.contents[0].text).toBeDefined()

			const parsedContent = JSON.parse(result.contents[0].text!)
			expect(parsedContent).toEqual(mockRecentTracks)

			expect(mockCachedClient.getRecentTracks).toHaveBeenCalledWith('testuser', 50)
		})

		it('should read track info resource', async () => {
			const mockTrackInfo = {
				track: {
					name: 'Test Track',
					artist: { name: 'Test Artist' },
					album: { '#text': 'Test Album' },
					playcount: '1000',
					listeners: '500',
					toptags: { tag: [{ name: 'rock' }] },
					wiki: { summary: 'A test track' },
				},
			}

			const mockCachedClient = {
				getTrackInfo: vi.fn().mockResolvedValue(mockTrackInfo),
			}

			vi.mocked(CachedLastfmClient).mockImplementation(() => mockCachedClient as any)

			const result = await handleResourcesRead({ uri: 'lastfm://track/Test Artist/Test Track' }, mockSession, mockEnv)

			expect(result.contents).toHaveLength(1)
			expect(result.contents[0].uri).toBe('lastfm://track/Test Artist/Test Track')
			expect(result.contents[0].mimeType).toBe('application/json')

			const parsedContent = JSON.parse(result.contents[0].text!)
			expect(parsedContent).toEqual(mockTrackInfo)

			expect(mockCachedClient.getTrackInfo).toHaveBeenCalledWith('Test Artist', 'Test Track', 'testuser')
		})

		it('should read artist info resource', async () => {
			const mockArtistInfo = {
				artist: {
					name: 'Test Artist',
					stats: { playcount: '5000', listeners: '2000' },
					tags: { tag: [{ name: 'rock' }] },
					similar: { artist: [{ name: 'Similar Artist' }] },
					bio: { summary: 'A test artist' },
				},
			}

			const mockCachedClient = {
				getArtistInfo: vi.fn().mockResolvedValue(mockArtistInfo),
			}

			vi.mocked(CachedLastfmClient).mockImplementation(() => mockCachedClient as any)

			const result = await handleResourcesRead({ uri: 'lastfm://artist/Test Artist' }, mockSession, mockEnv)

			expect(result.contents).toHaveLength(1)
			expect(result.contents[0].uri).toBe('lastfm://artist/Test Artist')
			expect(result.contents[0].mimeType).toBe('application/json')

			const parsedContent = JSON.parse(result.contents[0].text!)
			expect(parsedContent).toEqual(mockArtistInfo)

			expect(mockCachedClient.getArtistInfo).toHaveBeenCalledWith('Test Artist', 'testuser')
		})

		it('should throw error for invalid params', async () => {
			await expect(handleResourcesRead({}, mockSession, mockEnv)).rejects.toThrow('uri parameter must be a string')
			await expect(handleResourcesRead({ uri: null }, mockSession, mockEnv)).rejects.toThrow('uri parameter must be a string')
		})

		it('should throw error for invalid track URI', async () => {
			await expect(handleResourcesRead({ uri: 'lastfm://track/' }, mockSession, mockEnv)).rejects.toThrow('Invalid Last.fm URI format')
			await expect(handleResourcesRead({ uri: 'lastfm://track/artist' }, mockSession, mockEnv)).rejects.toThrow(
				'Invalid Last.fm URI format',
			)
		})

		it('should throw error for invalid artist URI', async () => {
			await expect(handleResourcesRead({ uri: 'lastfm://artist/' }, mockSession, mockEnv)).rejects.toThrow('Artist name is required')
		})

		it('should throw error for unsupported URI', async () => {
			await expect(handleResourcesRead({ uri: 'lastfm://unknown' }, mockSession, mockEnv)).rejects.toThrow('Invalid Last.fm URI format')
		})

		it('should handle Last.fm API errors', async () => {
			const mockCachedClient = {
				getRecentTracks: vi.fn().mockRejectedValue(new Error('API Error')),
			}

			vi.mocked(CachedLastfmClient).mockImplementation(() => mockCachedClient as any)

			await expect(handleResourcesRead({ uri: 'lastfm://user/testuser/recent' }, mockSession, mockEnv)).rejects.toThrow(
				'Failed to read Last.fm resource: API Error',
			)
		})
	})
})
