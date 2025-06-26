/**
 * ABOUTME: Static HTML marketing page content for Last.fm MCP Server
 * ABOUTME: Serves as the landing page at the root URL to showcase the project
 */

export const MARKETING_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎵 Last.fm MCP Server - Bridge AI with Your Music</title>
    <meta name="description" content="Connect AI assistants like Claude to your Last.fm listening data. Get insights, recommendations, and explore your musical journey with AI.">
    <meta name="keywords" content="Last.fm, MCP, AI, Claude, music, listening, analytics, recommendations">
    
    <!-- Open Graph for social sharing -->
    <meta property="og:title" content="Last.fm MCP Server - Bridge AI with Your Music">
    <meta property="og:description" content="Connect AI assistants to your Last.fm data for personalized music insights and recommendations.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://lastfm-mcp-prod.rian-db8.workers.dev">
    
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
            <h1>🎵 Last.fm MCP Server</h1>
            <p class="subtitle">
                Bridge AI assistants with your Last.fm music data. Get personalized insights, discover new music, and explore your listening journey with the power of AI.
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
                    <h3>Add to Claude Desktop</h3>
                    <p>Configure the MCP server in your Claude Desktop settings</p>
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
            
            <p style="text-align: center; margin-bottom: 2rem;"><strong>Add this to your Claude Desktop settings (Settings → Developer → Edit config):</strong></p>
            
            <div class="code-block">
                <pre>{
  "mcpServers": {
    "lastfm": {
      "command": "npx",
      "args": ["mcp-remote", "https://lastfm-mcp-prod.rian-db8.workers.dev/sse"]
    }
  }
}</pre>
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