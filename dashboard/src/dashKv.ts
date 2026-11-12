// ABOUTME: A helper over the dashboard's own DASH_KV binding, shared by the grant summary and active-user counting.
// ABOUTME: Lists keys under a prefix page by page; callers keep their own read and write budgets.

/** Lists every DASH_KV key under `prefix`, one list call per 1,000 keys */
export async function listDashKeys(kv: KVNamespace, prefix: string): Promise<string[]> {
	const names: string[] = []
	let cursor: string | undefined
	do {
		const page = await kv.list({ prefix, cursor })
		names.push(...page.keys.map(({ name }) => name))
		cursor = page.list_complete ? undefined : page.cursor
	} while (cursor)
	return names
}
