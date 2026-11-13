// ABOUTME: Tests for the landing page FAQ in src/pages/faq.ts: the verified copy, its HTML section and its FAQPage JSON-LD.
// ABOUTME: The copy is asserted verbatim from the verified-copy notes, so any wording change is deliberate.
import { describe, it, expect } from 'vitest'

import { FAQ_ITEMS, faqJsonLd, renderFaqHtml, type FaqItem } from '../../src/pages/faq'

// The final FAQ from docs/superpowers/plans/2026-11-12-landing-page-verified-copy.md, with its code marks dropped
const VERIFIED_FAQ = [
	{
		question: 'How do I connect Last.fm to Claude?',
		answer:
			'In Claude, go to Customize → Connectors, click Add, then Add custom connector. Name it Last.fm, paste https://lastfm-mcp.com/mcp, ' +
			'click Continue, then Add, then Connect, and sign in to Last.fm. In Claude Code, run ' +
			'claude mcp add --scope user --transport http lastfm https://lastfm-mcp.com/mcp in your terminal, then run /mcp in Claude Code, ' +
			'choose lastfm and sign in.',
	},
	{
		question: 'Does it work with ChatGPT?',
		answer:
			'Yes, on ChatGPT Business, Enterprise and Edu: a workspace admin or owner adds https://lastfm-mcp.com/mcp as a custom MCP server ' +
			'and publishes it, and once your admin gives you access, you install Last.fm from Plugins and sign in. Other ChatGPT plans ' +
			"aren't supported yet, but any other app that supports remote MCP servers works.",
	},
	{ question: 'Do I need a Last.fm API key?', answer: 'No. You sign in with your normal Last.fm account.' },
	{ question: 'Is it free?', answer: "Yes. It's free and open source under the MIT licence." },
	{ question: 'Can it change my Last.fm account?', answer: "No. It only reads: it can't scrobble, love tracks or edit your profile." },
	{
		question: 'What is MCP?',
		answer:
			'The Model Context Protocol is an open standard that lets AI assistants connect to outside data and tools. ' +
			'This is an MCP server for Last.fm.',
	},
]

describe('FAQ_ITEMS', () => {
	it('has the six verified questions and answers, in order', () => {
		expect(FAQ_ITEMS.map(({ question, answer }) => ({ question, answer }))).toEqual(VERIFIED_FAQ)
	})

	it('uses the production address, never a placeholder', () => {
		for (const { answer } of FAQ_ITEMS) {
			expect(answer).not.toContain('{{')
		}
		expect(FAQ_ITEMS[0].answer).toContain('https://lastfm-mcp.com/mcp')
	})

	it('marks only phrases that appear in the answer as code', () => {
		for (const { answer, code = [] } of FAQ_ITEMS) {
			for (const phrase of code) {
				expect(answer).toContain(phrase)
			}
		}
	})
})

describe('renderFaqHtml', () => {
	it('wraps the section in id="faq" with one h3 per question', () => {
		const html = renderFaqHtml(FAQ_ITEMS)

		expect(html).toMatch(/<section[^>]*\sid="faq"/)
		expect(html.match(/<h3>/g)).toHaveLength(FAQ_ITEMS.length)
		for (const { question } of FAQ_ITEMS) {
			expect(html).toContain(`<h3>${question}</h3>`)
		}
	})

	it('shows each answer as a visible paragraph, not collapsed', () => {
		const html = renderFaqHtml(FAQ_ITEMS)

		expect(html).toContain('<p>No. You sign in with your normal Last.fm account.</p>')
		expect(html).not.toContain('<details')
	})

	it('renders code phrases as code, preferring the longest match', () => {
		const html = renderFaqHtml(FAQ_ITEMS)

		expect(html).toContain('<code>claude mcp add --scope user --transport http lastfm https://lastfm-mcp.com/mcp</code> in your terminal')
		expect(html).toContain('run <code>/mcp</code> in Claude Code')
		expect(html).toContain('paste <code>https://lastfm-mcp.com/mcp</code>, click Continue')
		expect(html).not.toContain('<code><code>')
	})

	it('escapes HTML in questions, answers and code', () => {
		const items: FaqItem[] = [{ question: 'Is <b> & "x" safe?', answer: 'Run a <script> & then x < y.', code: ['<script>'] }]
		const html = renderFaqHtml(items)

		expect(html).toContain('<h3>Is &lt;b&gt; &amp; "x" safe?</h3>')
		expect(html).toContain('<p>Run a <code>&lt;script&gt;</code> &amp; then x &lt; y.</p>')
	})
})

describe('faqJsonLd', () => {
	it('returns an FAQPage with one Question per item, whose answer text is the plain answer', () => {
		const jsonLd = faqJsonLd(FAQ_ITEMS) as {
			'@type': string
			mainEntity: { '@type': string; name: string; acceptedAnswer: { '@type': string; text: string } }[]
		}

		expect(jsonLd['@type']).toBe('FAQPage')
		expect(jsonLd.mainEntity).toHaveLength(FAQ_ITEMS.length)
		jsonLd.mainEntity.forEach((entity, i) => {
			expect(entity['@type']).toBe('Question')
			expect(entity.name).toBe(FAQ_ITEMS[i].question)
			expect(entity.acceptedAnswer['@type']).toBe('Answer')
			expect(entity.acceptedAnswer.text).toBe(FAQ_ITEMS[i].answer)
		})
	})
})
