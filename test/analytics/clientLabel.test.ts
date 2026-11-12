// ABOUTME: Tests for labelForClient, which turns an OAuth client ID and registered name into a dashboard label.
// ABOUTME: Covers known CIMD URLs, unknown CIMD hosts, untrusted registered names (trim, collapse, cap) and missing input.
import { describe, it, expect } from 'vitest'

import { KNOWN_CLIENT_LABELS, labelForClient } from '../../src/analytics/clientLabel'

describe('labelForClient', () => {
	describe('CIMD client IDs (URLs)', () => {
		it.each([
			['https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude'],
			['https://claude.ai/oauth/claude-code-client-metadata', 'Claude Code'],
			['https://chatgpt.com/oauth/client.json', 'ChatGPT'],
			['https://chatgpt.com/oauth/codex/client.json', 'Codex'],
			['https://opencode.ai/oauth/opencode/client.json', 'OpenCode'],
		])('should label %s as %s', (clientId, label) => {
			expect(labelForClient(clientId)).toBe(label)
		})

		it('should keep every known label in KNOWN_CLIENT_LABELS', () => {
			expect(KNOWN_CLIENT_LABELS.get('https://chatgpt.com/oauth/codex/client.json')).toBe('Codex')
			expect(KNOWN_CLIENT_LABELS.size).toBe(5)
		})

		it('should fall back to the hostname for an unknown URL', () => {
			expect(labelForClient('https://sesameai.app/api/oauth/external-mcp/client.json')).toBe('sesameai.app')
		})

		it('should prefer the verified URL over a registered name', () => {
			expect(labelForClient('https://sesameai.app/api/oauth/external-mcp/client.json', 'Claude')).toBe('sesameai.app')
		})
	})

	describe('registered client IDs', () => {
		it('should trim the registered name', () => {
			expect(labelForClient('KcJrP3y-PHlwIp3v', '  oh-my-pi  ')).toBe('oh-my-pi')
		})

		it('should collapse runs of whitespace to one space', () => {
			expect(labelForClient('KcJrP3y-PHlwIp3v', 'My \t\n  MCP   client')).toBe('My MCP client')
		})

		it('should treat control characters as whitespace', () => {
			expect(labelForClient('KcJrP3y-PHlwIp3v', 'evil\u0000\u001bname')).toBe('evil name')
		})

		it('should cap a long name at its first 40 characters', () => {
			const name = 'abcdefghij'.repeat(6)
			expect(labelForClient('KcJrP3y-PHlwIp3v', name)).toBe(name.slice(0, 40))
		})

		it('should not split a character made of two UTF-16 units at the cap', () => {
			const name = `${'a'.repeat(39)}🎵🎵`
			expect(labelForClient('KcJrP3y-PHlwIp3v', name)).toBe(`${'a'.repeat(39)}🎵`)
		})

		it('should not end a capped name with a space', () => {
			const name = `${'a'.repeat(39)} bcd`
			expect(labelForClient('KcJrP3y-PHlwIp3v', name)).toBe('a'.repeat(39))
		})
	})

	describe('missing input', () => {
		it('should return unknown for a registered ID without a name', () => {
			expect(labelForClient('abc', undefined)).toBe('unknown')
		})

		it('should return unknown for a name that is only whitespace', () => {
			expect(labelForClient('abc', ' \t ')).toBe('unknown')
		})

		it('should return unknown without a client ID', () => {
			expect(labelForClient(undefined)).toBe('unknown')
		})
	})
})
