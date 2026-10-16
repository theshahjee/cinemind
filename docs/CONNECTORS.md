# Connecting CineMind to Claude and ChatGPT

CineMind ships an MCP server in `apps/mcp` that runs in two modes:

| Mode | Command | Use it for |
|---|---|---|
| Local (stdio) | `node apps/mcp/dist/stdio.js` | Claude Desktop and Claude Code on the same machine as CineMind. No public URL and no sign-in. |
| Remote (HTTP + OAuth) | `docker compose --profile connector up`, port 4200 | claude.ai on the web, Claude mobile, ChatGPT, and Claude Code on another machine. Needs a public HTTPS address. |

Both modes expose the same tools:

- `recommend`, `ask`, `search_titles`, `get_title`, `taste_profile` and `library` are read-only.
- `search` and `fetch` are read-only and shaped the way ChatGPT's research modes expect.
- `add_to_watchlist` and `rate_title` change data. They only appear when `CINEMIND_MCP_ALLOW_WRITES=true`.

Every tool has a `title` and `readOnlyHint` and `destructiveHint` annotations, which both Anthropic's and OpenAI's review guidelines ask for.

## Local: Claude Desktop

Build the repo (`pnpm install && pnpm build`), then add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cinemind": {
      "command": "node",
      "args": ["/absolute/path/to/cinemind/apps/mcp/dist/stdio.js"],
      "env": {
        "CINEMIND_API_URL": "http://localhost:4000",
        "CINEMIND_API_TOKEN": "<your CINEMIND_API_TOKEN>"
      }
    }
  }
}
```

## Claude Code

This repo is also a Claude Code plugin marketplace. The plugin connects to the remote server and adds a `what-to-watch` skill:

```bash
claude plugin marketplace add theshahjee/cinemind
```

```bash
claude plugin install cinemind@cinemind
```

The plugin reads the server address from `CINEMIND_MCP_URL`, and uses `http://localhost:4200/mcp` when that's unset. To skip the plugin and add the server by itself:

```bash
claude mcp add --transport http cinemind https://your-host.example.com/mcp
```

Claude Code signs in through a local callback (`http://localhost:<port>/callback`). The server accepts any port on loopback for that reason.

## Remote: exposing the server

claude.ai and ChatGPT run in the cloud, so they can't reach `localhost`. Put the MCP service behind HTTPS with one of these:

- **Cloudflare Tunnel.** `cloudflared tunnel --url http://localhost:4200` prints a temporary `trycloudflare.com` address, which is fine for trying it out. For a stable address, create a named tunnel on your own domain.
- **Tailscale Funnel.** `tailscale funnel 4200` publishes the port on your tailnet's `ts.net` name.
- **A VPS or reverse proxy** (Caddy, nginx) in front of port 4200.

Then set these in `.env` and start the service:

```bash
CINEMIND_MCP_PUBLIC_URL=https://your-host.example.com
CINEMIND_MCP_PASSWORD=<at least 12 characters>
```

```bash
docker compose --profile connector up -d
```

Only the MCP service needs exposing. The API, web app and database stay private.

### How sign-in works

The MCP service runs its own small OAuth 2.1 authorization server, which is what Claude and ChatGPT expect:

1. The client finds the server through protected resource metadata (RFC 9728) and authorization server metadata (RFC 8414).
2. It registers itself with dynamic client registration (RFC 7591).
3. It opens a CineMind page in your browser asking for `CINEMIND_MCP_PASSWORD`.
4. It exchanges the code using PKCE (S256), then receives a one-hour access token and a 30-day refresh token. The refresh token changes every time it's used.

Tokens are tied to this server's `/mcp` URL (RFC 8707), and only their SHA-256 hashes are stored. Ten wrong passwords from one IP lock the form for 15 minutes. You revoke access by deleting rows from `oauth_tokens`. A settings page for that is on the roadmap.

## Adding the connector

### Claude (claude.ai, Desktop, mobile)

On Pro or Max, go to Customize → Connectors → **+ Add** → **Add custom connector**. Enter a name and `https://your-host.example.com/mcp`, then sign in. Free accounts can add one custom connector. On Team and Enterprise, an owner adds it under Organization settings → Connectors, and members then click Connect. Connectors you add on the web also show up in Desktop and mobile. [Anthropic help article](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)

Claude calls back to `https://claude.ai/api/mcp/auth_callback`.

### ChatGPT

Go to chatgpt.com/plugins → **+** → **Add custom MCP server**. Enter the `/mcp` URL, choose OAuth, and accept the warning. At the time of writing, OpenAI's help pages say full MCP with write actions is for Business and Enterprise/Edu, and Pro gets read and fetch only. They also say that on Business, only admins and owners can add custom servers. These rules have changed several times, so check [OpenAI's current article](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt) before relying on them.

ChatGPT prefers Client ID Metadata Documents but falls back to dynamic registration, which this server supports. Its authorization response includes an `iss` parameter (RFC 9207).

## Publishing to the directories

The public directories list one hosted service that many people sign in to. CineMind is self-hosted, so each person's server has its own URL. Listing it would mean running a hosted, multi-user CineMind with real accounts, which this project doesn't do yet. Until then, the custom connector route above is how people connect. These are the requirements if that changes:

**Anthropic Connectors Directory.** Submit at [claude.ai/directory/manage](https://claude.ai/directory/manage). You need:

- A paid Claude plan.
- Tool titles and annotations, with read and write kept in separate tools (done).
- OAuth for authenticated services (done).
- A privacy policy URL, documentation, a support contact and an icon.
- A reviewer test account with real data.

Listings start as "Community" and can be promoted to "Verified". Local `.mcpb` desktop extensions are no longer accepted in the directory; local servers should be distributed as plugins, which is why this repo ships a Claude Code marketplace. [Submission guide](https://claude.com/docs/connectors/building/submission.md), [review criteria](https://claude.com/docs/connectors/building/review-criteria.md)

**ChatGPT plugin directory.** Upload at platform.openai.com/plugins. You need:

- Individual or business verification.
- Stable public HTTPS.
- OAuth or no auth (API-key headers are rejected).
- Website, support, privacy policy and terms URLs.
- Reviewer credentials, five positive and three negative test cases, and a demo video.
- Explicit read-only, destructive and open-world hints on every tool.
- Content suitable for ages 13 and up.

[Submission guide](https://developers.openai.com/apps-sdk/deploy/submission), [guidelines](https://developers.openai.com/apps-sdk/app-submission-guidelines)

## Licensing

A hosted, public version also runs into the data licences. IMDb's datasets are for personal, non-commercial use. TMDB's free API is non-commercial, needs attribution, caps cached data at six months and forbids AI or LLM training. Sending a title's metadata to Claude or ChatGPT during a chat isn't training, but read the terms before building anything public or paid.
