/**
 * ABOUTME: Static HTML marketing page content for Last.fm MCP Server
 * ABOUTME: Serves as the landing page at the root URL to showcase the project
 */

export const MARKETING_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Last.fm MCP Server - Connect AI to Your Music</title>
    <meta name="description" content="Connect Claude and other AI assistants to your Last.fm listening data. Ask questions about your music history, discover new artists, analyze your taste.">
    <meta name="keywords" content="Last.fm, MCP, Model Context Protocol, Claude, AI, music, listening history">
    <link rel="canonical" href="https://lastfm-mcp.com">
    
    <meta property="og:title" content="Last.fm MCP Server">
    <meta property="og:description" content="Connect AI to your Last.fm listening data. Ask questions about your music history.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://lastfm-mcp.com">
    <meta property="og:image" content="https://file.elezea.com/lastfm-img.jpg">
    
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Last.fm MCP Server">
    <meta name="twitter:description" content="Connect AI to your Last.fm listening data.">
    <meta name="twitter:image" content="https://file.elezea.com/lastfm-img.jpg">
    
    <meta name="robots" content="index, follow">
    
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23d51007' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 18v-6a9 9 0 0 1 18 0v6'/%3E%3Cpath d='M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z'/%3E%3C/svg%3E">
    
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "Last.fm MCP Server",
      "applicationCategory": "DeveloperApplication",
      "operatingSystem": "Cross-platform",
      "description": "Model Context Protocol server connecting AI assistants to Last.fm music data.",
      "url": "https://lastfm-mcp.com",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "license": "https://opensource.org/licenses/MIT"
    }
    </script>
    
    <style>
        :root {
            --lastfm-red: #d51007;
            --lastfm-red-dark: #b30d06;
            --bg-dark: #0a0a0b;
            --bg-card: #141416;
            --bg-card-hover: #1a1a1d;
            --border: #2a2a2d;
            --text: #e4e4e7;
            --text-muted: #8b8b8f;
            --text-dim: #5a5a5d;
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-dark);
            color: var(--text);
            line-height: 1.5;
            min-height: 100vh;
        }
        
        .container { max-width: 900px; margin: 0 auto; padding: 0 24px; }
        
        header {
            border-bottom: 1px solid var(--border);
            padding: 16px 0;
        }
        
        .header-inner {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .logo {
            font-size: 1.1rem;
            font-weight: 600;
            color: var(--text);
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .logo-dot {
            width: 8px;
            height: 8px;
            background: var(--lastfm-red);
            border-radius: 50%;
        }
        
        nav { display: flex; gap: 24px; }
        
        nav a {
            color: var(--text-muted);
            text-decoration: none;
            font-size: 0.9rem;
            transition: color 0.2s;
        }
        
        nav a:hover { color: var(--text); }
        
        .hero {
            padding: 80px 0 60px;
            text-align: center;
        }
        
        .hero h1 {
            font-size: 2.5rem;
            font-weight: 600;
            margin-bottom: 16px;
            letter-spacing: -0.02em;
        }
        
        .hero h1 span { color: var(--lastfm-red); }
        
        .hero p {
            color: var(--text-muted);
            font-size: 1.1rem;
            max-width: 540px;
            margin: 0 auto 32px;
        }
        
        .cta-row {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 0.9rem;
            font-weight: 500;
            text-decoration: none;
            transition: all 0.2s;
            border: none;
            cursor: pointer;
        }
        
        .btn-primary {
            background: var(--lastfm-red);
            color: white;
        }
        
        .btn-primary:hover { background: var(--lastfm-red-dark); }
        
        .btn-secondary {
            background: transparent;
            color: var(--text);
            border: 1px solid var(--border);
        }
        
        .btn-secondary:hover {
            background: var(--bg-card);
            border-color: var(--text-dim);
        }
        
        section { padding: 60px 0; }
        
        section h2 {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 32px;
            letter-spacing: -0.01em;
        }
        
        .queries {
            border-top: 1px solid var(--border);
        }
        
        .query-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
        }
        
        @media (max-width: 640px) {
            .query-grid { grid-template-columns: 1fr; }
        }
        
        .query {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 20px 24px;
            transition: all 0.2s;
        }
        
        .query:hover {
            background: var(--bg-card-hover);
            border-color: var(--text-dim);
        }
        
        .query q {
            color: var(--text);
            font-size: 1rem;
            font-style: normal;
            display: block;
            margin-bottom: 8px;
        }
        
        .query q::before { content: '"'; color: var(--lastfm-red); }
        .query q::after { content: '"'; color: var(--lastfm-red); }
        
        .query span {
            color: var(--text-muted);
            font-size: 0.85rem;
        }
        
        .setup {
            border-top: 1px solid var(--border);
        }
        
        .setup-list {
            display: flex;
            flex-direction: column;
            gap: 24px;
        }
        
        .setup-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 24px;
        }
        
        .setup-card h3 {
            font-size: 1rem;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--text);
        }
        
        .setup-card .config-path {
            color: var(--text-muted);
            font-size: 0.85rem;
            margin-bottom: 16px;
            font-family: 'SF Mono', Monaco, monospace;
        }
        
        .setup-card p {
            color: var(--text-muted);
            font-size: 0.85rem;
            margin-bottom: 16px;
        }
        
        .code-wrap {
            position: relative;
        }
        
        .setup-card code {
            display: block;
            background: var(--bg-dark);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 12px 40px 12px 12px;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 0.8rem;
            color: var(--text);
            overflow-x: auto;
            white-space: pre;
            min-height: 44px;
        }
        
        .copy-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 0.7rem;
            color: var(--text-muted);
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .copy-btn:hover {
            background: var(--bg-card-hover);
            color: var(--text);
        }
        
        .copy-btn.copied {
            color: var(--lastfm-red);
        }
        
        .setup-card ol {
            color: var(--text-muted);
            font-size: 0.85rem;
            padding-left: 20px;
            margin-bottom: 16px;
        }
        
        .setup-card ol li { margin-bottom: 4px; }
        .setup-card ol li strong { color: var(--text); font-weight: 500; }
        
        .tools {
            border-top: 1px solid var(--border);
        }
        
        .tool-cols {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 32px;
        }
        
        .tool-col h3 {
            font-size: 0.8rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-dim);
            margin-bottom: 16px;
        }
        
        .tool-col ul {
            list-style: none;
        }
        
        .tool-col li {
            color: var(--text-muted);
            font-size: 0.9rem;
            padding: 6px 0;
            border-bottom: 1px solid var(--border);
        }
        
        .tool-col li:last-child { border-bottom: none; }
        
        footer {
            border-top: 1px solid var(--border);
            padding: 40px 0;
            text-align: center;
        }
        
        .footer-links {
            display: flex;
            justify-content: center;
            gap: 32px;
            margin-bottom: 24px;
            flex-wrap: wrap;
        }
        
        .footer-links a {
            color: var(--text-muted);
            text-decoration: none;
            font-size: 0.9rem;
            transition: color 0.2s;
        }
        
        .footer-links a:hover { color: var(--text); }
        
        .footer-note {
            color: var(--text-dim);
            font-size: 0.85rem;
        }
        
        .footer-note a {
            color: var(--lastfm-red);
            text-decoration: none;
        }
        
        @media (max-width: 640px) {
            .hero { padding: 48px 0 40px; }
            .hero h1 { font-size: 1.8rem; }
            .hero p { font-size: 1rem; }
            section { padding: 40px 0; }
            nav { gap: 16px; }
            .cta-row { flex-direction: column; align-items: center; }
            .btn { width: 100%; max-width: 280px; text-align: center; }
        }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <div class="header-inner">
                <a href="/" class="logo">
                    <span class="logo-dot"></span>
                    Last.fm MCP
                </a>
                <nav>
                    <a href="#setup">Setup</a>
                    <a href="#tools">Tools</a>
                    <a href="https://github.com/rianvdm/lastfm-mcp">GitHub</a>
                </nav>
            </div>
        </div>
    </header>
    
    <main>
        <section class="hero">
            <div class="container">
                <h1>Connect <span>AI</span> to your music</h1>
                <p>An MCP server that lets Claude and other AI assistants access your Last.fm listening history. Ask questions about your music taste, discover patterns, find new artists.</p>
                <div class="cta-row">
                    <a href="#setup" class="btn btn-primary">Get Started</a>
                    <a href="https://github.com/rianvdm/lastfm-mcp" class="btn btn-secondary">View Source</a>
                </div>
            </div>
        </section>
        
        <section class="queries">
            <div class="container">
                <h2>Things you can ask</h2>
                <div class="query-grid">
                    <div class="query">
                        <q>When did I start listening to Radiohead?</q>
                        <span>Searches your historical charts to find when an artist first appeared</span>
                    </div>
                    <div class="query">
                        <q>What was I obsessed with last summer?</q>
                        <span>Analyzes your listening data for any time period</span>
                    </div>
                    <div class="query">
                        <q>Find artists similar to my top 5</q>
                        <span>Discovers new music based on your actual listening habits</span>
                    </div>
                    <div class="query">
                        <q>How has my music taste changed over the years?</q>
                        <span>Tracks the evolution of your listening patterns</span>
                    </div>
                </div>
            </div>
        </section>
        
        <section id="setup" class="setup">
            <div class="container">
                <h2>Setup</h2>
                <div class="setup-list">
                    <div class="setup-card">
                        <h3>Claude.ai / Claude Desktop</h3>
                        <ol>
                            <li>Go to <strong>Settings</strong> → <strong>Integrations</strong></li>
                            <li>Click <strong>Add Integration</strong></li>
                            <li>Enter the URL below and click <strong>Add</strong></li>
                            <li>Authenticate with Last.fm when prompted</li>
                        </ol>
                        <div class="code-wrap">
                            <code>https://lastfm-mcp.com/mcp</code>
                            <button class="copy-btn" onclick="copyCode(this)">Copy</button>
                        </div>
                    </div>
                    <div class="setup-card">
                        <h3>Windsurf / Antigravity</h3>
                        <p class="config-path">~/.codeium/windsurf/mcp_config.json</p>
                        <div class="code-wrap">
                            <code>{
  "mcpServers": {
    "lastfm": {
      "serverUrl": "https://lastfm-mcp.com/mcp"
    }
  }
}</code>
                            <button class="copy-btn" onclick="copyCode(this)">Copy</button>
                        </div>
                    </div>
                    <div class="setup-card">
                        <h3>Claude Code / OpenCode</h3>
                        <p>Run this command in your terminal:</p>
                        <div class="code-wrap">
                            <code>claude mcp add --transport http lastfm https://lastfm-mcp.com/mcp</code>
                            <button class="copy-btn" onclick="copyCode(this)">Copy</button>
                        </div>
                    </div>
                    <div class="setup-card">
                        <h3>Cursor</h3>
                        <p class="config-path">~/.cursor/mcp.json</p>
                        <div class="code-wrap">
                            <code>{
  "mcpServers": {
    "lastfm": {
      "url": "https://lastfm-mcp.com/mcp"
    }
  }
}</code>
                            <button class="copy-btn" onclick="copyCode(this)">Copy</button>
                        </div>
                    </div>
                    <div class="setup-card">
                        <h3>Continue.dev / Zed / Other MCP Clients</h3>
                        <p>Use mcp-remote for clients that don't support HTTP transport natively:</p>
                        <div class="code-wrap">
                            <code>{
  "mcpServers": {
    "lastfm": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://lastfm-mcp.com/mcp"]
    }
  }
}</code>
                            <button class="copy-btn" onclick="copyCode(this)">Copy</button>
                        </div>
                    </div>
                </div>
            </div>
        </section>
        
        <section id="tools" class="tools">
            <div class="container">
                <h2>Available Tools</h2>
                <div class="tool-cols">
                    <div class="tool-col">
                        <h3>Public (no auth)</h3>
                        <ul>
                            <li>get_track_info</li>
                            <li>get_artist_info</li>
                            <li>get_album_info</li>
                            <li>get_similar_artists</li>
                            <li>get_similar_tracks</li>
                        </ul>
                    </div>
                    <div class="tool-col">
                        <h3>Personal (auth required)</h3>
                        <ul>
                            <li>get_recent_tracks</li>
                            <li>get_top_artists</li>
                            <li>get_top_albums</li>
                            <li>get_loved_tracks</li>
                            <li>get_listening_stats</li>
                            <li>get_music_recommendations</li>
                        </ul>
                    </div>
                    <div class="tool-col">
                        <h3>Temporal</h3>
                        <ul>
                            <li>get_weekly_chart_list</li>
                            <li>get_weekly_artist_chart</li>
                            <li>get_weekly_track_chart</li>
                        </ul>
                    </div>
                </div>
            </div>
        </section>
    </main>
    
    <footer>
        <div class="container">
            <div class="footer-links">
                <a href="https://github.com/rianvdm/lastfm-mcp">Source Code</a>
                <a href="https://github.com/rianvdm/lastfm-mcp#readme">Documentation</a>
                <a href="https://github.com/rianvdm/lastfm-mcp/issues">Report a Bug</a>
                <a href="https://github.com/rianvdm/lastfm-mcp/discussions">Discussions</a>
            </div>
            <p class="footer-note">Open source under MIT. Built on <a href="https://www.last.fm/api">Last.fm API</a> and <a href="https://modelcontextprotocol.io">MCP</a>.</p>
        </div>
    </footer>
    <script>
        function copyCode(btn) {
            const code = btn.previousElementSibling.textContent;
            navigator.clipboard.writeText(code).then(() => {
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = 'Copy';
                    btn.classList.remove('copied');
                }, 2000);
            });
        }
    </script>
</body>
</html>`
