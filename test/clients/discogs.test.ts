import { describe, it, expect, vi, beforeEach } from 'vitest'
import { discogsClient } from '../../src/clients/discogs'

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('Discogs Client', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('searchCollection', () => {
		const mockAuth = {
			username: 'testuser',
			accessToken: 'test-token',
			accessTokenSecret: 'test-secret',
			consumerKey: 'test-key',
			consumerSecret: 'test-secret-key',
		}

		it('should return all items when no query is provided', async () => {
			const mockResponse = {
				pagination: { pages: 1, page: 1, per_page: 50, items: 2, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Abbey Road',
							year: 1969,
							artists: [{ name: 'The Beatles', id: 1 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Apple Records', catno: 'PCS 7088' }],
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
							title: 'Kind of Blue',
							year: 1959,
							artists: [{ name: 'Miles Davis', id: 2 }],
							genres: ['Jazz'],
							styles: ['Modal'],
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'Columbia', catno: 'CL 1355' }],
							resource_url: 'https://api.discogs.com/releases/2',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			const result = await discogsClient.searchCollection(
				mockAuth.username,
				mockAuth.accessToken,
				mockAuth.accessTokenSecret,
				{ per_page: 50 },
				mockAuth.consumerKey,
				mockAuth.consumerSecret,
			)

			expect(result.releases).toHaveLength(2)
			expect(result.releases[0].basic_information.title).toBe('Abbey Road')
			expect(result.releases[1].basic_information.title).toBe('Kind of Blue')
		})

		it('should filter by artist name when query is provided', async () => {
			const mockResponse = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 2, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Abbey Road',
							year: 1969,
							artists: [{ name: 'The Beatles', id: 1 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Apple Records', catno: 'PCS 7088' }],
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
							title: 'Kind of Blue',
							year: 1959,
							artists: [{ name: 'Miles Davis', id: 2 }],
							genres: ['Jazz'],
							styles: ['Modal'],
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'Columbia', catno: 'CL 1355' }],
							resource_url: 'https://api.discogs.com/releases/2',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			const result = await discogsClient.searchCollection(
				mockAuth.username,
				mockAuth.accessToken,
				mockAuth.accessTokenSecret,
				{ query: 'Beatles', per_page: 50 },
				mockAuth.consumerKey,
				mockAuth.consumerSecret,
			)

			expect(result.releases).toHaveLength(1)
			expect(result.releases[0].basic_information.title).toBe('Abbey Road')
			expect(result.releases[0].basic_information.artists[0].name).toBe('The Beatles')
			expect(result.pagination.items).toBe(1)
		})

		it('should filter by album title when query is provided', async () => {
			const mockResponse = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 2, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Abbey Road',
							year: 1969,
							artists: [{ name: 'The Beatles', id: 1 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Apple Records', catno: 'PCS 7088' }],
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
							title: 'Kind of Blue',
							year: 1959,
							artists: [{ name: 'Miles Davis', id: 2 }],
							genres: ['Jazz'],
							styles: ['Modal'],
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'Columbia', catno: 'CL 1355' }],
							resource_url: 'https://api.discogs.com/releases/2',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			const result = await discogsClient.searchCollection(
				mockAuth.username,
				mockAuth.accessToken,
				mockAuth.accessTokenSecret,
				{ query: 'blue', per_page: 50 },
				mockAuth.consumerKey,
				mockAuth.consumerSecret,
			)

			expect(result.releases).toHaveLength(1)
			expect(result.releases[0].basic_information.title).toBe('Kind of Blue')
			expect(result.pagination.items).toBe(1)
		})

		it('should filter by genre when query is provided', async () => {
			const mockResponse = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 2, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Abbey Road',
							year: 1969,
							artists: [{ name: 'The Beatles', id: 1 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Apple Records', catno: 'PCS 7088' }],
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
							title: 'Kind of Blue',
							year: 1959,
							artists: [{ name: 'Miles Davis', id: 2 }],
							genres: ['Jazz'],
							styles: ['Modal'],
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'Columbia', catno: 'CL 1355' }],
							resource_url: 'https://api.discogs.com/releases/2',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			const result = await discogsClient.searchCollection(
				mockAuth.username,
				mockAuth.accessToken,
				mockAuth.accessTokenSecret,
				{ query: 'jazz', per_page: 50 },
				mockAuth.consumerKey,
				mockAuth.consumerSecret,
			)

			expect(result.releases).toHaveLength(1)
			expect(result.releases[0].basic_information.title).toBe('Kind of Blue')
			expect(result.releases[0].basic_information.genres).toContain('Jazz')
			expect(result.pagination.items).toBe(1)
		})

		it('should return empty results when no matches found', async () => {
			const mockResponse = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 2, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Abbey Road',
							year: 1969,
							artists: [{ name: 'The Beatles', id: 1 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Apple Records', catno: 'PCS 7088' }],
							resource_url: 'https://api.discogs.com/releases/1',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			const result = await discogsClient.searchCollection(
				mockAuth.username,
				mockAuth.accessToken,
				mockAuth.accessTokenSecret,
				{ query: 'nonexistent', per_page: 50 },
				mockAuth.consumerKey,
				mockAuth.consumerSecret,
			)

			expect(result.releases).toHaveLength(0)
			expect(result.pagination.items).toBe(0)
			expect(result.pagination.pages).toBe(0)
		})

		it('should handle case-insensitive search', async () => {
			const mockResponse = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 1, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Abbey Road',
							year: 1969,
							artists: [{ name: 'The Beatles', id: 1 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Apple Records', catno: 'PCS 7088' }],
							resource_url: 'https://api.discogs.com/releases/1',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			const result = await discogsClient.searchCollection(
				mockAuth.username,
				mockAuth.accessToken,
				mockAuth.accessTokenSecret,
				{ query: 'BEATLES', per_page: 50 },
				mockAuth.consumerKey,
				mockAuth.consumerSecret,
			)

			expect(result.releases).toHaveLength(1)
			expect(result.releases[0].basic_information.artists[0].name).toBe('The Beatles')
		})

		it('should find releases with multi-word queries like "Miles Davis Kind of Blue"', async () => {
			const mockResponse = {
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
							styles: ['Modal'],
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
							title: 'Abbey Road',
							year: 1969,
							artists: [{ name: 'The Beatles', id: 2 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'Apple Records', catno: 'PCS 7088' }],
							resource_url: 'https://api.discogs.com/releases/2',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			// Search for "Miles Davis Kind of Blue" - should match the first release
			// because ALL terms ("Miles", "Davis", "Kind", "Blue") are found in the searchable text
			const result = await discogsClient.searchCollection(
				mockAuth.username,
				mockAuth.accessToken,
				mockAuth.accessTokenSecret,
				{ query: 'Miles Davis Kind of Blue', per_page: 50 },
				mockAuth.consumerKey,
				mockAuth.consumerSecret,
			)

			expect(result.releases).toHaveLength(1)
			expect(result.releases[0].basic_information.artists[0].name).toBe('Miles Davis')
			expect(result.releases[0].basic_information.title).toBe('Kind of Blue')
			expect(result.pagination.items).toBe(1)
		})

		it('should handle decade queries like "1960s" matching years in that decade', async () => {
			const mockResponse = {
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
							styles: ['Modal'],
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
							title: 'Abbey Road',
							year: 1969,
							artists: [{ name: 'The Beatles', id: 2 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'Apple Records', catno: 'PCS 7088' }],
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
							title: 'Pet Sounds',
							year: 1966,
							artists: [{ name: 'The Beach Boys', id: 3 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Capitol', catno: 'T 2458' }],
							resource_url: 'https://api.discogs.com/releases/3',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			// Search for "1960s" - should match releases from 1966 and 1969, but not 1959
			const result = await discogsClient.searchCollection(
				mockAuth.username,
				mockAuth.accessToken,
				mockAuth.accessTokenSecret,
				{ query: '1960s', per_page: 50 },
				mockAuth.consumerKey,
				mockAuth.consumerSecret,
			)

			expect(result.releases).toHaveLength(2)
			expect(result.releases.map((r) => r.basic_information.year)).toEqual(expect.arrayContaining([1969, 1966]))
			expect(result.pagination.items).toBe(2)
		})

		it('should handle multiple decades with OR logic (1960s OR 1970s)', async () => {
			const mockResponse = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 4, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'Pet Sounds',
							year: 1966,
							artists: [{ name: 'The Beach Boys', id: 1 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Capitol', catno: 'T 2458' }],
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
							title: 'Dark Side of the Moon',
							year: 1973,
							artists: [{ name: 'Pink Floyd', id: 2 }],
							genres: ['Rock'],
							styles: ['Prog Rock'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Harvest', catno: 'SHVL 804' }],
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
							title: 'Never Mind the Bollocks',
							year: 1977,
							artists: [{ name: 'Sex Pistols', id: 3 }],
							genres: ['Rock'],
							styles: ['Punk'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Virgin', catno: 'V 2086' }],
							resource_url: 'https://api.discogs.com/releases/3',
							thumb: '',
							cover_image: '',
						},
					},
					{
						id: 4,
						instance_id: 4,
						date_added: '2023-01-04T00:00:00-08:00',
						rating: 2,
						basic_information: {
							id: 4,
							title: 'Kind of Blue',
							year: 1959,
							artists: [{ name: 'Miles Davis', id: 4 }],
							genres: ['Jazz'],
							styles: ['Modal'],
							formats: [{ name: 'CD', qty: '1' }],
							labels: [{ name: 'Columbia', catno: 'CL 1355' }],
							resource_url: 'https://api.discogs.com/releases/4',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			// Search for "1960s 1970s vinyl" - should match vinyl releases from either decade
			const result = await discogsClient.searchCollection(
				mockAuth.username,
				mockAuth.accessToken,
				mockAuth.accessTokenSecret,
				{ query: '1960s 1970s vinyl', per_page: 50 },
				mockAuth.consumerKey,
				mockAuth.consumerSecret,
			)

			expect(result.releases).toHaveLength(3) // 1966, 1973, 1977 vinyl releases
			expect(result.releases.map((r) => r.basic_information.year)).toEqual(expect.arrayContaining([1966, 1973, 1977]))
			// Should not include 1959 (not in 1960s/1970s) or any CD formats
			expect(result.releases.every((r) => r.basic_information.formats.some((f) => f.name === 'Vinyl'))).toBe(true)
			expect(result.pagination.items).toBe(3)
		})

		it('should handle complex style and decade queries like "post-bop 1960s 1970s vinyl"', async () => {
			const mockResponse = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 4, urls: {} },
				releases: [
					{
						id: 1,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 1,
							title: 'The Sidewinder',
							year: 1963,
							artists: [{ name: 'Lee Morgan', id: 1 }],
							genres: ['Jazz'],
							styles: ['Hard Bop', 'Post-Bop'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Blue Note', catno: 'BLP 4157' }],
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
							title: 'Speak No Evil',
							year: 1971,
							artists: [{ name: 'Wayne Shorter', id: 2 }],
							genres: ['Jazz'],
							styles: ['Post-Bop', 'Modal'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Blue Note', catno: 'BST 84194' }],
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
							title: 'Bitches Brew',
							year: 1969,
							artists: [{ name: 'Miles Davis', id: 3 }],
							genres: ['Jazz'],
							styles: ['Jazz-Rock', 'Fusion'],
							formats: [{ name: 'CD', qty: '2' }],
							labels: [{ name: 'Columbia', catno: 'CS 9995' }],
							resource_url: 'https://api.discogs.com/releases/3',
							thumb: '',
							cover_image: '',
						},
					},
					{
						id: 4,
						instance_id: 4,
						date_added: '2023-01-04T00:00:00-08:00',
						rating: 2,
						basic_information: {
							id: 4,
							title: 'A Love Supreme',
							year: 1965,
							artists: [{ name: 'John Coltrane', id: 4 }],
							genres: ['Jazz'],
							styles: ['Post-Bop', 'Spiritual Jazz'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Impulse!', catno: 'A-77' }],
							resource_url: 'https://api.discogs.com/releases/4',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			// Search for "post-bop 1960s 1970s vinyl" - should match vinyl post-bop releases from either decade
			const result = await discogsClient.searchCollection(
				mockAuth.username,
				mockAuth.accessToken,
				mockAuth.accessTokenSecret,
				{ query: 'post-bop 1960s 1970s vinyl', per_page: 50 },
				mockAuth.consumerKey,
				mockAuth.consumerSecret,
			)

			// Should match: The Sidewinder (1963, 1960s), Speak No Evil (1971, 1970s), A Love Supreme (1965, 1960s)
			// Should NOT match: Bitches Brew (no post-bop style, CD format)
			expect(result.releases).toHaveLength(3)
			expect(result.releases.map((r) => r.basic_information.title)).toEqual(
				expect.arrayContaining(['The Sidewinder', 'Speak No Evil', 'A Love Supreme']),
			)
			// All should be vinyl and have post-bop style
			expect(result.releases.every((r) => r.basic_information.formats.some((f) => f.name === 'Vinyl'))).toBe(true)
			expect(result.releases.every((r) => r.basic_information.styles?.some((s) => s.includes('Post-Bop')))).toBe(true)
			// All should be from 1960s OR 1970s
			expect(result.releases.every((r) => r.basic_information.year >= 1960 && r.basic_information.year < 1980)).toBe(true)
			expect(result.pagination.items).toBe(3)
		})

		it('should find release by specific ID 654321', async () => {
			const mockResponse = {
				pagination: { pages: 1, page: 1, per_page: 100, items: 3, urls: {} },
				releases: [
					{
						id: 123456,
						instance_id: 1,
						date_added: '2023-01-01T00:00:00-08:00',
						rating: 5,
						basic_information: {
							id: 123456,
							title: 'Abbey Road',
							year: 1969,
							artists: [{ name: 'The Beatles', id: 1 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Apple Records', catno: 'PCS 7088' }],
							resource_url: 'https://api.discogs.com/releases/123456',
							thumb: '',
							cover_image: '',
						},
					},
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
					{
						id: 789012,
						instance_id: 3,
						date_added: '2023-01-03T00:00:00-08:00',
						rating: 4,
						basic_information: {
							id: 789012,
							title: 'Revolver',
							year: 1966,
							artists: [{ name: 'The Beatles', id: 1 }],
							genres: ['Rock'],
							styles: ['Pop Rock'],
							formats: [{ name: 'Vinyl', qty: '1' }],
							labels: [{ name: 'Parlophone', catno: 'PCS 7009' }],
							resource_url: 'https://api.discogs.com/releases/789012',
							thumb: '',
							cover_image: '',
						},
					},
				],
			}

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			})

			// Search for the specific release ID
			const result = await discogsClient.searchCollection(
				mockAuth.username,
				mockAuth.accessToken,
				mockAuth.accessTokenSecret,
				{ query: '654321', per_page: 50 },
				mockAuth.consumerKey,
				mockAuth.consumerSecret,
			)

			expect(result.releases).toHaveLength(1)
			expect(result.releases[0].id).toBe(654321)
			expect(result.releases[0].basic_information.title).toBe("Sgt. Pepper's Lonely Hearts Club Band")
			expect(result.releases[0].basic_information.year).toBe(1967)
			expect(result.pagination.items).toBe(1)
		})
	})
})
