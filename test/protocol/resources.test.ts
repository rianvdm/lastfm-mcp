import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleResourcesList, handleResourcesRead } from '../../src/protocol/handlers'
import { discogsClient } from '../../src/clients/discogs'

// Mock the Discogs client
vi.mock('../../src/clients/discogs', () => ({
	discogsClient: {
		getUserProfile: vi.fn(),
		searchCollection: vi.fn(),
		getRelease: vi.fn(),
	},
}))

const mockDiscogsClient = vi.mocked(discogsClient)

describe('MCP Resources', () => {
	describe('handleResourcesList', () => {
		it('should return list of available resources', () => {
			const result = handleResourcesList()

			expect(result).toHaveProperty('resources')
			expect(Array.isArray(result.resources)).toBe(true)
			expect(result.resources).toHaveLength(3)

			// Check collection resource
			const collectionResource = result.resources.find(r => r.uri === 'discogs://collection')
			expect(collectionResource).toBeDefined()
			expect(collectionResource?.name).toBe('User Collection')
			expect(collectionResource?.description).toContain('Complete Discogs collection')
			expect(collectionResource?.mimeType).toBe('application/json')

			// Check release resource
			const releaseResource = result.resources.find(r => r.uri === 'discogs://release/{id}')
			expect(releaseResource).toBeDefined()
			expect(releaseResource?.name).toBe('Release Details')
			expect(releaseResource?.description).toContain('specific Discogs release')
			expect(releaseResource?.mimeType).toBe('application/json')

			// Check search resource
			const searchResource = result.resources.find(r => r.uri === 'discogs://search?q={query}')
			expect(searchResource).toBeDefined()
			expect(searchResource?.name).toBe('Collection Search')
			expect(searchResource?.description).toContain('Search results')
			expect(searchResource?.mimeType).toBe('application/json')
		})

		it('should return resources with proper URI schemes', () => {
			const result = handleResourcesList()

			result.resources.forEach(resource => {
				expect(resource.uri).toMatch(/^discogs:\/\//)
				expect(resource.name).toBeTruthy()
				expect(resource.mimeType).toBe('application/json')
			})
		})
	})

	describe('handleResourcesRead', () => {
		const mockSession = {
			userId: 'test-user',
			accessToken: 'test-token',
			accessTokenSecret: 'test-secret',
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 3600,
		}

		beforeEach(() => {
			vi.clearAllMocks()
		})

		it('should read collection resource', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			const mockCollection = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 2, urls: {} },
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
			mockDiscogsClient.searchCollection.mockResolvedValue(mockCollection)

			const result = await handleResourcesRead({ uri: 'discogs://collection' }, mockSession)

			expect(result.contents).toHaveLength(1)
			expect(result.contents[0].uri).toBe('discogs://collection')
			expect(result.contents[0].mimeType).toBe('application/json')
			expect(result.contents[0].text).toBeDefined()

			const parsedContent = JSON.parse(result.contents[0].text!)
			expect(parsedContent).toEqual(mockCollection)

					expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token', 'test-secret', '', '')
		expect(mockDiscogsClient.searchCollection).toHaveBeenCalledWith('testuser', 'test-token', 'test-secret', {
			per_page: 100,
		}, '', '')
		})

		it('should read release resource', async () => {
			const mockRelease = {
				id: 123456,
				title: 'Test Release',
				artists: [{ name: 'Test Artist', id: 1 }],
				year: 2023,
				genres: ['Rock'],
				styles: ['Alternative'],
				formats: [{ name: 'Vinyl', qty: '1' }],
				tracklist: [
					{ position: 'A1', title: 'Track 1' },
					{ position: 'A2', title: 'Track 2' },
				],
				labels: [{ name: 'Test Label', catno: 'TEST001' }],
				resource_url: 'https://api.discogs.com/releases/123456',
				uri: 'https://www.discogs.com/release/123456',
				data_quality: 'Needs Vote',
			}

			mockDiscogsClient.getRelease.mockResolvedValue(mockRelease)

			const result = await handleResourcesRead({ uri: 'discogs://release/123456' }, mockSession)

			expect(result.contents).toHaveLength(1)
			expect(result.contents[0].uri).toBe('discogs://release/123456')
			expect(result.contents[0].mimeType).toBe('application/json')

			const parsedContent = JSON.parse(result.contents[0].text!)
			expect(parsedContent).toEqual(mockRelease)

			expect(mockDiscogsClient.getRelease).toHaveBeenCalledWith('123456', 'test-token', 'test-secret')
		})

		it('should read search resource', async () => {
			const mockUserProfile = { username: 'testuser', id: 123 }
			const mockSearchResults = {
				pagination: { pages: 1, page: 1, per_page: 50, items: 1, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Searched Album',
							year: 2023,
							artists: [{ name: 'Search Artist', id: 1 }],
							genres: ['Rock'],
							styles: ['Alternative'],
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'Search Label', catno: 'SEARCH001' }],
							resource_url: 'https://api.discogs.com/releases/1',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockDiscogsClient.getUserProfile.mockResolvedValue(mockUserProfile)
			mockDiscogsClient.searchCollection.mockResolvedValue(mockSearchResults)

			const result = await handleResourcesRead({ uri: 'discogs://search?q=rock' }, mockSession)

			expect(result.contents).toHaveLength(1)
			expect(result.contents[0].uri).toBe('discogs://search?q=rock')
			expect(result.contents[0].mimeType).toBe('application/json')

			const parsedContent = JSON.parse(result.contents[0].text!)
			expect(parsedContent).toEqual(mockSearchResults)

					expect(mockDiscogsClient.getUserProfile).toHaveBeenCalledWith('test-token', 'test-secret', '', '')
		expect(mockDiscogsClient.searchCollection).toHaveBeenCalledWith('testuser', 'test-token', 'test-secret', {
			query: 'rock',
			per_page: 50,
		}, '', '')
		})

		it('should throw error for invalid params', async () => {
			await expect(handleResourcesRead({}, mockSession)).rejects.toThrow('Invalid params')
			await expect(handleResourcesRead({ uri: null }, mockSession)).rejects.toThrow('Invalid params')
		})

		it('should throw error for invalid release URI', async () => {
			await expect(handleResourcesRead({ uri: 'discogs://release/' }, mockSession)).rejects.toThrow('Invalid release URI')
			await expect(handleResourcesRead({ uri: 'discogs://release/{id}' }, mockSession)).rejects.toThrow('Invalid release URI')
		})

		it('should throw error for invalid search URI', async () => {
			await expect(handleResourcesRead({ uri: 'discogs://search' }, mockSession)).rejects.toThrow('Unsupported resource URI')
			await expect(handleResourcesRead({ uri: 'discogs://search?q=' }, mockSession)).rejects.toThrow('Invalid search URI')
		})

		it('should throw error for unsupported URI', async () => {
			await expect(handleResourcesRead({ uri: 'discogs://unknown' }, mockSession)).rejects.toThrow('Unsupported resource URI')
		})

		it('should handle Discogs API errors', async () => {
			mockDiscogsClient.getUserProfile.mockRejectedValue(new Error('API Error'))

			await expect(handleResourcesRead({ uri: 'discogs://collection' }, mockSession)).rejects.toThrow('Failed to read resource: API Error')
		})
	})
}) 