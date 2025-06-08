#!/usr/bin/env node

const http = require('http')
const readline = require('readline')

let sessionToken = null

// Function to get session token from the server
async function getSessionToken() {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: 'localhost',
				port: 8787,
				path: '/mcp-auth',
				method: 'GET',
			},
			(res) => {
				let body = ''
				res.on('data', (chunk) => (body += chunk))
				res.on('end', () => {
					try {
						if (res.statusCode === 200) {
							const response = JSON.parse(body)
							resolve(response.session_token)
						} else {
							const error = JSON.parse(body)
							console.error('Authentication failed:', error.message || error.error)
							console.error('Please visit http://localhost:8787/login to authenticate with Discogs first.')
							resolve(null)
						}
					} catch (err) {
						console.error('Error parsing auth response:', err)
						resolve(null)
					}
				})
			},
		)

		req.on('error', (err) => {
			console.error('Error getting session token:', err)
			resolve(null)
		})

		req.end()
	})
}

// Initialize session token
;(async () => {
	sessionToken = await getSessionToken()
	if (sessionToken) {
		console.error('✓ Authenticated with Discogs MCP server')
	} else {
		console.error('⚠ Not authenticated - some tools may not work')
		console.error('  Visit http://localhost:8787/login to authenticate')
	}
})()

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false,
})

rl.on('line', (line) => {
	const data = Buffer.from(line)

	const headers = {
		'Content-Type': 'application/json',
		'Content-Length': data.length,
	}

	// Add session cookie if we have one
	if (sessionToken) {
		headers['Cookie'] = `session=${sessionToken}`
	}

	const req = http.request(
		{
			hostname: 'localhost',
			port: 8787,
			path: '/',
			method: 'POST',
			headers,
		},
		(res) => {
			let body = ''
			res.on('data', (chunk) => (body += chunk))
			res.on('end', () => {
				// Handle empty responses (like 204 No Content for notifications)
				if (body.trim() === '') {
					// For notifications, don't output anything
					return
				}

				try {
					const jsonResponse = JSON.parse(body)

					// Check for authentication errors and try to refresh token
					if (jsonResponse.error && jsonResponse.error.code === -32001) {
						console.error('Authentication expired, attempting to refresh...')
						getSessionToken().then((newToken) => {
							if (newToken) {
								sessionToken = newToken
								console.error('✓ Authentication refreshed')
							} else {
								console.error('⚠ Authentication refresh failed')
							}
						})
					}

					process.stdout.write(JSON.stringify(jsonResponse) + '\n')
				} catch (err) {
					console.error('Error parsing JSON response:', err)
					console.error('Response body:', body)
				}
			})
		},
	)

	req.on('error', (err) => {
		console.error('Proxy error:', err)
		process.exit(1)
	})

	req.write(data)
	req.end()
})

// Handle process termination
process.on('SIGINT', () => {
	process.exit(0)
})

process.on('SIGTERM', () => {
	process.exit(0)
})
