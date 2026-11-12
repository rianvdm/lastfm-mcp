# Last.fm MCP

> A remote MCP server that connects AI assistants to a person's Last.fm listening history: scrobbles, charts, loved tracks, and artist, album and track lookups. It only reads; it can't change the Last.fm account.

## For agents setting this up

- Server URL: `{{ORIGIN}}/mcp`
- Transport: streamable HTTP. Authentication: OAuth, with Client ID Metadata Documents and Dynamic Client Registration.
- No Last.fm API key, token or other config is needed. The URL is the only setting.

Steps:

1. Ask the human which app they use, if you don't know. Find it under "Setup by client".
2. Add the server with the command or config shown there. If the config file already exists, add the `lastfm` entry to it; don't remove other servers.
3. You can't complete the Last.fm sign-in: it happens in the human's browser. Your last step is to tell the human exactly how to sign in for their app, using the sign-in line in its section. For Claude Code: start Claude Code, run `/mcp`, choose `lastfm`, then `Authenticate`, and sign in to Last.fm in the browser.

## Setup by client

### Claude Code

Run this in a terminal:

```sh
claude mcp add --scope user --transport http lastfm {{ORIGIN}}/mcp
```

`--scope user` makes the server available in every project. Without it, it only works in the folder where the command ran.

Sign-in: start Claude Code, run `/mcp`, choose `lastfm`, then `Authenticate`, and sign in to Last.fm in the browser. Running `claude mcp login lastfm` in a terminal starts the same sign-in.

### Claude app (desktop or claude.ai)

An agent can't do these steps. Tell the human:

1. Open Claude (desktop app or claude.ai) and go to **Customize → Connectors**.
2. Click **Add**, then **Add custom connector**. Name it Last.fm, paste `{{ORIGIN}}/mcp`, and click **Continue**.
3. Leave the sign-in settings as they are and click **Add**, then **Connect**, and sign in to Last.fm.
4. Start a new chat and ask something. If a chat doesn't use it, click **+** in the chat, choose **Connectors** and turn Last.fm on.

On the Free plan you can add one custom connector. On Team and Enterprise plans, an Owner adds it under **Organization settings → Connectors**, then each member clicks **Connect**.

### ChatGPT

An agent can't do this setup. Tell the human: it works only on ChatGPT Business, Enterprise or Edu, on the web. A workspace admin or owner adds `{{ORIGIN}}/mcp` under Plugins → + → Add custom MCP server with OAuth and publishes it to the workspace; once the admin gives them access, they install Last.fm from Plugins and sign in to Last.fm. Details: https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt. Other ChatGPT plans aren't supported yet.

For a workspace admin or owner:

1. Open ChatGPT on the web and go to **Plugins** (chatgpt.com/plugins).
2. Click **+**, then **Add custom MCP server**.
3. Name it Last.fm and paste `{{ORIGIN}}/mcp` as the **Server URL**.
4. Choose **OAuth** for authentication, read the warning, then click **I understand and want to continue** and **Create as a plugin**.
5. Publish it to the workspace.

Once the admin gives a member access:

1. In ChatGPT on the web, open **Plugins**, find Last.fm and install it.
2. Sign in to Last.fm when ChatGPT asks.
3. In a chat, type **@** and pick Last.fm.

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.lastfm]
url = "{{ORIGIN}}/mcp"
```

Or run `codex mcp add lastfm --url {{ORIGIN}}/mcp`.

Sign-in: run `codex mcp login lastfm` and sign in to Last.fm in the browser.

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
	"mcpServers": {
		"lastfm": {
			"url": "{{ORIGIN}}/mcp"
		}
	}
}
```

Sign-in: Cursor then asks the human to sign in to Last.fm.

### Devin Desktop (formerly Windsurf)

Add to `~/.config/devin/mcp_config.json`:

```json
{
	"mcpServers": {
		"lastfm": {
			"url": "{{ORIGIN}}/mcp"
		}
	}
}
```

Sign-in: run `devin mcp login lastfm` and sign in to Last.fm in the browser.

### OpenCode

Add to `opencode.json`:

```json
{
	"mcp": {
		"lastfm": {
			"type": "remote",
			"url": "{{ORIGIN}}/mcp"
		}
	}
}
```

Sign-in: run `opencode mcp auth lastfm` and sign in to Last.fm in the browser.

### Other apps, via mcp-remote

For apps that only run local servers. Add to the app's MCP config:

```json
{
	"mcpServers": {
		"lastfm": {
			"command": "npx",
			"args": ["-y", "mcp-remote", "{{ORIGIN}}/mcp"]
		}
	}
}
```

Sign-in: the browser opens to sign in to Last.fm the first time it connects.

## What you can ask

Ask in your own words. It reads your scrobbles, charts and loved tracks, and works out days like "yesterday" in your own timezone.

- When did I start listening to Radiohead?
- What was I obsessed with last summer?
- How has my taste changed since 2015?
- What did I listen to yesterday?
- Find me artists like my top five, but ones I've never played
- Where should I start with Talk Talk, given what I already like?
- Which albums did I play to death and then forget about?

## Tools

{{TOOLS}}

## Links

- [GitHub](https://github.com/rianvdm/lastfm-mcp): source code, README and issues
- [Privacy](https://elezea.com/privacy/#lastfm-mcp-server): what the server stores
- [Release notes](https://github.com/rianvdm/lastfm-mcp/releases)
