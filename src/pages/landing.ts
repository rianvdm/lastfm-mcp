// ABOUTME: Builds the landing page served at / from landing.html, imported as a text module, plus its FAQ and JSON-LD.
// ABOUTME: Fills in the request origin so every address a visitor copies points at the server they're looking at.
import { FAQ_ITEMS, faqJsonLd, renderFaqHtml } from './faq'
import landing from './landing.html'
import { fillPlaceholders } from './template'

/** When the landing page last changed (ISO date). The sitemap's <lastmod>; update it with any change to the page. */
export const LANDING_PAGE_UPDATED = '2026-11-12'

const SITE_URL = 'https://lastfm-mcp.com/'
const SITE_NAME = 'Last.fm MCP'

/** The page's schema.org graph. URLs stay on production whatever origin serves the page. */
const STRUCTURED_DATA = {
	'@context': 'https://schema.org',
	'@graph': [
		{
			'@type': 'WebSite',
			'@id': `${SITE_URL}#website`,
			name: SITE_NAME,
			url: SITE_URL,
		},
		{
			'@type': 'SoftwareApplication',
			'@id': `${SITE_URL}#app`,
			name: SITE_NAME,
			description:
				'A free, open-source MCP server that connects your Last.fm listening history to Claude, ChatGPT and other AI assistants. ' +
				'It only reads.',
			url: SITE_URL,
			applicationCategory: 'MultimediaApplication',
			operatingSystem: 'Any',
			offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
			license: 'https://opensource.org/license/mit',
			author: { '@type': 'Person', name: 'Rian van der Merwe', url: 'https://elezea.com' },
			sameAs: ['https://github.com/rianvdm/lastfm-mcp'],
			featureList: [
				'Ask about your Last.fm scrobbles, charts and loved tracks in your own words',
				'Works with Claude, Claude Code, Codex, Cursor and other apps that support remote MCP servers',
				'Sign in with your Last.fm account; no API key needed',
				"Read-only: it can't scrobble, love tracks or change your account",
			],
			screenshot: `${SITE_URL}og.png`,
		},
		faqJsonLd(FAQ_ITEMS),
	],
}

/** JSON for an inline <script>: `<` is escaped so no string in the data can close the script element. */
function scriptJson(data: object): string {
	return JSON.stringify(data).replaceAll('<', '\\u003c')
}

/** Replaces the one `<!-- NAME -->` marker in `html` with `content`, and throws if the marker isn't there exactly once. */
function replaceMarker(html: string, name: string, content: string): string {
	const marker = `<!-- ${name} -->`
	const parts = html.split(marker)
	if (parts.length !== 2) {
		throw new Error(`Expected one ${marker} marker in landing.html, found ${parts.length - 1}`)
	}
	return parts.join(content)
}

// Everything but the origin is the same on every request, so it's filled in once
const LANDING_TEMPLATE = replaceMarker(
	replaceMarker(landing, 'STRUCTURED DATA', `<script type="application/ld+json">${scriptJson(STRUCTURED_DATA)}</script>`),
	'FAQ',
	renderFaqHtml(FAQ_ITEMS),
)

/** Returns the landing page HTML with every copyable server address pointing at `origin`. */
export function buildLandingPage(origin: string): string {
	return fillPlaceholders(LANDING_TEMPLATE, { ORIGIN: origin })
}
