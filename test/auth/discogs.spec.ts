import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DiscogsAuth } from '../../src/auth/discogs'

// Mock fetch globally
const mockFetch = vi.fn()
;(globalThis as any).fetch = mockFetch

describe('DiscogsAuth', () => {
  let auth: DiscogsAuth
  const consumerKey = 'test-consumer-key'
  const consumerSecret = 'test-consumer-secret'

  beforeEach(() => {
    auth = new DiscogsAuth(consumerKey, consumerSecret)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getRequestToken', () => {
    it('should successfully get a request token', async () => {
      const mockResponse = 'oauth_token=test-token&oauth_token_secret=test-secret&oauth_callback_confirmed=true'
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve(mockResponse),
      })

      const result = await auth.getRequestToken('http://localhost:3000/callback')

      expect(result).toEqual({
        oauth_token: 'test-token',
        oauth_token_secret: 'test-secret',
        oauth_callback_confirmed: 'true',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.discogs.com/oauth/request_token',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('OAuth'),
            'User-Agent': 'discogs-mcp/1.0.0',
          }),
        })
      )
    })

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid consumer key'),
      })

      await expect(auth.getRequestToken('http://localhost:3000/callback')).rejects.toThrow(
        'Failed to get request token: 401 Unauthorized'
      )
    })

    it('should handle malformed responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('invalid_response'),
      })

      await expect(auth.getRequestToken('http://localhost:3000/callback')).rejects.toThrow(
        'Invalid response from Discogs: missing oauth_token or oauth_token_secret'
      )
    })
  })

  describe('getAuthorizeUrl', () => {
    it('should generate correct authorize URL', () => {
      const oauthToken = 'test-token'
      const url = auth.getAuthorizeUrl(oauthToken)
      
      expect(url).toBe('https://discogs.com/oauth/authorize?oauth_token=test-token')
    })
  })

  describe('getAccessToken', () => {
    it('should successfully exchange for access token', async () => {
      const mockResponse = 'oauth_token=access-token&oauth_token_secret=access-secret'
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve(mockResponse),
      })

      const result = await auth.getAccessToken('request-token', 'request-secret', 'verifier')

      expect(result).toEqual({
        oauth_token: 'access-token',
        oauth_token_secret: 'access-secret',
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.discogs.com/oauth/access_token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('OAuth'),
            'User-Agent': 'discogs-mcp/1.0.0',
          }),
        })
      )
    })

    it('should handle access token errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid verifier'),
      })

      await expect(
        auth.getAccessToken('request-token', 'request-secret', 'invalid-verifier')
      ).rejects.toThrow('Failed to get access token: 401 Unauthorized')
    })

    it('should handle malformed access token responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: () => Promise.resolve('invalid_response'),
      })

      await expect(
        auth.getAccessToken('request-token', 'request-secret', 'verifier')
      ).rejects.toThrow('Invalid response from Discogs: missing oauth_token or oauth_token_secret')
    })
  })

  describe('getAuthHeaders', () => {
    it('should generate correct auth headers for API requests', async () => {
      const token = { key: 'access-token', secret: 'access-secret' }
      const headers = await auth.getAuthHeaders('https://api.discogs.com/users/test', 'GET', token)

      expect(headers).toHaveProperty('Authorization')
      expect(headers.Authorization).toContain('OAuth')
      expect(headers.Authorization).toContain('oauth_consumer_key')
      expect(headers.Authorization).toContain('oauth_token')
      expect(headers.Authorization).toContain('oauth_signature')
      // Note: User-Agent is not included in getAuthHeaders, it's added separately when making requests
    })
  })

  describe('OAuth signature generation', () => {
    it('should generate consistent signatures for the same parameters', async () => {
      // Mock Date.now to return consistent timestamp
      const mockDate = new Date('2023-01-01T00:00:00Z')
      vi.spyOn(Date, 'now').mockReturnValue(mockDate.getTime())
      
      // Mock Math.random to return consistent nonce
      vi.spyOn(Math, 'random').mockReturnValue(0.5)

      const token = { key: 'test-token', secret: 'test-secret' }
      const headers1 = await auth.getAuthHeaders('https://api.discogs.com/test', 'GET', token)
      const headers2 = await auth.getAuthHeaders('https://api.discogs.com/test', 'GET', token)

      expect(headers1.Authorization).toBe(headers2.Authorization)
    })
  })
}) 