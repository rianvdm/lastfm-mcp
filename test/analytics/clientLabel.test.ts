// ABOUTME: Tests for labelForClient, which turns an OAuth client ID and registered name into a dashboard label.
// ABOUTME: Covers the exact CIMD URL map, the registered-name allowlist, and that every other input becomes "other" or "unknown".
import { describe, it, expect } from 'vitest'

import { CLIENT_LABELS, KNOWN_CLIENT_LABELS, labelForClient } from '../../src/analytics/clientLabel'

/** A registered (DCR) client ID: random, never a URL. */
const DCR_ID = 'KcJrP3y-PHlwIp3v'

describe('labelForClient', () => {
	describe('CIMD client IDs (URLs)', () => {
		it.each([
			['https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude'],
			['https://claude.ai/oauth/claude-code-client-metadata', 'Claude Code'],
			['https://chatgpt.com/oauth/client.json', 'ChatGPT'],
			['https://chatgpt.com/oauth/codex/client.json', 'Codex'],
			['https://opencode.ai/oauth/opencode/client.json', 'OpenCode'],
			['https://nousresearch.github.io/hermes-agent/docs/oauth/client-metadata.json', 'Hermes Agent'],
			['https://sesameai.app/api/oauth/external-mcp/client.json', 'Sesame'],
		])('should label %s as %s', (clientId, label) => {
			expect(labelForClient(clientId)).toBe(label)
		})

		it('should hold exactly the seven known CIMD URLs', () => {
			expect(KNOWN_CLIENT_LABELS.size).toBe(7)
		})

		it('should label an unknown URL other, never by its host or path', () => {
			expect(labelForClient('https://dc2.example/alice/client.json')).toBe('other')
		})

		it('should label a known host with an unknown path other', () => {
			expect(labelForClient('https://claude.ai/oauth/alice-client-metadata')).toBe('other')
		})

		it('should prefer the URL over a registered name', () => {
			expect(labelForClient('https://dc2.example/alice/client.json', 'Claude')).toBe('other')
		})
	})

	describe('registered client names', () => {
		it.each([
			['claude', 'Claude'],
			['Claude', 'Claude'],
			['claude code', 'Claude Code'],
			['Claude Code (my-laptop)', 'Claude Code'],
			['ChatGPT', 'ChatGPT'],
			['codex', 'Codex'],
			['Cursor', 'Cursor'],
			['Google', 'Google'],
			['Hermes Agent', 'Hermes Agent'],
			['Open WebUI', 'Open WebUI'],
			['Grok', 'Grok'],
			['Perplexity', 'Perplexity'],
			['LM Studio', 'LM Studio'],
			['MCP CLI Proxy', 'MCP CLI Proxy'],
			['opencode', 'OpenCode'],
			['Goose', 'Goose'],
			['Windsurf', 'Windsurf'],
			['vscode', 'VS Code'],
			['Visual Studio Code', 'VS Code'],
			['Zed', 'Zed'],
		])('should label the name %j as %s', (name, label) => {
			expect(labelForClient(DCR_ID, name)).toBe(label)
		})

		it('should trim, collapse whitespace and ignore case before matching', () => {
			expect(labelForClient(DCR_ID, '  OPEN \t\n WebUI  ')).toBe('Open WebUI')
		})

		it('should treat control characters as whitespace before matching', () => {
			expect(labelForClient(DCR_ID, 'lm\u0000studio')).toBe('LM Studio')
		})

		it('should label a username-like name other', () => {
			expect(labelForClient(DCR_ID, 'rianvdm')).toBe('other')
		})

		it('should label a known name with extra words other, except Claude Code', () => {
			expect(labelForClient(DCR_ID, 'Claude for rianvdm')).toBe('other')
			expect(labelForClient(DCR_ID, 'cursor rianvdm')).toBe('other')
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

	describe('CLIENT_LABELS', () => {
		it('should contain every CIMD label plus other and unknown', () => {
			for (const label of KNOWN_CLIENT_LABELS.values()) expect(CLIENT_LABELS.has(label)).toBe(true)
			expect(CLIENT_LABELS.has('other')).toBe(true)
			expect(CLIENT_LABELS.has('unknown')).toBe(true)
		})

		it('should only ever return a label from the allowed set', () => {
			const ids = [
				undefined,
				'',
				DCR_ID,
				'https://claude.ai/oauth/mcp-oauth-client-metadata',
				'https://dc2.example/alice/client.json',
				'http://localhost:3000/rianvdm.json',
				'not a url but has spaces',
			]
			const names = [
				undefined,
				'',
				'rianvdm',
				'alice@example.com',
				'Claude',
				'claude code rianvdm',
				'a'.repeat(500),
				'🎵 music',
				'evil\u0000\u001bname',
				'<script>alert(1)</script>',
				'VS Code',
				'https://evil.example/rianvdm',
			]
			const outputs = ids.flatMap((id) => names.map((name) => labelForClient(id, name)))

			expect(outputs.filter((label) => !CLIENT_LABELS.has(label))).toEqual([])
		})
	})
})
