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
      consumerSecret: 'test-secret-key'
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
        mockAuth.consumerSecret
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
        mockAuth.consumerSecret
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
        mockAuth.consumerSecret
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
        mockAuth.consumerSecret
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
        mockAuth.consumerSecret
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
        mockAuth.consumerSecret
      )

      expect(result.releases).toHaveLength(1)
      expect(result.releases[0].basic_information.artists[0].name).toBe('The Beatles')
    })
  })
}) 