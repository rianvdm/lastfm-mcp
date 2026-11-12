// ABOUTME: Ambient type declaration for the `cloudflare:workers` module in the test project.
// ABOUTME: The test tsconfig doesn't load the workerd types that declare it; test/setup/ reads `env` from it.
declare module 'cloudflare:workers' {
	import type { Env } from '../src/types/env'

	export const env: Env
}
