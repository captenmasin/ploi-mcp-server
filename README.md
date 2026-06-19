# Ploi.io MCP Server

MCP server for [Ploi.io](https://ploi.io/) account management using the
[Ploi API](https://developers.ploi.io/).

It ships with two transports that share the same tools:

- **stdio** — run locally, launched by your MCP client. Authenticates with a
  `PLOI_API_TOKEN` from the environment (`src/index.ts`).
- **Cloudflare Worker** — remote, multi-tenant Streamable HTTP server. Each
  caller supplies **their own** Ploi token as `Authorization: Bearer <token>`;
  nothing is stored on the Worker (`src/worker.ts`). See
  [Deploy to Cloudflare](#deploy-to-cloudflare) and
  [Use with Poke](#use-with-poke).

## Setup (local stdio)

```bash
npm install
npm run build
```

Create a Ploi API token from your Ploi profile, then configure your MCP client
to launch this server with the token in the environment:

```json
{
  "mcpServers": {
    "ploi": {
      "command": "node",
      "args": ["/path/to/ploi-mcp-server/dist/index.js"],
      "env": {
        "PLOI_API_TOKEN": "your-ploi-api-token"
      }
    }
  }
}
```

Optional environment variables:

- `PLOI_API_BASE_URL`: override the API base URL. Defaults to
  `https://ploi.io/api`.
- `PLOI_USER_AGENT`: override the user agent sent to Ploi. Defaults to
  `ploi-mcp-server/1.0.0`.

## Deploy to Cloudflare

The Worker exposes the same tools over the MCP **Streamable HTTP** transport at
`/mcp` (legacy SSE at `/sse`), backed by a Durable Object via the
[`agents`](https://developers.cloudflare.com/agents/) SDK. `GET /` is a health
check.

**Authentication is multi-tenant and pass-through.** The Worker stores **no**
Ploi credentials. Every request must carry the caller's own Ploi token as
`Authorization: Bearer <token>`; that token is bound to the MCP session and used
for all Ploi API calls in that session. Requests without a bearer token get
`401`.

### Deploy

```bash
npm install
npx wrangler login
npm run deploy        # deploys to https://ploi-mcp-server.<subdomain>.workers.dev
```

No secrets to configure. Optional `PLOI_API_BASE_URL` / `PLOI_USER_AGENT`
overrides can be added under `vars` in `wrangler.jsonc`.

### Local development

```bash
npm run dev           # local worker at http://localhost:8787
```

Pass a token per request, e.g.:

```bash
curl -s http://localhost:8787/health
curl -s -X POST http://localhost:8787/mcp \
  -H "Authorization: Bearer <your-ploi-token>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"dev","version":"0"}}}'
```

After editing `wrangler.jsonc`, run `npm run cf-typegen` (`wrangler types`) and
typecheck the Worker with `npm run typecheck:worker`.

## Use with Poke

[Poke](https://poke.com/) sends the integration's API key as
`Authorization: Bearer <key>` on every request — so each user simply pastes
**their own Ploi API token** as the key, and the Worker uses it for that user.

1. Deploy the Worker (above) and note its URL.
2. In Poke, add an MCP integration:
   - **URL**: `https://ploi-mcp-server.<subdomain>.workers.dev/mcp`
   - **API Key**: the user's Ploi API token (from the Ploi profile page)

   Or via CLI:

   ```bash
   npx poke@latest mcp add \
     https://ploi-mcp-server.<subdomain>.workers.dev/mcp \
     -n "Ploi" -k "<user-ploi-api-token>"
   ```

Each Poke user's token only ever touches their own session; the Worker keeps
no copy. If a request arrives without a token, or the token is rejected by
Ploi, the corresponding tool call returns an error.

## Tools

### Servers

- `ploi_list_servers`
- `ploi_get_server`
- `ploi_create_server`
- `ploi_create_custom_server`
- `ploi_start_custom_server_installation`
- `ploi_update_server`
- `ploi_restart_server`
- `ploi_delete_server`

### Sites

- `ploi_list_sites`
- `ploi_get_site`
- `ploi_create_site`
- `ploi_update_site`
- `ploi_delete_site`
- `ploi_deploy_site`
- `ploi_get_site_nginx_configuration`
- `ploi_update_site_nginx_configuration`

### Databases

- `ploi_list_databases`
- `ploi_get_database`
- `ploi_duplicate_database`
- `ploi_forget_database`

### Docker containers / services

- `ploi_list_containers`
- `ploi_get_container`
- `ploi_create_container`
- `ploi_update_container`
- `ploi_start_container`
- `ploi_stop_container`
- `ploi_restart_container`
- `ploi_delete_container`

Ploi exposes documented `up` and `down` endpoints for Docker containers. The
restart tool queues a shutdown followed by a startup using those endpoints.

### Account helpers

- `ploi_list_server_providers`
- `ploi_get_server_provider`
- `ploi_list_backup_configurations`
- `ploi_get_ip_addresses`

Destructive tools require a `confirm: true` argument.