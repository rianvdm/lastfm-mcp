// ABOUTME: Type declarations for the cloudflare:test env that the dashboard's Worker tests receive.
// ABOUTME: Types it as the dashboard's DashEnv, which dashboard/wrangler.toml declares.
import type { DashEnv } from '../src/env'

declare global {
	namespace Cloudflare {
		interface Env extends DashEnv {}
	}
}
