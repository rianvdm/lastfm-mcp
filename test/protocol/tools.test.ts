import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleMethod, resetInitialization } from '../../src/protocol/handlers'
import { discogsClient } from '../../src/clients/discogs'
import { createSessionToken } from '../../src/auth/jwt'

// Mock the Discogs client
vi.mock('../../src/clients/discogs', () => ({
	discogsClient: {
		getUserProfile: vi.fn(),
		searchCollection: vi.fn(),
		getRelease: vi.fn(),
		getCollectionStats: vi.fn(),
	},
}))

const mockDiscogsClient = vi.mocked(discogsClient)

// Mock JWT secret for testing
const mockJwtSecret = 'test-jwt-secret'

// Helper to create mock authenticated request
async function createMockAuthenticatedRequest(): Promise<Request> {
	const sessionToken = await createSessionToken({
		userId: 'test-user',
		accessToken: 'test-token',
		accessTokenSecret: 'test-secret',
	}, mockJwtSecret)

	return new Request('http://localhost:8787/', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Cookie': `session=${sessionToken}`
		},
	})
}

describe('MCP Tools', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetInitialization()
	})

	describe('Non-authenticated tools', () => {
		it('should handle ping tool', async () => {
			// Initialize first
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					name: 'ping',
					arguments: { message: 'Hello World!' }
				},
				id: 2,
			})

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: 'Pong! You said: Hello World!'
						}
					]
				}
			})
		})

		it('should handle server_info tool', async () => {
			// Initialize first
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					name: 'server_info',
					arguments: {}
				},
				id: 2,
			})

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Discogs MCP Server v1.0.0')
						}
					]
				}
			})
		})
	})

	describe('Authenticated tools', () => {
		it('should handle search_collection tool', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			const mockSearchResults = {
				pagination: { pages: 1, page: 1, per_page: 50, items: 2, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Test Album',
							year: 2023,
							artists: [{ name: 'Test Artist', id: 1 }],
							genres: ['Rock'],
							styles: ['Alternative'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Test Label', catno: 'TEST001' }],
							resource_url: 'https://api.discogs.com/releases/1',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockDiscogsClient.getUserProfile.mockResolvedValue(mockUserProfile)
			mockDiscogsClient.searchCollection.mockResolvedValue(mockSearchResults)

			// Initialize first
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					name: 'search_collection',
					arguments: { query: 'rock', per_page: 25 }
				},
				id: 2,
			}, await createMockAuthenticatedRequest(), mockJwtSecret)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Found 2 results for "rock"')
						}
					]
				}
			})

			expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token')
			expect(mockDiscogsClient.searchCollection).toHaveBeenCalledWith('testuser', 'test-token', {
				query: 'rock',
				per_page: 25,
			})
		})

		it('should handle get_release tool', async () => {
			const mockRelease = {
				id: 123456,
				title: 'Test Release',
				artists: [{ name: 'Test Artist', id: 1 }],
				year: 2023,
				genres: ['Rock'],
				styles: ['Alternative'],
				formats: [{ name: 'Vinyl', qty: '1' }],
				tracklist: [
					{ position: 'A1', title: 'Track 1', duration: '3:45' },
					{ position: 'A2', title: 'Track 2', duration: '4:12' },
				],
				labels: [{ name: 'Test Label', catno: 'TEST001' }],
				resource_url: 'https://api.discogs.com/releases/123456',
				uri: 'https://www.discogs.com/release/123456',
				data_quality: 'Needs Vote',
				country: 'US',
			}

			mockDiscogsClient.getRelease.mockResolvedValue(mockRelease)

			// Initialize first
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					name: 'get_release',
					arguments: { release_id: '123456' }
				},
				id: 2,
			}, await createMockAuthenticatedRequest(), mockJwtSecret)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Test Artist - Test Release')
						}
					]
				}
			})

			expect(mockDiscogsClient.getRelease).toHaveBeenCalledWith('123456', 'test-token')
		})

		it('should handle get_collection_stats tool', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			const mockStats = {
				totalReleases: 100,
				totalValue: 1500.50,
				genreBreakdown: { 'Rock': 40, 'Jazz': 30, 'Electronic': 20, 'Hip Hop': 10 },
				decadeBreakdown: { '2000': 30, '1990': 25, '1980': 20, '2010': 15, '1970': 10 },
				formatBreakdown: { 'Vinyl': 60, 'CD': 30, 'Cassette': 10 },
				labelBreakdown: { 'Blue Note': 15, 'Warp': 10, 'Def Jam': 8 },
				averageRating: 4.2,
				ratedReleases: 75,
			}

			mockDiscogsClient.getUserProfile.mockResolvedValue(mockUserProfile)
			mockDiscogsClient.getCollectionStats.mockResolvedValue(mockStats)

			// Initialize first
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					name: 'get_collection_stats',
					arguments: {}
				},
				id: 2,
			}, await createMockAuthenticatedRequest(), mockJwtSecret)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Collection Statistics for testuser')
						}
					]
				}
			})

			expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token')
			expect(mockDiscogsClient.getCollectionStats).toHaveBeenCalledWith('testuser', 'test-token')
		})

		it('should handle get_recommendations tool', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			const mockStats = {
				totalReleases: 100,
				totalValue: 1500.50,
				genreBreakdown: { 'Rock': 40, 'Jazz': 30, 'Electronic': 20 },
				decadeBreakdown: { '2000': 30, '1990': 25, '1980': 20 },
				formatBreakdown: { 'Vinyl': 60, 'CD': 30, 'Cassette': 10 },
				labelBreakdown: { 'Blue Note': 15, 'Warp': 10 },
				averageRating: 4.2,
				ratedReleases: 75,
			}

			mockDiscogsClient.getUserProfile.mockResolvedValue(mockUserProfile)
			mockDiscogsClient.getCollectionStats.mockResolvedValue(mockStats)

			// Initialize first
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					name: 'get_recommendations',
					arguments: { limit: 5 }
				},
				id: 2,
			}, await createMockAuthenticatedRequest(), mockJwtSecret)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Music Recommendations Based on Your Collection')
						}
					]
				}
			})

			expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token')
			expect(mockDiscogsClient.getCollectionStats).toHaveBeenCalledWith('testuser', 'test-token')
		})

		it('should require authentication for authenticated tools', async () => {
			// Initialize first
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					name: 'search_collection',
					arguments: { query: 'rock' }
				},
				id: 2,
			})

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				error: {
					code: -32603,
					message: 'Internal error: Missing authentication context for authenticated tool'
				}
			})
		})

		it('should handle tool parameter validation', async () => {
			// Initialize first
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'Test', version: '1.0' },
				},
				id: 1,
			})

			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					name: 'search_collection',
					arguments: {} // Missing required query parameter
				},
				id: 2,
			}, await createMockAuthenticatedRequest(), mockJwtSecret)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				error: {
					code: -32603,
					message: 'search_collection requires a query parameter'
				}
			})
		})
	})
}) 