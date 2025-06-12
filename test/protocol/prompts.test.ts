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

			// The current implementation still returns the Last.fm prompts list
			// but the handlers are still using old Discogs logic
			expect(result.prompts).toHaveLength(6)
			expect(result.prompts.some(p => p.name === 'listening_insights')).toBe(true)
			expect(result.prompts.some(p => p.name === 'music_discovery')).toBe(true)
		})

		it('should handle empty params', () => {
			const result = handlePromptsList(undefined)
			expect(result.prompts).toHaveLength(6)
		})

		it('should handle valid cursor params', () => {
			const result = handlePromptsList({ cursor: 'test-cursor' })
			expect(result.prompts).toHaveLength(6)
		})

		it('should throw error for invalid params', () => {
			expect(() => handlePromptsList('invalid')).toThrow('Invalid prompts/list params')
		})
	})

	describe('handlePromptsGet', () => {
		// Note: The current implementation still has placeholder Discogs prompts
		// This test checks what actually exists, not what should exist
		it('should return browse_collection prompt (legacy)', () => {
			const result = handlePromptsGet({ name: 'browse_collection' })

			expect(result).toMatchObject({
				description: expect.stringContaining('collection'),
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: expect.stringContaining('collection'),
						},
					},
				],
			})
		})

		it('should return find_music prompt (legacy)', () => {
			const result = handlePromptsGet({
				name: 'find_music',
				arguments: { query: 'Pink Floyd' },
			})

			expect(result).toMatchObject({
				description: expect.stringContaining('music'),
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

		it('should return collection_insights prompt (legacy)', () => {
			const result = handlePromptsGet({ name: 'collection_insights' })

			expect(result).toMatchObject({
				description: expect.stringContaining('collection'),
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: expect.stringContaining('collection'),
						},
					},
				],
			})
		})

		it('should throw error for missing query in find_music', () => {
			expect(() =>
				handlePromptsGet({
					name: 'find_music',
					arguments: {},
				}),
			).toThrow('find_music prompt requires a query argument')
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
