import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleMethod, resetInitialization } from '../../src/protocol/handlers'
import { resetProtocolState } from '../../src/protocol/validation'
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
	const sessionToken = await createSessionToken(
		{
			userId: 'test-user',
			accessToken: 'test-token',
			accessTokenSecret: 'test-secret',
		},
		mockJwtSecret,
	)

	return new Request('http://localhost:8787/', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Cookie: `session=${sessionToken}`,
		},
	})
}

describe('MCP Tools', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		resetInitialization()
		resetProtocolState()
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					name: 'ping',
					arguments: { message: 'Hello World!' },
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
							text: 'Pong! You said: Hello World!',
						},
					],
				},
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					name: 'server_info',
					arguments: {},
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
							text: expect.stringContaining('Discogs MCP Server v1.0.0'),
						},
					],
				},
			})
		})

		it('should provide authentication instructions for auth_status tool', async () => {
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			// auth_status now provides helpful instructions for unauthenticated users
			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					name: 'auth_status',
					arguments: {},
				},
				id: 2,
			})

			// Should return helpful authentication instructions
			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Authentication Status: Not Authenticated'),
						},
					],
				},
			})

			// Verify it contains authentication instructions
			const result = response?.result as { content: Array<{ type: string; text: string }> }
			const responseText = result.content[0].text
			expect(responseText).toContain('How to authenticate:')
			expect(responseText).toContain('Visit: https://discogs-mcp-prod.rian-db8.workers.dev/login')
			expect(responseText).toContain('What you\'ll be able to do after authentication:')
		})
	})

	describe('Authenticated tools', () => {
		it('should handle auth_status tool when authenticated', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			mockDiscogsClient.getUserProfile.mockResolvedValue(mockUserProfile)

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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod(
				{
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'auth_status',
						arguments: {},
					},
					id: 2,
				},
				await createMockAuthenticatedRequest(),
				mockJwtSecret,
			)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Authentication Status: Authenticated'),
						},
					],
				},
			})

			// Verify it contains the username and user ID
			const result = response?.result as { content: Array<{ type: string; text: string }> }
			const responseText = result.content[0].text
			expect(responseText).toContain('testuser')
			expect(responseText).toContain('**User ID:** 123')
			expect(responseText).toContain('Available Tools')

			expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token', 'test-secret', '', '')
		})

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
					{
						id: 2,
						instance_id: 2,
						date_added: '2023-01-02T00:00:00-08:00',
						rating: 4,
						basic_information: {
							id: 2,
							title: 'Another Rock Album',
							year: 2022,
							artists: [{ name: 'Another Artist', id: 2 }],
							genres: ['Rock'],
							styles: ['Classic Rock'],
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'Another Label', catno: 'TEST002' }],
							resource_url: 'https://api.discogs.com/releases/2',
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod(
				{
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'search_collection',
						arguments: { query: 'rock', per_page: 25 },
					},
					id: 2,
				},
				await createMockAuthenticatedRequest(),
				mockJwtSecret,
			)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Found 2 results for "rock"'),
						},
					],
				},
			})

			// Verify the response includes release IDs, genres, and styles
			const result = response?.result as { content: Array<{ type: string; text: string }> }
			const responseText = result.content[0].text
			expect(responseText).toContain('[ID: 1]')
			expect(responseText).toContain('Use the release IDs with the get_release tool')
			expect(responseText).toContain('Genre: Rock')
			expect(responseText).toContain('Styles: Alternative')
			expect(responseText).toContain('⭐5')

			expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token', 'test-secret', '', '')
			expect(mockDiscogsClient.searchCollection).toHaveBeenCalledWith(
				'testuser',
				'test-token',
				'test-secret',
				{
					query: 'rock',
					per_page: 25,
				},
				'',
				'',
			)
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod(
				{
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'get_release',
						arguments: { release_id: '123456' },
					},
					id: 2,
				},
				await createMockAuthenticatedRequest(),
				mockJwtSecret,
			)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Test Artist - Test Release'),
						},
					],
				},
			})

			expect(mockDiscogsClient.getRelease).toHaveBeenCalledWith('123456', 'test-token', 'test-secret')
		})

		it('should handle get_collection_stats tool', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			const mockStats = {
				totalReleases: 100,
				totalValue: 1500.5,
				genreBreakdown: { Rock: 40, Jazz: 30, Electronic: 20, 'Hip Hop': 10 },
				decadeBreakdown: { '2000': 30, '1990': 25, '1980': 20, '2010': 15, '1970': 10 },
				formatBreakdown: { Vinyl: 60, CD: 30, Cassette: 10 },
				labelBreakdown: { 'Blue Note': 15, Warp: 10, 'Def Jam': 8 },
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod(
				{
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'get_collection_stats',
						arguments: {},
					},
					id: 2,
				},
				await createMockAuthenticatedRequest(),
				mockJwtSecret,
			)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Collection Statistics for testuser'),
						},
					],
				},
			})

			expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token', 'test-secret', '', '')
			expect(mockDiscogsClient.getCollectionStats).toHaveBeenCalledWith('testuser', 'test-token', 'test-secret', '', '')
		})

		it('should handle get_recommendations tool', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			const mockSearchResults = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 3, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Kind of Blue',
							year: 1959,
							artists: [{ name: 'Miles Davis', id: 1 }],
							genres: ['Jazz'],
							styles: ['Hard Bop', 'Modal'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Columbia', catno: 'CL 1355' }],
							resource_url: 'https://api.discogs.com/releases/1',
							thumb: '',
							cover_image: '',
						},
					},
					{
						id: 2,
						instance_id: 2,
						date_added: '2023-01-02T00:00:00-08:00',
						rating: 4,
						basic_information: {
							id: 2,
							title: 'A Love Supreme',
							year: 1965,
							artists: [{ name: 'John Coltrane', id: 2 }],
							genres: ['Jazz'],
							styles: ['Hard Bop', 'Free Jazz'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Impulse!', catno: 'A-77' }],
							resource_url: 'https://api.discogs.com/releases/2',
							thumb: '',
							cover_image: '',
						},
					},
					{
						id: 3,
						instance_id: 3,
						date_added: '2023-01-03T00:00:00-08:00',
						rating: 3,
						basic_information: {
							id: 3,
							title: 'Abbey Road',
							year: 1969,
							artists: [{ name: 'The Beatles', id: 3 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'Apple Records', catno: 'PCS 7088' }],
							resource_url: 'https://api.discogs.com/releases/3',
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod(
				{
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'get_recommendations',
						arguments: { limit: 5 },
					},
					id: 2,
				},
				await createMockAuthenticatedRequest(),
				mockJwtSecret,
			)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Context-Aware Music Recommendations'),
						},
					],
				},
			})

			expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token', 'test-secret', '', '')
			expect(mockDiscogsClient.searchCollection).toHaveBeenCalledWith('testuser', 'test-token', 'test-secret', { per_page: 100 }, '', '')
		})

		it('should handle multiple genres in get_recommendations tool', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			const mockSearchResults = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 3, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'The Dark Side Of The Moon',
							year: 1973,
							artists: [{ name: 'Pink Floyd', id: 1 }],
							genres: ['Rock'],
							styles: ['Psychedelic Rock', 'Prog Rock'], // Matches "psychedelic" and "prog"
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Harvest', catno: 'SHVL 804' }],
							resource_url: 'https://api.discogs.com/releases/1',
							thumb: '',
							cover_image: '',
						},
					},
					{
						id: 2,
						instance_id: 2,
						date_added: '2023-01-02T00:00:00-08:00',
						rating: 4,
						basic_information: {
							id: 2,
							title: 'Space Oddity',
							year: 1969,
							artists: [{ name: 'David Bowie', id: 2 }],
							genres: ['Rock'],
							styles: ['Space Rock'], // Matches "space"
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'RCA', catno: 'LSP-4813' }],
							resource_url: 'https://api.discogs.com/releases/2',
							thumb: '',
							cover_image: '',
						},
					},
					{
						id: 3,
						instance_id: 3,
						date_added: '2023-01-03T00:00:00-08:00',
						rating: 3,
						basic_information: {
							id: 3,
							title: 'Jazz Album',
							year: 1965,
							artists: [{ name: 'Jazz Artist', id: 3 }],
							genres: ['Jazz'],
							styles: ['Hard Bop'], // Doesn't match any genre terms
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Blue Note', catno: 'BLP 4321' }],
							resource_url: 'https://api.discogs.com/releases/3',
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod(
				{
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'get_recommendations',
						arguments: {
							genre: 'psychedelic rock prog rock space rock', // Multiple genres
							limit: 3,
						},
					},
					id: 2,
				},
				await createMockAuthenticatedRequest(),
				mockJwtSecret,
			)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Context-Aware Music Recommendations'),
						},
					],
				},
			})

			// Check that the response includes both Pink Floyd and Bowie albums (matching different genre terms)
			const result = response?.result as { content: Array<{ type: string; text: string }> }
			const responseText = result.content[0].text
			expect(responseText).toContain('Genre: psychedelic rock prog rock space rock')
			expect(responseText).toContain('The Dark Side Of The Moon') // Matches "psychedelic" and "prog"
			expect(responseText).toContain('Space Oddity') // Matches "space"
			expect(responseText).not.toContain('Jazz Album') // Doesn't match any genre terms
			expect(responseText).toContain('Found 2 matching releases') // Should find 2 matches, not 0

			expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token', 'test-secret', '', '')
			expect(mockDiscogsClient.searchCollection).toHaveBeenCalledWith('testuser', 'test-token', 'test-secret', { per_page: 100 }, '', '')
		})

		it('should handle get_recommendations tool with format filter', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			const mockSearchResults = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 2, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Kind of Blue',
							year: 1959,
							artists: [{ name: 'Miles Davis', id: 1 }],
							genres: ['Jazz'],
							styles: ['Hard Bop', 'Modal'],
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'Columbia', catno: 'CL 1355' }],
							resource_url: 'https://api.discogs.com/releases/1',
							thumb: '',
							cover_image: '',
						},
					},
					{
						id: 2,
						instance_id: 2,
						date_added: '2023-01-02T00:00:00-08:00',
						rating: 4,
						basic_information: {
							id: 2,
							title: 'A Love Supreme',
							year: 1965,
							artists: [{ name: 'John Coltrane', id: 2 }],
							genres: ['Jazz'],
							styles: ['Hard Bop', 'Free Jazz'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Impulse!', catno: 'A-77' }],
							resource_url: 'https://api.discogs.com/releases/2',
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod(
				{
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'get_recommendations',
						arguments: {
							format: 'CD',
							limit: 3,
						},
					},
					id: 2,
				},
				await createMockAuthenticatedRequest(),
				mockJwtSecret,
			)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Context-Aware Music Recommendations'),
						},
					],
				},
			})

			// Check that the response includes filter information and only CD releases
			const result = response?.result as { content: Array<{ type: string; text: string }> }
			const responseText = result.content[0].text
			expect(responseText).toContain('Format: CD')
			expect(responseText).toContain('Kind of Blue') // Should include the CD album
			expect(responseText).not.toContain('A Love Supreme') // Should exclude the Vinyl album
			expect(responseText).toContain('Format: CD | Genres: Jazz') // Should show format in the output

			expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token', 'test-secret', '', '')
			expect(mockDiscogsClient.searchCollection).toHaveBeenCalledWith('testuser', 'test-token', 'test-secret', { per_page: 100 }, '', '')
		})

		it('should handle get_recommendations tool with context filters', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			const mockSearchResults = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 2, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Kind of Blue',
							year: 1959,
							artists: [{ name: 'Miles Davis', id: 1 }],
							genres: ['Jazz'],
							styles: ['Hard Bop', 'Modal'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Columbia', catno: 'CL 1355' }],
							resource_url: 'https://api.discogs.com/releases/1',
							thumb: '',
							cover_image: '',
						},
					},
					{
						id: 2,
						instance_id: 2,
						date_added: '2023-01-02T00:00:00-08:00',
						rating: 4,
						basic_information: {
							id: 2,
							title: 'A Love Supreme',
							year: 1965,
							artists: [{ name: 'John Coltrane', id: 2 }],
							genres: ['Jazz'],
							styles: ['Hard Bop', 'Free Jazz'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Impulse!', catno: 'A-77' }],
							resource_url: 'https://api.discogs.com/releases/2',
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod(
				{
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'get_recommendations',
						arguments: {
							genre: 'Jazz',
							decade: '1960s',
							limit: 3,
						},
					},
					id: 2,
				},
				await createMockAuthenticatedRequest(),
				mockJwtSecret,
			)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Context-Aware Music Recommendations'),
						},
					],
				},
			})

			// Check that the response includes filter information
			const result = response?.result as { content: Array<{ type: string; text: string }> }
			const responseText = result.content[0].text
			expect(responseText).toContain('Genre: Jazz')
			expect(responseText).toContain('Decade: 1960s')
			expect(responseText).toContain('A Love Supreme') // Should include the 1965 album

			expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token', 'test-secret', '', '')
			expect(mockDiscogsClient.searchCollection).toHaveBeenCalledWith('testuser', 'test-token', 'test-secret', { per_page: 100 }, '', '')
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod({
				jsonrpc: '2.0',
				method: 'tools/call',
				params: {
					name: 'search_collection',
					arguments: { query: 'rock' },
				},
				id: 2,
			})

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				error: {
					code: -32603,
					message: 'Internal error: Missing authentication context for authenticated tool',
				},
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod(
				{
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'search_collection',
						arguments: {}, // Missing required query parameter
					},
					id: 2,
				},
				await createMockAuthenticatedRequest(),
				mockJwtSecret,
			)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				error: {
					code: -32602,
					message: 'Missing required parameter: query',
				},
			})
		})

		it('should search collection by release ID 654321', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			const mockSearchResults = {
				pagination: { pages: 1, page: 1, per_page: 50, items: 1, urls: {} },
				releases: [
					{
						id: 654321,
						instance_id: 2,
						date_added: '2023-01-02T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 654321,
							title: "Sgt. Pepper's Lonely Hearts Club Band",
							year: 1967,
							artists: [{ name: 'The Beatles', id: 1 }],
							genres: ['Rock'],
							styles: ['Psychedelic Rock'],
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'Parlophone', catno: 'CDP 7 46442 2' }],
							resource_url: 'https://api.discogs.com/releases/654321',
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			const response = await handleMethod(
				{
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'search_collection',
						arguments: { query: '654321', per_page: 25 },
					},
					id: 2,
				},
				await createMockAuthenticatedRequest(),
				mockJwtSecret,
			)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Found 1 results for "654321"'),
						},
					],
				},
			})

			// Verify the response includes the specific release ID and genres/styles
			const result = response?.result as { content: Array<{ type: string; text: string }> }
			const responseText = result.content[0].text
			expect(responseText).toContain('[ID: 654321]')
			expect(responseText).toContain("Sgt. Pepper's Lonely Hearts Club Band")
			expect(responseText).toContain('(1967)')
			expect(responseText).toContain('Genre: Rock')
			expect(responseText).toContain('Styles: Psychedelic Rock')
			expect(responseText).toContain('⭐5')

			expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token', 'test-secret', '', '')
			expect(mockDiscogsClient.searchCollection).toHaveBeenCalledWith(
				'testuser',
				'test-token',
				'test-secret',
				{
					query: '654321',
					per_page: 25,
				},
				'',
				'',
			)
		})

		it('should handle temporal search query "rock vinyl recent"', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			const mockSearchResults = {
				pagination: { pages: 1, page: 1, per_page: 50, items: 2, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-12-01T00:00:00-08:00', // Most recent
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Recent Rock Album',
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
					{
						id: 2,
						instance_id: 2,
						date_added: '2023-01-01T00:00:00-08:00', // Older
						rating: 4,
						basic_information: {
							id: 2,
							title: 'Classic Rock Album',
							year: 1975,
							artists: [{ name: 'Classic Artist', id: 2 }],
							genres: ['Rock'],
							styles: ['Classic Rock'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Classic Label', catno: 'CLASSIC001' }],
							resource_url: 'https://api.discogs.com/releases/2',
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

			// Send initialized notification
			await handleMethod({
				jsonrpc: '2.0',
				method: 'initialized',
			})

			// Test the exact query that was failing: "rock vinyl recent"
			const response = await handleMethod(
				{
					jsonrpc: '2.0',
					method: 'tools/call',
					params: {
						name: 'search_collection',
						arguments: { query: 'rock vinyl recent', per_page: 25 },
					},
					id: 2,
				},
				await createMockAuthenticatedRequest(),
				mockJwtSecret,
			)

			expect(response).toMatchObject({
				jsonrpc: '2.0',
				id: 2,
				result: {
					content: [
						{
							type: 'text',
							text: expect.stringContaining('Found 2 results for "rock vinyl recent"'),
						},
					],
				},
			})

			// Verify the response includes temporal search strategy explanation
			const result = response?.result as { content: Array<{ type: string; text: string }> }
			const responseText = result.content[0].text
			expect(responseText).toContain('Search Strategy:')
			expect(responseText).toContain('recent')
			expect(responseText).toContain('most recently added')
			expect(responseText).toContain('Recent Rock Album') // Should show the more recent one first
			expect(responseText).toContain('Genre: Rock')
			expect(responseText).toContain('Format: Vinyl')
			expect(responseText).toContain('[ID: 1]')
			expect(responseText).toContain('[ID: 2]')

			expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token', 'test-secret', '', '')
			expect(mockDiscogsClient.searchCollection).toHaveBeenCalledWith(
				'testuser',
				'test-token',
				'test-secret',
				{
					query: 'rock vinyl recent',
					per_page: 25,
				},
				'',
				'',
			)
		})
	})
})
