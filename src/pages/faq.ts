// ABOUTME: The landing page FAQ, kept once as data, with renderers for its visible HTML section and its FAQPage JSON-LD.
// ABOUTME: Both come from the same items so the questions people read and the ones search and answer engines read can't drift.

export interface FaqItem {
	question: string
	/** Plain text, as it appears in the JSON-LD. Uses the production address, never `{{ORIGIN}}`. */
	answer: string
	/** Phrases in `answer` (addresses, commands) to show as code on the page. The JSON-LD keeps the plain text. */
	code?: string[]
}

const MCP_URL = 'https://lastfm-mcp.com/mcp'
const CLAUDE_CODE_COMMAND = `claude mcp add --scope user --transport http lastfm ${MCP_URL}`

/** The verified FAQ (docs/superpowers/plans/2026-11-12-landing-page-verified-copy.md), in page order. */
export const FAQ_ITEMS: FaqItem[] = [
	{
		question: 'How do I connect Last.fm to Claude?',
		answer:
			`In Claude, go to Customize → Connectors, click Add, then Add custom connector. Name it Last.fm, paste ${MCP_URL}, click Continue, ` +
			`then Add, then Connect, and sign in to Last.fm. In Claude Code, run ${CLAUDE_CODE_COMMAND} in your terminal, then run /mcp in ` +
			'Claude Code, choose lastfm and sign in.',
		code: [MCP_URL, CLAUDE_CODE_COMMAND, '/mcp'],
	},
	{
		question: 'Does it work with ChatGPT?',
		answer:
			`Yes, on ChatGPT Business, Enterprise and Edu: a workspace admin or owner adds ${MCP_URL} as a custom MCP server and publishes it, ` +
			'and once your admin gives you access, you install Last.fm from Plugins and sign in. Other ChatGPT plans ' +
			"aren't supported yet, but any other app that supports remote MCP servers works.",
		code: [MCP_URL],
	},
	{
		question: 'Do I need a Last.fm API key?',
		answer: 'No. You sign in with your normal Last.fm account.',
	},
	{
		question: 'Is it free?',
		answer: "Yes. It's free and open source under the MIT licence.",
	},
	{
		question: 'Can it change my Last.fm account?',
		answer: "No. It only reads: it can't scrobble, love tracks or edit your profile.",
	},
	{
		question: 'What is MCP?',
		answer:
			'The Model Context Protocol is an open standard that lets AI assistants connect to outside data and tools. ' +
			'This is an MCP server for Last.fm.',
	},
]

function escapeHtml(text: string): string {
	return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The answer as HTML, with each `code` phrase in <code>. Longer phrases win where phrases overlap. */
function answerHtml({ answer, code = [] }: FaqItem): string {
	if (code.length === 0) return escapeHtml(answer)

	const phrases = [...code].sort((a, b) => b.length - a.length).map(escapeRegExp)
	// The capturing group keeps each matched phrase in the split, at the odd indexes
	return answer
		.split(new RegExp(`(${phrases.join('|')})`))
		.map((part, i) => (i % 2 === 1 ? `<code>${escapeHtml(part)}</code>` : escapeHtml(part)))
		.join('')
}

/** The visible FAQ section: each question an h3, each answer a plain paragraph, all open so people and crawlers read the same text. */
export function renderFaqHtml(items: FaqItem[]): string {
	const entries = items.map(
		(item) => `\t\t\t\t\t\t<div class="faq-item">
\t\t\t\t\t\t\t<h3>${escapeHtml(item.question)}</h3>
\t\t\t\t\t\t\t<p>${answerHtml(item)}</p>
\t\t\t\t\t\t</div>`,
	)

	return `<section class="section" id="faq" aria-labelledby="faq-heading">
\t\t\t\t<div class="wrap">
\t\t\t\t\t<h2 id="faq-heading">Questions</h2>
\t\t\t\t\t<div class="faq">
${entries.join('\n')}
\t\t\t\t\t</div>
\t\t\t\t</div>
\t\t\t</section>`
}

/** The FAQ as a schema.org FAQPage node, for the landing page's JSON-LD graph. */
export function faqJsonLd(items: FaqItem[]): object {
	return {
		'@type': 'FAQPage',
		'@id': 'https://lastfm-mcp.com/#faq',
		mainEntity: items.map(({ question, answer }) => ({
			'@type': 'Question',
			name: question,
			acceptedAnswer: { '@type': 'Answer', text: answer },
		})),
	}
}
