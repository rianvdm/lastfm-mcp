/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="webworker" />

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

// Generate a random nonce
function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// Get current timestamp
function getTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString()
}

// Percent encode according to RFC 3986
function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

export class DiscogsAuth {
  private consumerKey: string
  private consumerSecret: string
  private requestTokenUrl = 'https://api.discogs.com/oauth/request_token'
  private accessTokenUrl = 'https://api.discogs.com/oauth/access_token'
  private authorizeUrl = 'https://discogs.com/oauth/authorize'

  constructor(consumerKey: string, consumerSecret: string) {
    this.consumerKey = consumerKey
    this.consumerSecret = consumerSecret
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
   * Create OAuth signature base string
   */
  private createSignatureBaseString(
    method: string,
    url: string,
    parameters: Record<string, string>
  ): string {
    // Sort parameters by key
    const sortedParams = Object.keys(parameters)
      .sort()
      .map(key => `${percentEncode(key)}=${percentEncode(parameters[key])}`)
      .join('&')

    return `${method}&${percentEncode(url)}&${percentEncode(sortedParams)}`
  }

  /**
   * Create OAuth signing key
   */
  private createSigningKey(tokenSecret?: string): string {
    return `${percentEncode(this.consumerSecret)}&${percentEncode(tokenSecret || '')}`
  }

  /**
   * Generate OAuth authorization header
   */
  private async generateOAuthHeader(
    method: string,
    url: string,
    additionalParams: Record<string, string> = {},
    token?: { key: string; secret: string }
  ): Promise<string> {
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: generateNonce(),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: getTimestamp(),
      oauth_version: '1.0',
      ...additionalParams
    }

    if (token) {
      oauthParams.oauth_token = token.key
    }

    // Create signature base string
    const allParams = { ...oauthParams }
    const baseString = this.createSignatureBaseString(method, url, allParams)
    
    // Create signing key
    const signingKey = this.createSigningKey(token?.secret)
    
    // Generate signature
    const signature = await this.computeSignature(baseString, signingKey)
    oauthParams.oauth_signature = signature

    console.log('OAuth signature base string:', baseString)
    console.log('OAuth signing key:', signingKey)
    console.log('OAuth signature:', signature)

    // Create authorization header
    const authParams = Object.keys(oauthParams)
      .map(key => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
      .join(', ')

    return `OAuth ${authParams}`
  }

  /**
   * Get a request token from Discogs
   * @param callbackUrl The URL to redirect to after authorization
   * @returns Request token and secret
   */
  async getRequestToken(callbackUrl: string): Promise<DiscogsTokenResponse> {
    console.log('Getting OAuth header for request token...')
    
    const authHeader = await this.generateOAuthHeader(
      'GET',
      this.requestTokenUrl,
      { oauth_callback: callbackUrl }
    )

    console.log('Authorization header:', authHeader)
    console.log('Making request to:', this.requestTokenUrl)

    const response = await fetch(this.requestTokenUrl, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'User-Agent': 'discogs-mcp/1.0.0',
      },
    })

    console.log('Response status:', response.status, response.statusText)

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Discogs API error response:', errorText)
      throw new Error(`Failed to get request token: ${response.status} ${response.statusText}. Response: ${errorText}`)
    }

    const text = await response.text()
    console.log('Discogs response:', text)
    
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

    const authHeader = await this.generateOAuthHeader(
      'POST',
      this.accessTokenUrl,
      { oauth_verifier: oauthVerifier },
      token
    )

    const response = await fetch(this.accessTokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'discogs-mcp/1.0.0',
      },
      body: `oauth_verifier=${encodeURIComponent(oauthVerifier)}`,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Discogs API error response:', errorText)
      throw new Error(`Failed to get access token: ${response.status} ${response.statusText}. Response: ${errorText}`)
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
    const authHeader = await this.generateOAuthHeader(method, url, {}, token)
    
    return {
      'Authorization': authHeader
    }
  }
} 