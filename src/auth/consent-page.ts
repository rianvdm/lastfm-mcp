// ABOUTME: Pure HTML renderer for the OAuth consent page and its error page.
// ABOUTME: Service-specific copy comes from ConsentBranding; takes no env, KV or Request so it can be reused across MCP servers.
import type { ConsentDescription } from '@cloudflare/workers-oauth-provider'

import { sanitizeText } from '../utils/security'

/** Service-specific copy and links; everything else on the page is generic. */
export interface ConsentBranding {
	/** Wordmark text, e.g. "Last.fm MCP". */
	productName: string
	/** Page headline. Deliberately does not name the requesting app. */
	headline: string
	/** Intro paragraph: what signing in involves and what access the app gets. */
	accessSentence: string
	/** Label of the primary (approve) button. */
	continueLabel: string
	/** Link to the privacy notice. */
	privacyUrl: string
}

export const LASTFM_CONSENT_BRANDING: ConsentBranding = {
	productName: 'Last.fm MCP',
	headline: 'An app wants to read your Last.fm listening data',
	accessSentence:
		"If you continue, Last.fm will ask you to sign in. The app gets read-only access to your listening history and profile. It can't scrobble or change anything.",
	continueLabel: 'Continue to Last.fm',
	privacyUrl: 'https://elezea.com/privacy/#lastfm-mcp-server',
}

const LOOPBACK_WARNING = 'This sends access to an app on your computer. Continue only if you just started connecting from that app.'
const UNVERIFIED_NOTE = "The app chose this name itself. It hasn't been checked."
const REMEMBER_NOTE = "You won't be asked again for this app for a year."
const ERROR_NEXT_STEP = 'Please return to your app and connect again.'

const STYLES = `
*{box-sizing:border-box}
body{margin:0;background:#fff;color:#444;font-family:Georgia,Cambria,"Times New Roman",Times,serif;font-size:17px;line-height:1.45}
main{max-width:560px;margin:0 auto;padding:40px 20px 34px}
.wordmark{display:flex;align-items:center;gap:8px;color:#1b1b1b;font-size:15px;font-weight:700;letter-spacing:.01em}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#ff6c00}
h1{color:#1b1b1b;font-size:30px;line-height:1.2;margin:28px 0 12px}
p{margin:0 0 1em}
dl{margin:22px 0;padding:0;border-top:1px solid #ddd}
dl>div{display:grid;grid-template-columns:9.5em 1fr;gap:12px;padding:12px 0;border-bottom:1px solid #ddd}
dt{color:#767676;font-size:15px;padding-top:2px}
dd{margin:0;color:#1b1b1b;overflow-wrap:anywhere}
dd small{display:block;color:#767676;font-size:14px}
.host{font-family:Monaco,Menlo,monospace;font-size:14px;background:#f1f1f1;padding:2px 6px;border-radius:3px}
.warn{background:#fff8d6;border-left:4px solid #ffe670;border-radius:5px;padding:12px 14px;margin:18px 0;color:#1b1b1b}
.btns{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}
button{font-family:inherit;font-size:17px;line-height:1.4;padding:.55em 1.1em .45em;border-radius:5px;background:#fff;cursor:pointer}
.approve{color:#ff6c00;border:2px solid #ff6c00;font-weight:700}
.deny{color:#1b1b1b;border:1px solid #1b1b1b}
.fine{color:#767676;font-size:14px;margin-top:22px}
.fine a{color:#767676}
@media (max-width:480px){main{padding:28px 16px}h1{font-size:25px}dl>div{grid-template-columns:1fr;gap:2px}.btns button{flex:1 1 100%}}
`

function layout(title: string, branding: ConsentBranding, body: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${sanitizeText(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<div class="wordmark"><span class="dot"></span>${sanitizeText(branding.productName)}</div>
${body}
</main>
</body>
</html>
`
}

/**
 * Render the consent page. Every client-supplied string is escaped.
 * The form posts `handle` and a `decision` of approve or deny back to /authorize.
 */
export function renderConsentPage(details: ConsentDescription, handle: string, branding: ConsentBranding): string {
	const appNote = details.clientDomain ? `Published by ${sanitizeText(details.clientDomain)} (verified)` : sanitizeText(UNVERIFIED_NOTE)
	const appName = details.clientDomain ? sanitizeText(details.clientName) : `“${sanitizeText(details.clientName)}”`
	const warning = details.redirectIsLoopback ? `<div class="warn">${sanitizeText(LOOPBACK_WARNING)}</div>\n` : ''
	const remember = details.redirectIsLoopback ? '' : `${sanitizeText(REMEMBER_NOTE)} `

	const body = `<h1>${sanitizeText(branding.headline)}</h1>
<p>${sanitizeText(branding.accessSentence)}</p>
<dl>
<div><dt>App</dt><dd>${appName}<small>${appNote}</small></dd></div>
<div><dt>Access goes to</dt><dd><span class="host">${sanitizeText(details.redirectHost)}</span></dd></div>
</dl>
${warning}<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${sanitizeText(handle)}">
<div class="btns">
<button type="submit" class="approve" name="decision" value="approve">${sanitizeText(branding.continueLabel)}</button>
<button type="submit" class="deny" name="decision" value="deny">Don't allow</button>
</div>
</form>
<p class="fine">${remember}<a href="${sanitizeText(branding.privacyUrl)}">Privacy</a></p>`

	return layout(branding.headline, branding, body)
}

/** Render a short page in the same style for expired, replayed or invalid consent requests. */
export function renderConsentErrorPage(message: string, branding: ConsentBranding): string {
	const body = `<h1>This request can't be completed</h1>
<p>${sanitizeText(message)}</p>
<p>${sanitizeText(ERROR_NEXT_STEP)}</p>
<p class="fine"><a href="${sanitizeText(branding.privacyUrl)}">Privacy</a></p>`

	return layout("This request can't be completed", branding, body)
}
