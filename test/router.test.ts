import { describe, it, expect } from 'vitest'
import { route } from '../src/router'

describe('Router', () => {
	describe('ping command', () => {
		it('should return pong for ping command', async () => {
			const result = await route('ping')
			expect(result).toBe('pong')
		})

		it('should handle ping with different cases', async () => {
			expect(await route('PING')).toBe('pong')
			expect(await route('Ping')).toBe('pong')
			expect(await route('pInG')).toBe('pong')
		})

		it('should handle ping with whitespace', async () => {
			expect(await route('  ping  ')).toBe('pong')
			expect(await route('\tping\n')).toBe('pong')
		})
	})

	describe('unknown commands', () => {
		it('should return Unknown command for unrecognized input', async () => {
			expect(await route('hello')).toBe('Unknown command')
			expect(await route('test')).toBe('Unknown command')
			expect(await route('')).toBe('Unknown command')
			expect(await route('release 123')).toBe('Unknown command')
		})
	})
})
