/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="webworker" />

import OAuth from 'oauth-1.0a'

interface DiscogsTokenResponse {
  oauth_token: string
  oauth_token_secret: string
  oauth_callback_confirmed?: string
}

interface DiscogsAccessTokenResponse {
  oauth_token: string
  oauth_token_secret: string
}

// Helper function to convert ArrayBuffer to base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export class DiscogsAuth {
  private oauth: OAuth
  private consumerKey: string
  private consumerSecret: string
  private requestTokenUrl = 'https://api.discogs.com/oauth/request_token'
  private accessTokenUrl = 'https://api.discogs.com/oauth/access_token'
  private authorizeUrl = 'https://discogs.com/oauth/authorize'

  constructor(consumerKey: string, consumerSecret: string) {
    this.consumerKey = consumerKey
    this.consumerSecret = consumerSecret
    
    // Since oauth-1.0a expects a synchronous hash function, we'll use a workaround
    // by pre-computing the signature in our methods
    this.oauth = new OAuth({
      consumer: {
        key: consumerKey,
        secret: consumerSecret,
      },
      signature_method: 'HMAC-SHA1',
      hash_function(_base_string: string, _key: string) {
        // This is a placeholder - we'll compute the actual signature asynchronously
        // and replace it in the authorization header
        return 'PLACEHOLDER_SIGNATURE'
      },
    })
  }

  /**
   * Compute HMAC-SHA1 signature using Web Crypto API
   */
  private async computeSignature(baseString: string, key: string): Promise<string> {
    const encoder = new TextEncoder()
    const keyData = encoder.encode(key)
    const messageData = encoder.encode(baseString)
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
    return arrayBufferToBase64(signature)
  }

  /**
   * Get OAuth authorization header with proper signature
   */
  private async getOAuthHeader(requestData: { url: string; method: string; data?: Record<string, string> }, token?: { key: string; secret: string }): Promise<Record<string, string>> {
    // Get the OAuth data (with placeholder signature)
    const oauthData = this.oauth.authorize(requestData, token)
    
    // Compute the actual signature
    const baseString = this.oauth.getBaseString(requestData, oauthData)
    const signingKey = this.oauth.getSigningKey(token?.secret)
    const signature = await this.computeSignature(baseString, signingKey)
    
    // Replace the placeholder signature
    oauthData.oauth_signature = signature
    
    // Convert to header
    const header = this.oauth.toHeader(oauthData)
    return header as unknown as Record<string, string>
  }

  /**
   * Get a request token from Discogs
   * @param callbackUrl The URL to redirect to after authorization
   * @returns Request token and secret
   */
  async getRequestToken(callbackUrl: string): Promise<DiscogsTokenResponse> {
    const requestData = {
      url: this.requestTokenUrl,
      method: 'GET',
      data: {
        oauth_callback: callbackUrl,
      },
    }

    const headers = await this.getOAuthHeader(requestData)

    const response = await fetch(this.requestTokenUrl + '?oauth_callback=' + encodeURIComponent(callbackUrl), {
      method: 'GET',
      headers: {
        ...headers,
        'User-Agent': 'discogs-mcp/1.0.0',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to get request token: ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    const params = new URLSearchParams(text)
    
    const oauthToken = params.get('oauth_token')
    const oauthTokenSecret = params.get('oauth_token_secret')
    const oauthCallbackConfirmed = params.get('oauth_callback_confirmed')

    if (!oauthToken || !oauthTokenSecret) {
      throw new Error('Invalid response from Discogs: missing oauth_token or oauth_token_secret')
    }

    return {
      oauth_token: oauthToken,
      oauth_token_secret: oauthTokenSecret,
      oauth_callback_confirmed: oauthCallbackConfirmed || undefined,
    }
  }

  /**
   * Get the authorization URL for the user to visit
   * @param oauthToken The request token
   * @returns The authorization URL
   */
  getAuthorizeUrl(oauthToken: string): string {
    return `${this.authorizeUrl}?oauth_token=${oauthToken}`
  }

  /**
   * Exchange request token and verifier for access token
   * @param oauthToken The request token
   * @param oauthTokenSecret The request token secret
   * @param oauthVerifier The verification code from the callback
   * @returns Access token and secret
   */
  async getAccessToken(
    oauthToken: string,
    oauthTokenSecret: string,
    oauthVerifier: string
  ): Promise<DiscogsAccessTokenResponse> {
    const token = {
      key: oauthToken,
      secret: oauthTokenSecret,
    }

    const requestData = {
      url: this.accessTokenUrl,
      method: 'POST',
      data: {
        oauth_verifier: oauthVerifier,
      },
    }

    const headers = await this.getOAuthHeader(requestData, token)

    const response = await fetch(this.accessTokenUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'discogs-mcp/1.0.0',
      },
      body: `oauth_verifier=${encodeURIComponent(oauthVerifier)}`,
    })

    if (!response.ok) {
      throw new Error(`Failed to get access token: ${response.status} ${response.statusText}`)
    }

    const text = await response.text()
    const params = new URLSearchParams(text)
    
    const accessToken = params.get('oauth_token')
    const accessTokenSecret = params.get('oauth_token_secret')

    if (!accessToken || !accessTokenSecret) {
      throw new Error('Invalid response from Discogs: missing oauth_token or oauth_token_secret')
    }

    return {
      oauth_token: accessToken,
      oauth_token_secret: accessTokenSecret,
    }
  }

  /**
   * Create OAuth headers for authenticated requests
   * @param url The request URL
   * @param method The HTTP method
   * @param token The access token
   * @returns OAuth headers
   */
  async getAuthHeaders(
    url: string,
    method: string,
    token: { key: string; secret: string }
  ): Promise<Record<string, string>> {
    const requestData = {
      url,
      method,
    }

    return await this.getOAuthHeader(requestData, token)
  }
} 