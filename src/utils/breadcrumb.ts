// ABOUTME: Breadcrumb helper — appends a "Next steps" block to MCP tool responses
// ABOUTME: so the model has explicit, copy-paste-ready follow-up calls.

/**
 * Inspired by Rui Carmo's MCP server post (https://taoofmac.com/space/blog/2026/04/29/2341):
 * models don't plan, they pick the most probable next tool. Handing them the
 * exact next call removes a planning step they would otherwise fumble.
 */

export interface NextStep {
	tool: string
	args: string
	hint: string
}

export interface NextStepsOptions {
	/** Added as `username` to every step that calls a user-defaulting lookup; see `lookupUsername`. */
	lookupUsername?: string
}

/** Lookups that show the signed-in user's plays when called without `username`. */
const USER_DEFAULTING_LOOKUPS = new Set(['get_artist_info', 'get_album_info', 'get_track_info'])

/**
 * The username a tool's lookup breadcrumbs must carry so following them shows plays for the same user as the tool's
 * result, or undefined when the lookups' default (the signed-in user) already is that user. Usernames compare
 * case-insensitively, as Last.fm treats them.
 */
export function lookupUsername(requested: string | undefined, signedIn: string | undefined): string | undefined {
	if (!requested) return undefined
	return signedIn && requested.toLowerCase() === signedIn.toLowerCase() ? undefined : requested
}

export function buildNextSteps(steps: NextStep[], options: NextStepsOptions = {}): string {
	if (steps.length === 0) return ''
	const userArg = options.lookupUsername ? `username=${JSON.stringify(options.lookupUsername)}` : ''
	const argsFor = (s: NextStep) => (userArg && USER_DEFAULTING_LOOKUPS.has(s.tool) ? [s.args, userArg].filter(Boolean).join(', ') : s.args)
	const lines = steps.map((s) => `- \`${s.tool}(${argsFor(s)})\` — ${s.hint}`).join('\n')
	return `\n\n---\n**Next steps:**\n${lines}`
}
