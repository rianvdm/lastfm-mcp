// ABOUTME: Static HTML marketing page content for Last.fm MCP Server.
// ABOUTME: Serves as the landing page at the root URL to showcase the project.

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
    <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">

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
            --glass-bg: rgba(20, 20, 22, 0.6);
            --glass-border: rgba(255, 255, 255, 0.08);
            --glass-blur: 12px;
            --glow-red: rgba(213, 16, 7, 0.3);
            --glow-orange: rgba(255, 140, 50, 0.3);
            --glow-blue: rgba(60, 120, 255, 0.3);
            --glow-purple: rgba(168, 85, 247, 0.3);
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
        .container-wide { max-width: 960px; margin: 0 auto; padding: 0 24px; }

        header {
            border-bottom: 1px solid var(--border);
            padding: 16px 0;
            position: relative;
            z-index: 10;
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
            box-shadow: 0 0 8px var(--glow-red);
        }

        nav { display: flex; gap: 24px; }

        nav a {
            color: var(--text-muted);
            text-decoration: none;
            font-size: 0.9rem;
            transition: color 0.2s;
        }

        nav a:hover { color: var(--text); }

        /* Hero */
        .hero {
            padding: 80px 0 60px;
            text-align: center;
            position: relative;
            overflow: hidden;
        }

        .hero canvas {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            opacity: 0.7;
        }

        @media (prefers-reduced-motion: reduce) {
            .hero canvas { display: none; }
        }

        .hero .container {
            position: relative;
            z-index: 1;
        }

        .hero h1 {
            font-size: 3.5rem;
            font-weight: 700;
            margin-bottom: 20px;
            letter-spacing: -0.03em;
            line-height: 1.1;
        }

        .hero h1 span { color: var(--lastfm-red); }

        .hero p {
            color: var(--text-muted);
            font-size: 1.1rem;
            max-width: 540px;
            margin: 0 auto 16px;
        }

        .hero p.hero-mcp-note {
            color: var(--text-dim);
            font-size: 0.75rem;
            margin: 0 auto 32px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--glass-bg);
            border: 1px solid var(--glass-border);
            backdrop-filter: blur(var(--glass-blur));
            -webkit-backdrop-filter: blur(var(--glass-blur));
            border-radius: 100px;
            padding: 6px 14px;
            max-width: none;
        }

        .hero-mcp-note i {
            font-size: 0.8rem;
            color: var(--text-dim);
        }

        .cta-row {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
        }

        .btn {
            padding: 14px 28px;
            border-radius: 8px;
            font-size: 0.95rem;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.3s;
            border: none;
            cursor: pointer;
        }

        .btn-primary {
            background: var(--lastfm-red);
            color: white;
            box-shadow: 0 0 20px rgba(213, 16, 7, 0.3);
        }

        .btn-primary:hover {
            background: var(--lastfm-red-dark);
            box-shadow: 0 0 30px rgba(213, 16, 7, 0.5);
        }

        .btn-secondary {
            background: var(--glass-bg);
            color: var(--text);
            border: 1px solid var(--glass-border);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        }

        .btn-secondary:hover {
            background: var(--bg-card-hover);
            border-color: var(--text-dim);
        }

        /* Sections */
        section { padding: 80px 0; }

        section h2 {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 40px;
            letter-spacing: -0.02em;
        }

        /* How it works */
        .how-it-works {
            border-top: 1px solid var(--border);
        }

        .steps {
            display: flex;
            align-items: stretch;
            justify-content: center;
            gap: 0;
        }

        .step {
            text-align: center;
            flex: 1;
            max-width: 240px;
            background: var(--glass-bg);
            backdrop-filter: blur(var(--glass-blur));
            -webkit-backdrop-filter: blur(var(--glass-blur));
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            padding: 32px 24px;
            transition: all 0.3s;
        }

        .step:hover {
            border-color: rgba(213, 16, 7, 0.3);
            box-shadow: 0 0 30px var(--glow-red), 0 0 60px rgba(213, 16, 7, 0.1);
        }

        .step-icon {
            width: 64px;
            height: 64px;
            border-radius: 16px;
            background: rgba(213, 16, 7, 0.12);
            box-shadow: 0 0 20px rgba(213, 16, 7, 0.15);
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 16px;
        }

        .step-icon i {
            font-size: 1.6rem;
            color: var(--lastfm-red);
        }

        .step-label {
            font-size: 1rem;
            font-weight: 600;
            color: var(--text);
            margin-bottom: 8px;
        }

        .step-desc {
            font-size: 0.85rem;
            color: var(--text-muted);
            line-height: 1.4;
        }

        .step-arrow {
            display: flex;
            align-items: center;
            padding-top: 14px;
            color: var(--text-dim);
            font-size: 1.2rem;
            flex-shrink: 0;
            margin: 0 12px;
        }

        /* Things you can ask */
        .queries {
            border-top: 1px solid var(--border);
        }

        .query-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
        }

        .query {
            position: relative;
            background: var(--glass-bg);
            backdrop-filter: blur(var(--glass-blur));
            -webkit-backdrop-filter: blur(var(--glass-blur));
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            padding: 28px;
            transition: all 0.3s;
        }

        .query:hover {
            background: var(--bg-card-hover);
        }

        .query:nth-child(1):hover { border-color: rgba(213, 16, 7, 0.4); box-shadow: 0 0 40px rgba(213, 16, 7, 0.15); }
        .query:nth-child(2):hover { border-color: rgba(255, 140, 50, 0.4); box-shadow: 0 0 40px rgba(255, 140, 50, 0.15); }
        .query:nth-child(3):hover { border-color: rgba(60, 120, 255, 0.4); box-shadow: 0 0 40px rgba(60, 120, 255, 0.15); }
        .query:nth-child(4):hover { border-color: rgba(168, 85, 247, 0.4); box-shadow: 0 0 40px rgba(168, 85, 247, 0.15); }

        .query-number {
            position: absolute;
            top: -12px;
            left: 20px;
            width: 28px;
            height: 28px;
            border-radius: 50%;
            color: white;
            font-size: 0.8rem;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .query:nth-child(1) .query-number { background: linear-gradient(135deg, #d51007, #ff6b35); }
        .query:nth-child(2) .query-number { background: linear-gradient(135deg, #ff6b35, #ffb347); }
        .query:nth-child(3) .query-number { background: linear-gradient(135deg, #3c78ff, #60a5fa); }
        .query:nth-child(4) .query-number { background: linear-gradient(135deg, #a855f7, #c084fc); }

        .query-icon {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: rgba(213, 16, 7, 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            margin-bottom: 12px;
        }

        .query-icon i {
            font-size: 1rem;
            color: var(--lastfm-red);
        }

        .query q {
            color: var(--text);
            font-size: 1rem;
            font-style: normal;
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
        }

        .query q::before { content: '\\201C'; color: var(--lastfm-red); }
        .query q::after { content: '\\201D'; color: var(--lastfm-red); }

        .query span {
            color: var(--text-muted);
            font-size: 0.85rem;
        }

        /* Setup */
        .setup {
            border-top: 1px solid var(--border);
        }

        .setup-list {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
        }

        .setup-card {
            background: var(--glass-bg);
            backdrop-filter: blur(var(--glass-blur));
            -webkit-backdrop-filter: blur(var(--glass-blur));
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            padding: 24px;
            min-width: 0;
            overflow: hidden;
            transition: all 0.3s;
        }

        .setup-card:hover {
            border-color: rgba(255, 255, 255, 0.15);
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
            border-radius: 8px;
            padding: 12px 40px 12px 12px;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 0.75rem;
            color: var(--text);
            overflow-x: auto;
            white-space: pre;
            min-height: 44px;
            max-width: 100%;
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

        /* Available Tools */
        .tools {
            border-top: 1px solid var(--border);
        }

        .tool-cols {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
        }

        .tool-col {
            background: var(--glass-bg);
            backdrop-filter: blur(var(--glass-blur));
            -webkit-backdrop-filter: blur(var(--glass-blur));
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            padding: 24px;
            transition: all 0.3s;
        }

        .tool-col:hover {
            border-color: rgba(255, 255, 255, 0.12);
        }

        .tool-col h3 {
            font-size: 0.8rem;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-dim);
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--glass-border);
        }

        .tool-col h3 i {
            font-size: 0.85rem;
            margin-right: 6px;
            vertical-align: -1px;
        }

        .tool-col ul {
            list-style: none;
        }

        .tool-col li {
            color: var(--text-muted);
            font-size: 0.9rem;
            padding: 6px 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }

        .tool-col li:last-child { border-bottom: none; }

        /* Footer */
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

        .footer-links a i {
            font-size: 1rem;
            vertical-align: -2px;
            margin-right: 4px;
        }

        /* Mobile */
        @media (max-width: 640px) {
            .hero { padding: 48px 0 40px; }
            .hero h1 { font-size: 2.2rem; }
            .hero p { font-size: 1rem; }
            section { padding: 48px 0; }
            section h2 { font-size: 1.5rem; margin-bottom: 28px; }
            nav { gap: 16px; }
            .cta-row { flex-direction: column; align-items: center; }
            .btn { width: 100%; max-width: 280px; text-align: center; }
            .steps { flex-direction: column; align-items: center; gap: 16px; }
            .step-arrow { transform: rotate(90deg); margin: 0; }
            .step { max-width: 100%; }
            .query-grid { grid-template-columns: 1fr; }
            .setup-list { grid-template-columns: 1fr; }
            .tool-cols { grid-template-columns: 1fr; }
            .container-wide { max-width: 100%; }
            .hero-mcp-note { font-size: 0.8rem; }
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
            <canvas id="waveCanvas"></canvas>
            <div class="container">
                <h1>Connect <span>AI</span> to your music</h1>
                <p>An MCP server that lets Claude and other AI assistants access your Last.fm listening history. Ask questions about your music taste, discover patterns, find new artists.</p>
                <p class="hero-mcp-note"><i class="ph ph-info"></i> MCP (Model Context Protocol) lets AI apps connect to external data sources securely.</p>
                <div class="cta-row">
                    <a href="#setup" class="btn btn-primary">Get Started</a>
                    <a href="https://github.com/rianvdm/lastfm-mcp" class="btn btn-secondary">View Source</a>
                </div>
            </div>
        </section>

        <section class="how-it-works">
            <div class="container">
                <h2>How it works</h2>
                <div class="steps">
                    <div class="step">
                        <div class="step-icon"><i class="ph ph-plug"></i></div>
                        <div class="step-label">Add to your AI client</div>
                        <div class="step-desc">One URL, works with Claude, Cursor, Windsurf, and more</div>
                    </div>
                    <div class="step-arrow"><i class="ph ph-arrow-right"></i></div>
                    <div class="step">
                        <div class="step-icon"><i class="ph ph-key"></i></div>
                        <div class="step-label">Sign in with Last.fm</div>
                        <div class="step-desc">Securely connect your account to unlock personal data</div>
                    </div>
                    <div class="step-arrow"><i class="ph ph-arrow-right"></i></div>
                    <div class="step">
                        <div class="step-icon"><i class="ph ph-chat-circle"></i></div>
                        <div class="step-label">Ask about your music</div>
                        <div class="step-desc">Your AI assistant can now explore your listening history</div>
                    </div>
                </div>
            </div>
        </section>

        <section class="queries">
            <div class="container">
                <h2>Things you can ask</h2>
                <div class="query-grid">
                    <div class="query">
                        <div class="query-number">1</div>
                        <div class="query-icon"><i class="ph ph-clock-counter-clockwise"></i></div>
                        <q>When did I start listening to Radiohead?</q>
                        <span>Searches your historical charts to find when an artist first appeared</span>
                    </div>
                    <div class="query">
                        <div class="query-number">2</div>
                        <div class="query-icon"><i class="ph ph-music-notes"></i></div>
                        <q>What was I obsessed with last summer?</q>
                        <span>Analyzes your listening data for any time period</span>
                    </div>
                    <div class="query">
                        <div class="query-number">3</div>
                        <div class="query-icon"><i class="ph ph-users-three"></i></div>
                        <q>Find artists similar to my top 5</q>
                        <span>Discovers new music based on your actual listening habits</span>
                    </div>
                    <div class="query">
                        <div class="query-number">4</div>
                        <div class="query-icon"><i class="ph ph-chart-line-up"></i></div>
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
                            <li>Go to <strong>Settings</strong> &rarr; <strong>Integrations</strong></li>
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
                        <h3>Claude Code</h3>
                        <p>Run this command in your terminal:</p>
                        <div class="code-wrap">
                            <code>claude mcp add --transport http lastfm https://lastfm-mcp.com/mcp</code>
                            <button class="copy-btn" onclick="copyCode(this)">Copy</button>
                        </div>
                    </div>
                    <div class="setup-card">
                        <h3>OpenCode</h3>
                        <p class="config-path">opencode.json</p>
                        <div class="code-wrap">
                            <code>{
  "mcp": {
    "lastfm": {
      "type": "remote",
      "url": "https://lastfm-mcp.com/mcp"
    }
  }
}</code>
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
                        <h3>Continue.dev / Other MCP Clients</h3>
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
                        <h3><i class="ph ph-globe"></i> Public (no auth)</h3>
                        <ul>
                            <li>get_track_info</li>
                            <li>get_artist_info</li>
                            <li>get_album_info</li>
                            <li>get_similar_artists</li>
                            <li>get_similar_tracks</li>
                        </ul>
                    </div>
                    <div class="tool-col">
                        <h3><i class="ph ph-user-circle"></i> Personal (auth required)</h3>
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
                        <h3><i class="ph ph-calendar-blank"></i> Temporal</h3>
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
                <a href="https://github.com/rianvdm/lastfm-mcp"><i class="ph ph-github-logo"></i>Source Code</a>
                <a href="https://github.com/rianvdm/lastfm-mcp#readme"><i class="ph ph-book-open"></i>Documentation</a>
                <a href="https://github.com/rianvdm/lastfm-mcp/releases"><i class="ph ph-tag"></i>Release Notes</a>
                <a href="https://github.com/rianvdm/lastfm-mcp/issues"><i class="ph ph-bug"></i>Report a Bug</a>
            </div>
            <p class="footer-note">Open source under MIT. Built on <a href="https://www.last.fm/api">Last.fm API</a> and <a href="https://modelcontextprotocol.io">MCP</a>.</p>
        </div>
    </footer>
    <script>
        function copyCode(btn) {
            var code = btn.previousElementSibling.textContent;
            navigator.clipboard.writeText(code).then(function() {
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                setTimeout(function() {
                    btn.textContent = 'Copy';
                    btn.classList.remove('copied');
                }, 2000);
            });
        }

        (function() {
            var canvas = document.getElementById('waveCanvas');
            if (!canvas) return;
            var ctx = canvas.getContext('2d');
            var dpr = window.devicePixelRatio || 1;

            function resize() {
                var w = canvas.offsetWidth;
                var h = canvas.offsetHeight;
                canvas.width = w * dpr;
                canvas.height = h * dpr;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
            resize();
            window.addEventListener('resize', resize);

            var waves = [
                { r: 213, g: 16, b: 7, alpha: 0.4, amp: 50, freq: 0.008, speed: 0.008, offset: 0 },
                { r: 255, g: 140, b: 50, alpha: 0.3, amp: 40, freq: 0.006, speed: 0.006, offset: 2 },
                { r: 60, g: 120, b: 255, alpha: 0.25, amp: 35, freq: 0.01, speed: 0.01, offset: 4 }
            ];

            var t = 0;
            var running = true;

            // Respect prefers-reduced-motion
            var mql = window.matchMedia('(prefers-reduced-motion: reduce)');
            if (mql.matches) running = false;
            mql.addEventListener('change', function(e) { running = !e.matches; });

            function draw() {
                if (!running) { requestAnimationFrame(draw); return; }
                var w = canvas.offsetWidth;
                var h = canvas.offsetHeight;
                ctx.clearRect(0, 0, w, h);
                var mid = h * 0.55;

                for (var i = 0; i < waves.length; i++) {
                    var wave = waves[i];
                    ctx.beginPath();
                    ctx.moveTo(0, h);
                    for (var x = 0; x <= w; x += 2) {
                        var y = mid + Math.sin(x * wave.freq + t * wave.speed + wave.offset) * wave.amp
                                + Math.sin(x * wave.freq * 0.5 + t * wave.speed * 1.3) * wave.amp * 0.5;
                        ctx.lineTo(x, y);
                    }
                    ctx.lineTo(w, h);
                    ctx.closePath();

                    var grad = ctx.createLinearGradient(0, mid - wave.amp, 0, h);
                    grad.addColorStop(0, 'rgba(' + wave.r + ',' + wave.g + ',' + wave.b + ',' + wave.alpha + ')');
                    grad.addColorStop(1, 'rgba(' + wave.r + ',' + wave.g + ',' + wave.b + ',0.05)');
                    ctx.fillStyle = grad;
                    ctx.fill();
                }

                t++;
                requestAnimationFrame(draw);
            }
            draw();
        })();
    </script>
</body>
</html>`;
