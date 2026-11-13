// ABOUTME: Fills {{UPPER_SNAKE}} placeholders in page sources (landing page, llms.txt) imported as text modules.
// ABOUTME: Throws on any placeholder left unfilled, so a page never ships with a raw {{TOKEN}} in it.

const UNFILLED_PLACEHOLDER = /\{\{[A-Z][A-Z0-9_]*\}\}/

/** Replaces every `{{KEY}}` in `template` for each key in `values`, then throws if any `{{UPPER_SNAKE}}` token remains. */
export function fillPlaceholders(template: string, values: Record<string, string>): string {
	let filled = template
	for (const [key, value] of Object.entries(values)) {
		// A callback keeps the value literal: a replacement string would expand $$, $& and friends
		filled = filled.replaceAll(`{{${key}}}`, () => value)
	}

	const unfilled = filled.match(UNFILLED_PLACEHOLDER)
	if (unfilled) {
		throw new Error(`Unfilled placeholder: ${unfilled[0]}`)
	}
	return filled
}
