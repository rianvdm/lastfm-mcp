/**
 * ABOUTME: Static HTML marketing page content for Last.fm MCP Server
 * ABOUTME: Serves as the landing page at the root URL to showcase the project
 */

export const MARKETING_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Last.fm MCP Server - Model Context Protocol for Last.fm API | Claude AI Integration</title>
    <meta name="description" content="Official Last.fm MCP Server for Claude Desktop. Connect AI assistants to Last.fm listening data. Get music insights, temporal queries, recommendations. Open source Model Context Protocol implementation.">
    <meta name="keywords" content="Last.fm MCP server, Model Context Protocol, Last.fm API, Claude Desktop, Claude AI, MCP tools, music data API, Last.fm integration, AI music assistant, listening history API, temporal music queries, mcp-remote, Anthropic MCP">
    <link rel="canonical" href="https://lastfm-mcp.com">
    
    <!-- Open Graph for social sharing -->
    <meta property="og:title" content="Last.fm MCP Server - Official Model Context Protocol Implementation">
    <meta property="og:description" content="Connect Claude AI to your Last.fm data. Temporal queries, music insights, recommendations. Open source MCP server with 18+ tools.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://lastfm-mcp.com">
    <meta property="og:image" content="https://file.elezea.com/lastfm-img.jpg">
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Last.fm MCP Server - Model Context Protocol for Music Data">
    <meta name="twitter:description" content="Connect AI assistants to Last.fm. Temporal queries like 'When did I start listening to X?' Open source.">
    <meta name="twitter:image" content="https://file.elezea.com/lastfm-img.jpg">
    
    <!-- Additional SEO -->
    <meta name="robots" content="index, follow">
    <meta name="author" content="Last.fm MCP Server Contributors">
    <link rel="alternate" type="application/json" href="https://lastfm-mcp-prod.rian-db8.workers.dev/api">
    
    <!-- Schema.org structured data -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "Last.fm MCP Server",
      "applicationCategory": "DeveloperApplication",
      "operatingSystem": "Cross-platform",
      "description": "Model Context Protocol server that bridges AI assistants with Last.fm music data. Features temporal queries, listening insights, and music recommendations.",
      "url": "https://lastfm-mcp.com",
      "author": {
        "@type": "Organization",
        "name": "Last.fm MCP Contributors",
        "url": "https://github.com/rianvdm/lastfm-mcp"
      },
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD"
      },
      "softwareVersion": "1.0.0",
      "softwareHelp": "https://github.com/rianvdm/lastfm-mcp#readme",
      "downloadUrl": "https://github.com/rianvdm/lastfm-mcp",
      "keywords": "Last.fm, MCP, Model Context Protocol, Claude AI, API, music data, temporal queries",
      "license": "https://opensource.org/licenses/MIT",
      "isAccessibleForFree": true,
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "5",
        "ratingCount": "1"
      }
    }
    </script>
    
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 20px;
        }
        
        header {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            padding: 1rem 0;
            position: sticky;
            top: 0;
            z-index: 100;
        }
        
        .header-content {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .logo {
            font-size: 1.5rem;
            font-weight: bold;
            color: white;
            text-decoration: none;
        }
        
        .nav-links {
            display: flex;
            gap: 2rem;
        }
        
        .nav-links a {
            color: white;
            text-decoration: none;
            opacity: 0.9;
            transition: opacity 0.3s;
        }
        
        .nav-links a:hover {
            opacity: 1;
        }
        
        .hero {
            text-align: center;
            padding: 4rem 0 6rem;
            color: white;
        }
        
        .hero h1 {
            font-size: 3.5rem;
            margin-bottom: 1rem;
            font-weight: 700;
        }
        
        .hero .subtitle {
            font-size: 1.3rem;
            margin-bottom: 2rem;
            opacity: 0.9;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
        }
        
        .badges {
            display: flex;
            justify-content: center;
            gap: 0.5rem;
            margin-bottom: 3rem;
            flex-wrap: wrap;
        }
        
        .badge {
            background: rgba(255, 255, 255, 0.2);
            padding: 0.3rem 0.8rem;
            border-radius: 20px;
            font-size: 0.85rem;
            backdrop-filter: blur(10px);
        }
        
        .cta-buttons {
            display: flex;
            gap: 1rem;
            justify-content: center;
            margin-bottom: 3rem;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 1rem 2rem;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.3s;
            border: none;
            cursor: pointer;
            font-size: 1rem;
        }
        
        .btn-primary {
            background: #ff6b6b;
            color: white;
            box-shadow: 0 4px 15px rgba(255, 107, 107, 0.4);
        }
        
        .btn-primary:hover {
            background: #ff5252;
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(255, 107, 107, 0.6);
        }
        
        .btn-secondary {
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.3);
            backdrop-filter: blur(10px);
        }
        
        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: translateY(-2px);
        }
        
        .demo-video {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 2rem;
            backdrop-filter: blur(10px);
            margin-bottom: 2rem;
        }
        
        .demo-video h3 {
            margin-bottom: 1rem;
            font-size: 1.2rem;
        }
        
        .demo-video p {
            opacity: 0.9;
            margin-bottom: 1rem;
        }
        
        .features {
            background: white;
            padding: 5rem 0;
        }
        
        .features h2 {
            text-align: center;
            font-size: 2.5rem;
            margin-bottom: 3rem;
            color: #333;
        }
        
        .feature-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
            margin-bottom: 3rem;
        }
        
        .feature-card {
            background: #f8f9fa;
            padding: 2rem;
            border-radius: 12px;
            text-align: center;
            border: 1px solid #e9ecef;
            transition: transform 0.3s, box-shadow 0.3s;
        }
        
        .feature-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        
        .feature-icon {
            font-size: 3rem;
            margin-bottom: 1rem;
        }
        
        .feature-card h3 {
            font-size: 1.3rem;
            margin-bottom: 1rem;
            color: #333;
        }
        
        .feature-card p {
            color: #666;
            line-height: 1.6;
        }
        
        .setup {
            background: #f8f9fa;
            padding: 5rem 0;
        }
        
        .setup h2 {
            text-align: center;
            font-size: 2.5rem;
            margin-bottom: 3rem;
            color: #333;
        }
        
        .setup-steps {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 2rem;
            margin-bottom: 3rem;
        }
        
        .step {
            text-align: center;
        }
        
        .step-number {
            width: 60px;
            height: 60px;
            background: #667eea;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            font-weight: bold;
            margin: 0 auto 1rem;
        }
        
        .step h3 {
            margin-bottom: 1rem;
            color: #333;
        }
        
        .step p {
            color: #666;
        }
        
        .code-block {
            background: #2d3748;
            color: #e2e8f0;
            padding: 1.5rem;
            border-radius: 8px;
            margin: 2rem 0;
            overflow-x: auto;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        }
        
        .code-block pre {
            margin: 0;
        }
        
        .examples {
            background: white;
            padding: 5rem 0;
        }
        
        .examples h2 {
            text-align: center;
            font-size: 2.5rem;
            margin-bottom: 3rem;
            color: #333;
        }
        
        .example-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
        }
        
        .example-card {
            background: #f8f9fa;
            padding: 2rem;
            border-radius: 12px;
            border-left: 4px solid #667eea;
        }
        
        .example-card h4 {
            color: #667eea;
            margin-bottom: 0.5rem;
            font-size: 1.1rem;
        }
        
        .example-card p {
            color: #666;
            font-style: italic;
            margin-bottom: 1rem;
        }
        
        .example-card .result {
            background: white;
            padding: 1rem;
            border-radius: 6px;
            border: 1px solid #e9ecef;
            color: #333;
            font-size: 0.9rem;
        }
        
        footer {
            background: #2d3748;
            color: white;
            padding: 3rem 0;
            text-align: center;
        }
        
        .footer-content {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 2rem;
            margin-bottom: 2rem;
        }
        
        .footer-section h4 {
            margin-bottom: 1rem;
            color: #667eea;
        }
        
        .footer-section a {
            color: #cbd5e0;
            text-decoration: none;
            display: block;
            margin-bottom: 0.5rem;
        }
        
        .footer-section a:hover {
            color: white;
        }
        
        .footer-bottom {
            border-top: 1px solid #4a5568;
            padding-top: 2rem;
            color: #a0aec0;
        }
        
        @media (max-width: 768px) {
            .hero h1 {
                font-size: 2.5rem;
            }
            
            .hero .subtitle {
                font-size: 1.1rem;
            }
            
            .cta-buttons {
                flex-direction: column;
                align-items: center;
            }
            
            .nav-links {
                display: none;
            }
        }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <div class="header-content">
                <a href="#" class="logo">🎵 Last.fm MCP</a>
                <nav class="nav-links">
                    <a href="#features">Features</a>
                    <a href="#setup">Setup</a>
                    <a href="#examples">Examples</a>
                    <a href="https://github.com/rianvdm/lastfm-mcp">GitHub</a>
                </nav>
            </div>
        </div>
    </header>
    
    <section class="hero">
        <div class="container">
            <h1>Last.fm MCP Server - Model Context Protocol for Claude AI</h1>
            <p class="subtitle">
                A robust MCP implementation for Last.fm API integration. Connect Claude Desktop and other AI assistants to your Last.fm listening data. Features temporal queries ("When did I start listening to...?"), music insights, and 18+ specialized tools.
            </p>
            
            <div class="badges">
                <span class="badge">🤖 AI-Powered</span>
                <span class="badge">🔐 Secure Auth</span>
                <span class="badge">⚡ Global Edge</span>
                <span class="badge">📊 Rich Analytics</span>
                <span class="badge">🆓 Open Source</span>
            </div>
            
            <div class="cta-buttons">
                <a href="#setup" class="btn btn-primary">Get Started</a>
                <a href="https://github.com/rianvdm/lastfm-mcp" class="btn btn-secondary">View on GitHub</a>
            </div>
            
            <div class="demo-video">
                <h3>✨ Ask Claude about your music</h3>
                <p>"When did I start listening to Led Zeppelin?" • "What was I obsessed with in summer 2023?" • "Find artists similar to my favorites"</p>
            </div>
        </div>
    </section>
    
    <section id="features" class="features">
        <div class="container">
            <h2>🌟 Features</h2>
            <div class="feature-grid">
                <div class="feature-card">
                    <div class="feature-icon">🎧</div>
                    <h3>Personal Music Data</h3>
                    <p>Access your recent tracks, top artists, albums, and loved tracks with full pagination support.</p>
                </div>
                
                <div class="feature-card">
                    <div class="feature-icon">🕰️</div>
                    <h3>Temporal Queries</h3>
                    <p>Explore your musical journey over time. Ask when you started listening to artists or what you loved in any time period.</p>
                </div>
                
                <div class="feature-card">
                    <div class="feature-icon">🔍</div>
                    <h3>Music Discovery</h3>
                    <p>Find similar artists and tracks, get personalized recommendations, and discover new music based on your taste.</p>
                </div>
                
                <div class="feature-card">
                    <div class="feature-icon">📊</div>
                    <h3>Rich Analytics</h3>
                    <p>Comprehensive listening statistics, charts, and insights about your musical preferences and habits.</p>
                </div>
                
                <div class="feature-card">
                    <div class="feature-icon">🔐</div>
                    <h3>Secure & Private</h3>
                    <p>Last.fm Web Authentication with 7-day JWT sessions. Your data stays secure with proper session management.</p>
                </div>
                
                <div class="feature-card">
                    <div class="feature-icon">⚡</div>
                    <h3>Production Ready</h3>
                    <p>Smart caching, rate limiting, retry logic, and global edge deployment on Cloudflare Workers.</p>
                </div>
            </div>
        </div>
    </section>
    
    <section id="setup" class="setup">
        <div class="container">
            <h2>🚀 Quick Setup</h2>
            <div class="setup-steps">
                <div class="step">
                    <div class="step-number">1</div>
                    <h3>Add Server</h3>
                    <p>Connect via Claude Desktop Connectors UI or your preferred MCP client</p>
                </div>
                
                <div class="step">
                    <div class="step-number">2</div>
                    <h3>Authenticate</h3>
                    <p>Connect your Last.fm account through secure web authentication</p>
                </div>
                
                <div class="step">
                    <div class="step-number">3</div>
                    <h3>Start Exploring</h3>
                    <p>Ask Claude about your music and get AI-powered insights</p>
                </div>
            </div>
            
            <p style="text-align: center; margin-bottom: 1rem; margin-top: 3rem;"><strong>✨ Recommended: Claude Desktop Connectors UI</strong></p>
            <p style="text-align: center; color: #666; margin-bottom: 1rem;">The easiest way to connect - no configuration files needed!</p>
            <div style="text-align: center; margin: 2rem 0;">
                <ol style="display: inline-block; text-align: left; color: #333; line-height: 2;">
                    <li>Open Claude Desktop</li>
                    <li>Go to <strong>Settings → Connectors</strong></li>
                    <li>Click <strong>Add Connector</strong></li>
                    <li>Enter URL: <code style="background: #f0f0f0; padding: 2px 8px; border-radius: 4px;">https://lastfm-mcp-prod.rian-db8.workers.dev</code></li>
                    <li>Click <strong>Add</strong></li>
                </ol>
            </div>

            <p style="text-align: center; margin-bottom: 1rem; margin-top: 3rem;"><strong>💻 Claude Code (Terminal)</strong></p>
            <p style="text-align: center; color: #666; margin-bottom: 1rem;">One command to add the server</p>

            <div class="code-block">
                <pre>claude mcp add --transport http lastfm https://lastfm-mcp-prod.rian-db8.workers.dev</pre>
            </div>

            <p style="text-align: center; margin-bottom: 1rem; margin-top: 3rem;"><strong>🔧 Other MCP Clients</strong></p>
            <p style="text-align: center; color: #666; margin-bottom: 1rem;">Continue.dev, Zed, or custom implementations</p>

            <div class="code-block">
                <pre>{
  "mcpServers": {
    "lastfm": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://lastfm-mcp-prod.rian-db8.workers.dev"]
    }
  }
}</pre>
            </div>

            <p style="text-align: center; margin-bottom: 1rem; margin-top: 3rem;"><strong>🧪 Test with MCP Inspector</strong></p>
            <div class="code-block">
                <pre>npx @modelcontextprotocol/inspector https://lastfm-mcp-prod.rian-db8.workers.dev</pre>
            </div>
        </div>
    </section>
    
    <section id="examples" class="examples">
        <div class="container">
            <h2>💬 Ask Claude</h2>
            <div class="example-grid">
                <div class="example-card">
                    <h4>🕰️ Musical Timeline</h4>
                    <p>"When did I start listening to Led Zeppelin?"</p>
                    <div class="result">Claude analyzes your weekly charts and finds you first played "Stairway to Heaven" in March 2019, with your listening peak during summer 2020.</div>
                </div>
                
                <div class="example-card">
                    <h4>📊 Listening Insights</h4>
                    <p>"What was I obsessed with in 2023?"</p>
                    <div class="result">Based on your 2023 listening data, you were heavily into indie rock with Arctic Monkeys being your top artist (847 plays), followed by a Radiohead phase in fall.</div>
                </div>
                
                <div class="example-card">
                    <h4>🔍 Music Discovery</h4>
                    <p>"Find artists similar to my current favorites"</p>
                    <div class="result">Analyzing your top artists, I recommend Fontaines D.C., Dry Cleaning, and Black Midi - they share the post-punk revival sound you've been loving lately.</div>
                </div>
                
                <div class="example-card">
                    <h4>📈 Trend Analysis</h4>
                    <p>"How has my music taste evolved over time?"</p>
                    <div class="result">Your taste has shifted from mainstream pop (2018-2019) → indie rock (2020-2021) → experimental electronic (2022) → current indie/alternative focus. You're exploring more diverse genres each year!</div>
                </div>
            </div>
        </div>
    </section>
    
    <footer>
        <div class="container">
            <div class="footer-content">
                <div class="footer-section">
                    <h4>🔗 Resources</h4>
                    <a href="https://github.com/rianvdm/lastfm-mcp">GitHub Repository</a>
                    <a href="https://github.com/rianvdm/lastfm-mcp/releases">Releases</a>
                    <a href="https://github.com/rianvdm/lastfm-mcp#readme">Documentation</a>
                    <a href="https://github.com/rianvdm/lastfm-mcp/issues">Report Issues</a>
                </div>
                
                <div class="footer-section">
                    <h4>🛠️ Technology</h4>
                    <a href="https://github.com/modelcontextprotocol">Model Context Protocol</a>
                    <a href="https://workers.cloudflare.com/">Cloudflare Workers</a>
                    <a href="https://www.last.fm/api">Last.fm API</a>
                    <a href="https://claude.ai">Claude AI</a>
                </div>
                
                <div class="footer-section">
                    <h4>📞 Connect</h4>
                    <a href="/login">🔐 Authenticate with Last.fm</a>
                    <a href="/health">📊 Service Status</a>
                    <a href="https://github.com/rianvdm/lastfm-mcp/discussions">💬 Discussions</a>
                    <a href="https://github.com/rianvdm">👨‍💻 Creator</a>
                </div>
            </div>
            
            <div class="footer-bottom">
                <p>🎵 Built with ❤️ for music lovers and AI enthusiasts</p>
                <p>Open source under MIT License • <a href="https://github.com/rianvdm/lastfm-mcp">Star on GitHub</a></p>
            </div>
        </div>
    </footer>
</body>
</html>`