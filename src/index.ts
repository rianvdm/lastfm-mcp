/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { route } from './router'

export default {
	async fetch(request, _env, _ctx): Promise<Response> {
		// Only accept POST requests for MCP commands
		if (request.method !== 'POST') {
			return new Response('Method not allowed', { status: 405 })
		}

		try {
			// Parse the raw text body as the command
			const command = await request.text()

			// Route the command and get the response
			const response = await route(command)

			// Return the response as Markdown
			return new Response(response, {
				headers: {
					'Content-Type': 'text/markdown; charset=utf-8',
				},
			})
		} catch (error) {
			// Return error as Markdown
			return new Response(`## Error\n\nSorry, something went wrong: ${error}`, {
				status: 500,
				headers: {
					'Content-Type': 'text/markdown; charset=utf-8',
				},
			})
		}
	},
} satisfies ExportedHandler<Env>
