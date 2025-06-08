// Discogs API client for interacting with user collections and releases

export interface DiscogsRelease {
  id: number
  title: string
  artists: Array<{
    name: string
    id: number
  }>
  year?: number
  formats: Array<{
    name: string
    qty: string
    descriptions?: string[]
  }>
  genres: string[]
  styles: string[]
  tracklist: Array<{
    position: string
    title: string
    duration?: string
  }>
  labels: Array<{
    name: string
    catno: string
  }>
  images?: Array<{
    type: string
    uri: string
    width: number
    height: number
  }>
  master_id?: number
  master_url?: string
  resource_url: string
  uri: string
  country?: string
  released?: string
  notes?: string
  data_quality: string
}

export interface DiscogsCollectionItem {
  id: number
  instance_id: number
  date_added: string
  rating: number
  basic_information: {
    id: number
    title: string
    year: number
    resource_url: string
    thumb: string
    cover_image: string
    formats: Array<{
      name: string
      qty: string
      descriptions?: string[]
    }>
    labels: Array<{
      name: string
      catno: string
    }>
    artists: Array<{
      name: string
      id: number
    }>
    genres: string[]
    styles: string[]
  }
}

export interface DiscogsCollectionResponse {
  pagination: {
    pages: number
    page: number
    per_page: number
    items: number
    urls: {
      last?: string
      next?: string
    }
  }
  releases: DiscogsCollectionItem[]
}

export interface DiscogsSearchResponse {
  pagination: {
    pages: number
    page: number
    per_page: number
    items: number
    urls: {
      last?: string
      next?: string
    }
  }
  results: Array<{
    id: number
    type: string
    title: string
    year?: number
    format: string[]
    label: string[]
    genre: string[]
    style: string[]
    country?: string
    thumb: string
    cover_image: string
    resource_url: string
    master_id?: number
    master_url?: string
  }>
}

export interface DiscogsCollectionStats {
  totalReleases: number
  totalValue: number
  genreBreakdown: Record<string, number>
  decadeBreakdown: Record<string, number>
  formatBreakdown: Record<string, number>
  labelBreakdown: Record<string, number>
  averageRating: number
  ratedReleases: number
}

export class DiscogsClient {
  private baseUrl = 'https://api.discogs.com'
  private userAgent = 'discogs-mcp/1.0.0'

  /**
   * Get detailed information about a specific release
   */
  async getRelease(releaseId: string, token: string): Promise<DiscogsRelease> {
    const response = await fetch(`${this.baseUrl}/releases/${releaseId}`, {
      headers: {
        'Authorization': `Discogs token=${token}`,
        'User-Agent': this.userAgent,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch release ${releaseId}: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Search user's collection
   */
  async searchCollection(
    username: string,
    token: string,
    options: {
      query?: string
      page?: number
      per_page?: number
      sort?: 'added' | 'artist' | 'title' | 'year'
      sort_order?: 'asc' | 'desc'
    } = {}
  ): Promise<DiscogsCollectionResponse> {
    const params = new URLSearchParams()
    
    if (options.query) params.append('q', options.query)
    if (options.page) params.append('page', options.page.toString())
    if (options.per_page) params.append('per_page', options.per_page.toString())
    if (options.sort) params.append('sort', options.sort)
    if (options.sort_order) params.append('sort_order', options.sort_order)

    const url = `${this.baseUrl}/users/${username}/collection/folders/0/releases?${params.toString()}`
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Discogs token=${token}`,
        'User-Agent': this.userAgent,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to search collection: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Get user's collection statistics
   */
  async getCollectionStats(username: string, token: string): Promise<DiscogsCollectionStats> {
    // Get all collection items (we'll need to paginate through all pages)
    let allReleases: DiscogsCollectionItem[] = []
    let page = 1
    let totalPages = 1

    do {
      const response = await this.searchCollection(username, token, {
        page,
        per_page: 100, // Max per page
      })
      
      allReleases = allReleases.concat(response.releases)
      totalPages = response.pagination.pages
      page++
    } while (page <= totalPages)

    // Calculate statistics
    const stats: DiscogsCollectionStats = {
      totalReleases: allReleases.length,
      totalValue: 0, // Discogs doesn't provide value in collection endpoint
      genreBreakdown: {},
      decadeBreakdown: {},
      formatBreakdown: {},
      labelBreakdown: {},
      averageRating: 0,
      ratedReleases: 0,
    }

    let totalRating = 0
    let ratedCount = 0

    for (const item of allReleases) {
      const release = item.basic_information

      // Genre breakdown
      for (const genre of release.genres || []) {
        stats.genreBreakdown[genre] = (stats.genreBreakdown[genre] || 0) + 1
      }

      // Decade breakdown
      if (release.year) {
        const decade = `${Math.floor(release.year / 10) * 10}s`
        stats.decadeBreakdown[decade] = (stats.decadeBreakdown[decade] || 0) + 1
      }

      // Format breakdown
      for (const format of release.formats || []) {
        stats.formatBreakdown[format.name] = (stats.formatBreakdown[format.name] || 0) + 1
      }

      // Label breakdown
      for (const label of release.labels || []) {
        stats.labelBreakdown[label.name] = (stats.labelBreakdown[label.name] || 0) + 1
      }

      // Rating calculation
      if (item.rating > 0) {
        totalRating += item.rating
        ratedCount++
      }
    }

    stats.averageRating = ratedCount > 0 ? totalRating / ratedCount : 0
    stats.ratedReleases = ratedCount

    return stats
  }

  /**
   * Get user profile to extract username
   */
  async getUserProfile(token: string): Promise<{ username: string; id: number }> {
    const response = await fetch(`${this.baseUrl}/oauth/identity`, {
      headers: {
        'Authorization': `Discogs token=${token}`,
        'User-Agent': this.userAgent,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to get user profile: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  /**
   * Search Discogs database (not user's collection)
   */
  async searchDatabase(
    query: string,
    token: string,
    options: {
      type?: 'release' | 'master' | 'artist' | 'label'
      page?: number
      per_page?: number
    } = {}
  ): Promise<DiscogsSearchResponse> {
    const params = new URLSearchParams()
    params.append('q', query)
    
    if (options.type) params.append('type', options.type)
    if (options.page) params.append('page', options.page.toString())
    if (options.per_page) params.append('per_page', options.per_page.toString())

    const response = await fetch(`${this.baseUrl}/database/search?${params.toString()}`, {
      headers: {
        'Authorization': `Discogs token=${token}`,
        'User-Agent': this.userAgent,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to search database: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }
}

// Export singleton instance
export const discogsClient = new DiscogsClient() 