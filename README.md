# Ploi.io MCP Server

MCP server for [Ploi.io](https://ploi.io/) account management using the
[Ploi API](https://developers.ploi.io/).

The server uses standard MCP stdio transport and authenticates every Ploi API
request with a bearer token from `PLOI_API_TOKEN`.

## Setup

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
        "PLOI_API_TOKEN": "your-ploy-api-token"
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