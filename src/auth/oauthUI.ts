// ABOUTME: Provides HTML UI for OAuth authorization flow
// ABOUTME: Handles user authentication and consent for Claude Desktop integration

/**
 * Generate the OAuth authorization page HTML
 */
export function generateAuthorizePage(params: {
	clientId: string
	redirectUri: string
	state: string
	scope: string
	lastfmAuthUrl?: string
	lastfmAuth?: { username: string; sessionKey: string }
	error?: string
}): string {
	const { clientId, redirectUri, state, scope, lastfmAuthUrl, lastfmAuth, error } = params

	const scopes = scope.split(' ')
	const scopeDescriptions: Record<string, string> = {
		'mcp.read': 'Read MCP data and Last.fm information',
		'mcp.write': 'Modify MCP settings',
		'lastfm.connect': 'Access your Last.fm listening data',
		'offline_access': 'Stay connected without re-authenticating',
	}

	return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Authorize Last.fm MCP</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			background: #f5f5f5;
			color: #333;
			line-height: 1.6;
			display: flex;
			justify-content: center;
			align-items: center;
			min-height: 100vh;
			padding: 20px;
		}
		
		.container {
			background: white;
			border-radius: 12px;
			box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
			max-width: 450px;
			width: 100%;
			padding: 40px;
		}
		
		.logo {
			text-align: center;
			margin-bottom: 30px;
		}
		
		.logo h1 {
			font-size: 28px;
			color: #d51007;
			margin-bottom: 10px;
		}
		
		.logo .subtitle {
			color: #666;
			font-size: 14px;
		}
		
		.error {
			background: #fee;
			border: 1px solid #fcc;
			color: #c00;
			padding: 12px;
			border-radius: 6px;
			margin-bottom: 20px;
		}
		
		.client-info {
			background: #f8f9fa;
			border-radius: 8px;
			padding: 20px;
			margin-bottom: 25px;
		}
		
		.client-info h2 {
			font-size: 18px;
			margin-bottom: 10px;
			color: #555;
		}
		
		.client-id {
			font-family: monospace;
			font-size: 12px;
			color: #666;
			word-break: break-all;
		}
		
		.permissions {
			margin-bottom: 30px;
		}
		
		.permissions h3 {
			font-size: 16px;
			margin-bottom: 15px;
			color: #444;
		}
		
		.permission-list {
			list-style: none;
		}
		
		.permission-list li {
			padding: 10px 0;
			padding-left: 30px;
			position: relative;
			color: #555;
		}
		
		.permission-list li:before {
			content: "✓";
			position: absolute;
			left: 0;
			color: #4CAF50;
			font-weight: bold;
		}
		
		.actions {
			display: flex;
			gap: 15px;
		}
		
		.btn {
			flex: 1;
			padding: 12px 24px;
			border: none;
			border-radius: 6px;
			font-size: 16px;
			font-weight: 500;
			cursor: pointer;
			text-decoration: none;
			text-align: center;
			transition: all 0.2s;
		}
		
		.btn-primary {
			background: #d51007;
			color: white;
		}
		
		.btn-primary:hover {
			background: #b00e06;
		}
		
		.btn-secondary {
			background: #e0e0e0;
			color: #333;
		}
		
		.btn-secondary:hover {
			background: #d0d0d0;
		}
		
		.lastfm-note {
			margin-top: 25px;
			padding-top: 25px;
			border-top: 1px solid #eee;
			text-align: center;
			color: #666;
			font-size: 14px;
		}
		
		.lastfm-note a {
			color: #d51007;
			text-decoration: none;
		}
		
		.lastfm-note a:hover {
			text-decoration: underline;
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="logo">
			<h1>🎵 Last.fm MCP</h1>
			<div class="subtitle">Model Context Protocol Server</div>
		</div>
		
		${error ? `<div class="error">${error}</div>` : ''}
		
		<div class="client-info">
			<h2>Claude Desktop wants to connect</h2>
			<div class="client-id">Client ID: ${clientId}</div>
		</div>
		
		<div class="permissions">
			<h3>This application will be able to:</h3>
			<ul class="permission-list">
				${scopes.map(s => `<li>${scopeDescriptions[s] || s}</li>`).join('')}
			</ul>
		</div>
		
		<form method="post" action="/oauth/authorize/confirm">
			<input type="hidden" name="client_id" value="${clientId}">
			<input type="hidden" name="redirect_uri" value="${redirectUri}">
			<input type="hidden" name="state" value="${state}">
			<input type="hidden" name="scope" value="${scope}">
			${lastfmAuth ? `
				<input type="hidden" name="lastfm_username" value="${lastfmAuth.username}">
				<input type="hidden" name="lastfm_session_key" value="${lastfmAuth.sessionKey}">
			` : ''}
			
			<div class="actions">
				${lastfmAuthUrl ? `
					<a href="${lastfmAuthUrl}" class="btn btn-primary">Connect with Last.fm</a>
				` : `
					<button type="submit" name="action" value="allow" class="btn btn-primary">
						Authorize
					</button>
				`}
				<button type="submit" name="action" value="deny" class="btn btn-secondary">
					Cancel
				</button>
			</div>
		</form>
		
		<div class="lastfm-note">
			${lastfmAuthUrl ? 
				'You need to authenticate with Last.fm first' : 
				lastfmAuth ? `Connected to Last.fm as ${lastfmAuth.username} • <a href="/logout">Switch account</a>` :
				'Connected to Last.fm • <a href="/logout">Switch account</a>'
			}
		</div>
	</div>
</body>
</html>
	`
}

/**
 * Generate success page after OAuth authorization
 */
export function generateSuccessPage(): string {
	return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Authorization Successful</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			background: #f5f5f5;
			display: flex;
			justify-content: center;
			align-items: center;
			min-height: 100vh;
			margin: 0;
			padding: 20px;
		}
		
		.message {
			background: white;
			padding: 40px;
			border-radius: 12px;
			box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
			text-align: center;
			max-width: 400px;
		}
		
		.icon {
			font-size: 48px;
			margin-bottom: 20px;
		}
		
		h1 {
			color: #333;
			margin-bottom: 10px;
		}
		
		p {
			color: #666;
			line-height: 1.6;
		}
		
		.note {
			margin-top: 20px;
			font-size: 14px;
			color: #999;
		}
	</style>
</head>
<body>
	<div class="message">
		<div class="icon">✅</div>
		<h1>Authorization Successful!</h1>
		<p>You can now close this window and return to Claude Desktop.</p>
		<p class="note">The Last.fm MCP server is now connected.</p>
	</div>
</body>
</html>
	`
}

