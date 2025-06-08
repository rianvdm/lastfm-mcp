import { describe, it, expect } from 'vitest'
import { handleResourcesList } from '../../src/protocol/handlers'

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
}) 