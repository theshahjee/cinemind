import { ErrorNote } from "@/components/ErrorNote";
import { TraktConnect } from "@/components/TraktConnect";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-md border border-line bg-ink p-3 text-xs leading-relaxed text-paper/90">{children}</pre>;
}

export default async function Connections() {
  let trakt: { configured: boolean; connected: boolean; lastSyncAt?: string } | undefined;
  let error: string | undefined;
  try {
    trakt = await api("/api/integrations/trakt");
  } catch (e) {
    error = (e as Error).message;
  }
  const mcpUrl = process.env.CINEMIND_MCP_PUBLIC_URL ? new URL("/mcp", process.env.CINEMIND_MCP_PUBLIC_URL).href : undefined;

  return (
    <section className="max-w-3xl space-y-12">
      <div className="space-y-2">
        <h1 className="font-display text-5xl tracking-tight">Connections</h1>
        <p className="text-muted">Bring ratings in from other services, and let Claude or ChatGPT use your recommendations.</p>
      </div>
      {error && <ErrorNote message={error} />}

      <div className="space-y-3">
        <h2 className="text-sm uppercase tracking-widest text-muted">Trakt</h2>
        <p className="text-sm text-paper/80">
          Imports your Trakt ratings and watchlist, then keeps pulling new ones every few hours. Trakt can import your IMDb history
          too, so this is the closest thing to a live IMDb connection. Sync is one-way, and nothing is written back to Trakt.
        </p>
        {trakt && <TraktConnect {...trakt} />}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm uppercase tracking-widest text-muted">IMDb</h2>
        <p className="text-sm text-paper/80">
          IMDb has no sign-in for apps, so imports go through its CSV export. Upload it on the Library page, or drop it into the
          import folder (<code>IMPORT_DIR</code>) and the worker picks it up within a minute. Re-importing is safe: a rating is only
          replaced by a newer one.
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm uppercase tracking-widest text-muted">Claude and ChatGPT</h2>
        <div className="space-y-2 text-sm text-paper/80">
          <p>
            <span className="text-paper">Remote connector</span> (claude.ai, Claude mobile, ChatGPT). Add a custom connector with this
            URL, then sign in with your <code>CINEMIND_MCP_PASSWORD</code>:
          </p>
          {mcpUrl ? <Code>{mcpUrl}</Code> : <p className="text-muted">Set <code>CINEMIND_MCP_PUBLIC_URL</code> to the HTTPS address the MCP service is reachable at.</p>}
        </div>
        <div className="space-y-2 text-sm text-paper/80">
          <p>
            <span className="text-paper">Claude Code</span>, using the same remote server:
          </p>
          <Code>{`claude mcp add --transport http cinemind ${mcpUrl ?? "https://<your-host>/mcp"}`}</Code>
        </div>
        <div className="space-y-2 text-sm text-paper/80">
          <p>
            <span className="text-paper">Claude Desktop, local only.</span> No public URL needed. Build the repo, then add this to{" "}
            <code>claude_desktop_config.json</code>:
          </p>
          <Code>{`{
  "mcpServers": {
    "cinemind": {
      "command": "node",
      "args": ["/path/to/cinemind/apps/mcp/dist/stdio.js"],
      "env": {
        "CINEMIND_API_URL": "http://localhost:4000",
        "CINEMIND_API_TOKEN": "<your CINEMIND_API_TOKEN>"
      }
    }
  }
}`}</Code>
        </div>
        <p className="text-sm text-muted">
          Tools are read-only unless <code>CINEMIND_MCP_ALLOW_WRITES=true</code>. Whatever a tool returns goes to Anthropic or OpenAI
          as part of your conversation.
        </p>
      </div>
    </section>
  );
}