/**
 * Generate error page for OAuth failures
 */
export function generateErrorPage(error: string, description?: string): string {
	return `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Authorization Error</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			background: #f5f5f5;
			display: flex;
			justify-content: center;
			align-items: center;
			min-height: 100vh;
			margin: 0;
			padding: 20px;
		}
		
		.message {
			background: white;
			padding: 40px;
			border-radius: 12px;
			box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
			text-align: center;
			max-width: 400px;
		}
		
		.icon {
			font-size: 48px;
			margin-bottom: 20px;
			color: #d51007;
		}
		
		h1 {
			color: #333;
			margin-bottom: 10px;
		}
		
		.error {
			color: #666;
			margin-bottom: 10px;
			font-weight: 500;
		}
		
		.description {
			color: #999;
			font-size: 14px;
			line-height: 1.6;
		}
		
		.back-link {
			margin-top: 20px;
			display: inline-block;
			color: #d51007;
			text-decoration: none;
		}
		
		.back-link:hover {
			text-decoration: underline;
		}
	</style>
</head>
<body>
	<div class="message">
		<div class="icon">❌</div>
		<h1>Authorization Failed</h1>
		<p class="error">Error: ${error}</p>
		${description ? `<p class="description">${description}</p>` : ''}
		<a href="/" class="back-link">← Go back</a>
	</div>
</body>
</html>
	`
}