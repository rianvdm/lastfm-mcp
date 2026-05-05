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

export function buildNextSteps(steps: NextStep[]): string {
	if (steps.length === 0) return ''
	const lines = steps.map((s) => `- \`${s.tool}(${s.args})\` — ${s.hint}`).join('\n')
	return `\n\n---\n**Next steps:**\n${lines}`
}
