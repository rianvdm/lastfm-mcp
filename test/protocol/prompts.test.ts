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

			// The current implementation returns the Last.fm prompts list
			expect(result.prompts).toHaveLength(6)
			expect(result.prompts.some((p) => p.name === 'listening_insights')).toBe(true)
			expect(result.prompts.some((p) => p.name === 'music_discovery')).toBe(true)
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
		// Tests for Last.fm prompt implementations
		it('should return listening_insights prompt', () => {
			const result = handlePromptsGet({
				name: 'listening_insights',
				arguments: { username: 'testuser' },
			})

			expect(result).toMatchObject({
				description: expect.stringContaining('listening habits'),
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: expect.stringContaining('testuser'),
						},
					},
				],
			})
		})

		it('should return music_discovery prompt', () => {
			const result = handlePromptsGet({
				name: 'music_discovery',
				arguments: { username: 'testuser', genre: 'rock' },
			})

			expect(result).toMatchObject({
				description: expect.stringContaining('new music'),
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: expect.stringContaining('testuser'),
						},
					},
				],
			})
		})

		it('should return track_analysis prompt', () => {
			const result = handlePromptsGet({
				name: 'track_analysis',
				arguments: { artist: 'The Beatles', track: 'Come Together' },
			})

			expect(result).toMatchObject({
				description: expect.stringContaining('track'),
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: expect.stringContaining('Come Together'),
						},
					},
				],
			})
		})

		it('should return album_analysis prompt', () => {
			const result = handlePromptsGet({
				name: 'album_analysis',
				arguments: { artist: 'The Beatles', album: 'Abbey Road' },
			})

			expect(result).toMatchObject({
				description: expect.stringContaining('album'),
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: expect.stringContaining('Abbey Road'),
						},
					},
				],
			})
		})

		it('should return artist_analysis prompt', () => {
			const result = handlePromptsGet({
				name: 'artist_analysis',
				arguments: { artist: 'The Beatles' },
			})

			expect(result).toMatchObject({
				description: expect.stringContaining('artist'),
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: expect.stringContaining('The Beatles'),
						},
					},
				],
			})
		})

		it('should return listening_habits prompt', () => {
			const result = handlePromptsGet({
				name: 'listening_habits',
				arguments: { username: 'testuser', timeframe: 'recent' },
			})

			expect(result).toMatchObject({
				description: expect.stringContaining('listening habits'),
				messages: [
					{
						role: 'user',
						content: {
							type: 'text',
							text: expect.stringContaining('testuser'),
						},
					},
				],
			})
		})

		it('should throw error for missing username in listening_insights', () => {
			expect(() =>
				handlePromptsGet({
					name: 'listening_insights',
					arguments: {},
				}),
			).toThrow('listening_insights prompt requires a username argument')
		})

		it('should throw error for missing arguments in track_analysis', () => {
			expect(() =>
				handlePromptsGet({
					name: 'track_analysis',
					arguments: { artist: 'The Beatles' },
				}),
			).toThrow('track_analysis prompt requires both artist and track arguments')
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
