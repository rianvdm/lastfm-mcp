// ABOUTME: Request logging utility that stores structured log entries in Cloudflare KV.
// ABOUTME: Tracks user requests, method calls, latency, and error details with auto-expiring keys.

// KVNamespace is available globally in Cloudflare Workers runtime
declare global {
	interface KVNamespace {
		get(key: string): Promise<string | null>
		put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
		list(options?: { prefix?: string; limit?: number }): Promise<{ keys: Array<{ name: string }> }>
		delete(key: string): Promise<void>
	}
}

export interface LogEntry {
	timestamp: string
	userId: string
	method: string
	params: unknown
	result: {
		status: 'success' | 'error'
		latency: number
		errorCode?: number
		errorMessage?: string
	}
}

export class KVLogger {
	constructor(private kv: KVNamespace) {}

	async log(userId: string, method: string, params: unknown, result: LogEntry['result']): Promise<void> {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			userId,
			method,
			params,
			result,
		}

		// Create a unique key with timestamp for ordering
		const key = `log:${userId}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`

		// Store with 30 day TTL (30 * 24 * 60 * 60 = 2592000 seconds)
		await this.kv.put(key, JSON.stringify(entry), {
			expirationTtl: 2592000,
		})
	}

	async getLogs(userId: string, limit = 100): Promise<LogEntry[]> {
		const prefix = `log:${userId}:`
		const list = await this.kv.list({ prefix, limit })

		const logs: LogEntry[] = []
		for (const key of list.keys) {
			const value = await this.kv.get(key.name)
			if (value) {
				try {
					logs.push(JSON.parse(value))
				} catch (error) {
					console.error('Failed to parse log entry:', error)
				}
			}
		}

		// Sort by timestamp descending (newest first)
		return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
	}
}
