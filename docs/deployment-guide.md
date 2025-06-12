# Production Deployment & Verification Guide

This guide walks you through deploying the Last.fm MCP Server to production and verifying it works with Claude Desktop.

## Prerequisites

Before deploying to production, ensure you have:

1. **Cloudflare Account** with Workers enabled
2. **Last.fm Developer Account** with API credentials
3. **GitHub Repository** with appropriate secrets configured
4. **Claude Desktop** installed and configured

## Step 1: Configure GitHub Secrets

Set the following secrets in your GitHub repository (Settings → Secrets and variables → Actions):

```bash
CLOUDFLARE_API_TOKEN=your_cloudflare_api_token_here
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id_here
```

### Getting Cloudflare Credentials

1. **API Token**: Go to [Cloudflare Dashboard → My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens)

   - Click "Create Token"
   - Use "Custom token" template
   - Permissions: `Zone:Zone:Read`, `Zone:Zone Settings:Edit`, `Account:Cloudflare Workers:Edit`
   - Account Resources: Include your account
   - Zone Resources: Include all zones (or specific zone if preferred)

2. **Account ID**: Found in the right sidebar of any Cloudflare Dashboard page

## Step 2: Set Up Production Environment

Run the production setup script to create KV namespaces and configure secrets:

```bash
npm run setup:prod
```

This script will:

1. Create production KV namespaces for logs, rate limiting, and sessions
2. Prompt you to set the required secrets:
   - `LASTFM_API_KEY` - Your Last.fm API key
   - `LASTFM_SHARED_SECRET` - Your Last.fm shared secret
   - `JWT_SECRET` - A strong random string for JWT signing

### Getting Discogs Credentials

1. Go to [Discogs Developer Settings](https://www.discogs.com/settings/developers)
2. Create a new application or use an existing one
3. Note down the Consumer Key and Consumer Secret
4. Set the callback URL to: `https://your-worker-domain.workers.dev/callback`

## Step 3: Update Production Configuration

After running the setup script, update `wrangler.toml` with the actual production KV namespace IDs:

```toml
# Replace the placeholder IDs with actual ones from the setup script output
[[env.production.kv_namespaces]]
binding = "MCP_LOGS"
id = "actual-logs-namespace-id"

[[env.production.kv_namespaces]]
binding = "MCP_RL"
id = "actual-rl-namespace-id"

[[env.production.kv_namespaces]]
binding = "MCP_SESSIONS"
id = "actual-sessions-namespace-id"
```

## Step 4: Deploy to Production

### Automatic Deployment (Recommended)

Push your changes to the `main` branch:

```bash
git add .
git commit -m "feat: configure production deployment"
git push origin main
```

The GitHub Actions workflow will automatically:

1. Run tests and linting
2. Deploy to production if all checks pass
3. Comment on the associated PR with deployment status

### Manual Deployment

Alternatively, deploy manually:

```bash
npm run deploy:prod
```

## Step 5: Verify Deployment

### 5.1 Test Basic Connectivity

```bash
curl https://your-worker-domain.workers.dev/health
```

Expected response:

```json
{ "status": "ok", "timestamp": "2024-01-01T00:00:00.000Z" }
```

### 5.2 Test MCP Protocol

Use the provided test script:

```bash
./scripts/test-production.sh https://your-worker-domain.workers.dev
```

This script tests:

- MCP initialization
- Authentication flow
- Tool functionality
- Resource access

### 5.3 Test OAuth Flow

1. Visit: `https://your-worker-domain.workers.dev/login`
2. Complete Discogs OAuth authorization
3. Verify successful callback and session creation

## Step 6: Configure Claude Desktop

### 6.1 Update Claude Desktop Configuration

Add the MCP server to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
	"mcpServers": {
		"discogs": {
			"command": "npx",
			"args": ["mcp-remote", "https://your-worker-domain.workers.dev/sse"]
		}
	}
}
```

### 6.2 Test with Claude Desktop

1. **Restart Claude Desktop** after updating the configuration
2. **Start a new conversation** and try these commands:

```
Can you help me search my Discogs collection?
```

```
What are some statistics about my music collection?
```

```
Find jazz albums from the 1960s in my collection
```

## Step 7: Production Verification Checklist

Use this checklist to verify your production deployment:

### Infrastructure

- [ ] Production KV namespaces created and configured
- [ ] Secrets properly set in Cloudflare Workers
- [ ] GitHub Actions deployment successful
- [ ] Worker accessible via HTTPS

### Authentication

- [ ] OAuth login flow works
- [ ] Discogs callback URL configured correctly
- [ ] JWT sessions created and validated
- [ ] Rate limiting functional

### MCP Protocol

- [ ] Initialize handshake successful
- [ ] Tools list correctly
- [ ] Resources list correctly
- [ ] Prompts list correctly

### Functionality

- [ ] Collection search works
- [ ] Release details retrieval works
- [ ] Collection statistics generation works
- [ ] Recommendations system works
- [ ] Error handling graceful

### Claude Desktop Integration

- [ ] MCP server appears in Claude Desktop
- [ ] Authentication flow completes in Claude
- [ ] Collection queries work through Claude
- [ ] Responses properly formatted

## Troubleshooting

### Common Issues

**1. "Worker not found" error**

- Verify the worker deployed successfully
- Check the worker domain in Cloudflare Dashboard

**2. "Authentication failed" error**

- Verify Discogs consumer key/secret are correct
- Check callback URL matches exactly
- Ensure JWT secret is set

**3. "KV namespace not found" error**

- Verify KV namespace IDs in wrangler.toml
- Ensure namespaces were created in correct account

**4. Claude Desktop doesn't see the server**

- Verify claude_desktop_config.json syntax
- Restart Claude Desktop after configuration changes
- Verify the SSE endpoint URL is correct

### Debug Commands

```bash
# Check worker logs
wrangler tail --env production

# Test MCP protocol directly
curl -X POST https://your-worker-domain.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# Verify KV namespaces
wrangler kv:namespace list

# Check secrets
wrangler secret list --env production
```

## Monitoring

### Key Metrics to Monitor

1. **Request Volume**: Track MCP requests per minute/hour
2. **Error Rate**: Monitor 4xx/5xx responses
3. **Authentication Success**: Track OAuth completion rate
4. **Response Times**: Monitor API latency
5. **Rate Limiting**: Track rate limit hits

### Cloudflare Analytics

Monitor your worker in the Cloudflare Dashboard:

- Workers → your-worker → Analytics
- Check request volume, error rates, and performance

### KV Storage Usage

Monitor KV usage for:

- Request logs (MCP_LOGS)
- Rate limiting counters (MCP_RL)
- User sessions (MCP_SESSIONS)

## Maintenance

### Regular Tasks

1. **Monitor KV Storage**: Clean up old logs and expired sessions
2. **Review Error Logs**: Check for recurring issues
3. **Update Dependencies**: Keep packages up to date
4. **Rotate Secrets**: Periodically rotate JWT secrets

### Scaling Considerations

- **Rate Limits**: Adjust per-user limits based on usage
- **KV Storage**: Implement TTL cleanup for old data
- **Caching**: Consider adding response caching for collection data
- **Multiple Regions**: Deploy to multiple Cloudflare regions if needed

---

This guide ensures your Discogs MCP Server is properly deployed, configured, and working with Claude Desktop in production.
