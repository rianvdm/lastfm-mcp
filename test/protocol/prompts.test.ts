/**
 * Tests for MCP Prompts functionality
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { handlePromptsList, handlePromptsGet, resetInitialization } from '../../src/protocol/handlers'

describe('MCP Prompts', () => {
	beforeEach(() => {
		resetInitialization()
	})

	describe('handlePromptsList', () => {
		it('should return all available prompts', () => {
			const result = handlePromptsList()

			expect(result).toMatchObject({
				prompts: expect.arrayContaining([
					{
						name: 'browse_collection',
						description: 'Browse and explore your Discogs music collection',
					},
					{
						name: 'find_music',
						description: 'Find specific music in your collection',
						arguments: [
							{
								name: 'query',
								description: 'Search query for finding music (artist, album, track, etc.)',
								required: true,
							},
						],
					},
					{
						name: 'collection_insights',
						description: 'Get insights and statistics about your music collection',
					},
				]),
			})

			expect(result.prompts).toHaveLength(3)
		})

		it('should handle empty params', () => {
			const result = handlePromptsList(undefined)
			expect(result.prompts).toHaveLength(3)
		})

		it('should handle valid cursor params', () => {
			const result = handlePromptsList({ cursor: 'test-cursor' })
			expect(result.prompts).toHaveLength(3)
		})

		it('should throw error for invalid params', () => {
			expect(() => handlePromptsList('invalid')).toThrow('Invalid prompts/list params')
		})
	})

	describe('handlePromptsGet', () => {
		it('should return browse_collection prompt', () => {
			const result = handlePromptsGet({ name: 'browse_collection' })

			expect(result).toMatchObject({
				description: 'Browse and explore your Discogs music collection',
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: expect.stringContaining('explore my Discogs music collection'),
						},
					},
				],
			})
		})

		it('should return find_music prompt with query', () => {
			const result = handlePromptsGet({ 
				name: 'find_music',
				arguments: { query: 'Pink Floyd' }
			})

			expect(result).toMatchObject({
				description: 'Find specific music in your collection',
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: expect.stringContaining('Pink Floyd'),
						},
					},
				],
			})
		})

		it('should return collection_insights prompt', () => {
			const result = handlePromptsGet({ name: 'collection_insights' })

			expect(result).toMatchObject({
				description: 'Get insights about your music collection',
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: expect.stringContaining('Analyze my Discogs music collection'),
						},
					},
				],
			})
		})

		it('should throw error for missing query in find_music', () => {
			expect(() => handlePromptsGet({ 
				name: 'find_music',
				arguments: {}
			})).toThrow('find_music prompt requires a query argument')
		})

		it('should throw error for unknown prompt', () => {
			expect(() => handlePromptsGet({ name: 'unknown_prompt' })).toThrow('Unknown prompt: unknown_prompt')
		})

		  it('should throw error for invalid params', () => {
    expect(() => handlePromptsGet({})).toThrow('name parameter must be a string')
    expect(() => handlePromptsGet('invalid')).toThrow('prompts/get params must be an object')
  })
	})
}) 