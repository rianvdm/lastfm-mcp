// ABOUTME: Checks the bindings and module rules that wrangler.toml declares for staging and production.
// ABOUTME: Bindings aren't inherited by [env.production] and a missing one fails open silently, so drift between them fails here.
import { env } from 'cloudflare:test'
import { describe, it, expect } from 'vitest'

import { REGISTRATION_RATE_LIMIT_PERIOD_SECONDS } from '../src/utils/registrationRateLimit'

interface LimiterConfig {
	namespace_id: string
	simple: { limit: number; period: number }
}

const limiters = JSON.parse(env.TEST_REGISTRATION_RATE_LIMITERS) as { staging: LimiterConfig | null; production: LimiterConfig | null }
const toolEventsDatasets = JSON.parse(env.TEST_TOOL_EVENTS_DATASETS) as { staging: string | null; production: string | null }
const moduleRules = JSON.parse(env.TEST_MODULE_RULES) as Record<'staging' | 'production', { type: string; globs: string[] }[]>

describe('REGISTRATION_RATE_LIMITER in wrangler.toml', () => {
	it.each(['staging', 'production'] as const)('should be declared for %s', (environment) => {
		expect(limiters[environment]).not.toBeNull()
	})

	it('should give production the same budget as staging', () => {
		expect(limiters.production?.simple).toEqual(limiters.staging?.simple)
	})

	it('should keep staging and production counts in separate namespaces', () => {
		expect(limiters.production?.namespace_id).not.toBe(limiters.staging?.namespace_id)
	})

	it('should use the period the 429 sends as Retry-After', () => {
		expect(limiters.production?.simple.period).toBe(REGISTRATION_RATE_LIMIT_PERIOD_SECONDS)
	})
})

describe('TOOL_EVENTS in wrangler.toml', () => {
	it('should write staging tool calls to the staging dataset', () => {
		expect(toolEventsDatasets.staging).toBe('lastfm_mcp_tool_events_staging')
	})

	it('should write production tool calls to the production dataset', () => {
		expect(toolEventsDatasets.production).toBe('lastfm_mcp_tool_events')
	})
})

describe('module rules in wrangler.toml', () => {
	it.each(['staging', 'production'] as const)('should import .html and .md files as text and .png files as data for %s', (environment) => {
		expect(moduleRules[environment]).toEqual(
			expect.arrayContaining([
				{ type: 'Text', globs: ['**/*.html', '**/*.md'] },
				{ type: 'Data', globs: ['**/*.png'] },
			]),
		)
	})
})
