#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const VERSION = "1.0.0";
const DEFAULT_BASE_URL = "https://ploi.io/api";
const DEFAULT_USER_AGENT = `ploi-mcp-server/${VERSION}`;

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
type QueryParams = Record<string, string | number | boolean | undefined>;
type JsonObject = Record<string, unknown>;

class PloiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly response: unknown,
  ) {
    super(message);
    this.name = "PloiApiError";
  }
}

class PloiClient {
  private readonly baseUrl: string;
  private readonly userAgent: string;

  constructor(private readonly apiToken: string) {
    this.baseUrl = (process.env.PLOI_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.userAgent = process.env.PLOI_USER_AGENT ?? DEFAULT_USER_AGENT;
  }

  async request(
    method: HttpMethod,
    path: string,
    options: { query?: QueryParams; body?: JsonObject } = {},
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/${path.replace(/^\//, "")}`);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
        "User-Agent": this.userAgent,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    const payload = parseResponseBody(text);

    if (!response.ok) {
      throw new PloiApiError(buildErrorMessage(response.status, payload), response.status, payload);
    }

    return payload;
  }
}

function parseResponseBody(text: string): unknown {
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildErrorMessage(status: number, payload: unknown): string {
  if (isJsonObject(payload) && typeof payload.message === "string") {
    return `Ploi API request failed with status ${status}: ${payload.message}`;
  }

  return `Ploi API request failed with status ${status}`;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactRecord(values: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function withPagination(args: { page?: number; per_page?: number }): QueryParams {
  return {
    page: args.page,
    per_page: args.per_page,
  };
}

function toToolResult(result: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: {
      result,
    },
  };
}

function requireApiToken(): string {
  const token = process.env.PLOI_API_TOKEN;

  if (!token) {
    throw new Error("PLOI_API_TOKEN is required to start the Ploi.io MCP server.");
  }

  return token;
}

const readOnly: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const mutating: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const destructive: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const serverId = z.coerce.number().int().positive().describe("Ploi server ID.");
const siteId = z.coerce.number().int().positive().describe("Ploi site ID.");
const databaseId = z.coerce.number().int().positive().describe("Ploi database ID.");
const containerId = z.coerce.number().int().positive().describe("Ploi Docker container ID.");
const providerId = z.coerce.number().int().positive().describe("Ploi server provider ID.");
const page = z.coerce.number().int().positive().optional().describe("Pagination page number.");
const perPage = z.coerce.number().int().positive().max(100).optional().describe("Items per page.");
const confirm = z.literal(true).describe("Must be true to confirm this destructive operation.");
const variables = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe("Variables to pass to the deploy script. Keys become uppercased environment variables.");
const dockerFlags = z.array(z.string()).optional().describe("Additional docker-compose flags.");

async function main(): Promise<void> {
  const client = new PloiClient(requireApiToken());
  const server = new McpServer({
    name: "ploi-mcp-server",
    version: VERSION,
  });

  server.registerTool(
    "ploi_list_servers",
    {
      title: "List Ploi servers",
      description: "Retrieve a paginated list of all servers in the authenticated Ploi account.",
      inputSchema: { page, per_page: perPage },
      annotations: readOnly,
    },
    async (args) => toToolResult(await client.request("GET", "/servers", { query: withPagination(args) })),
  );

  server.registerTool(
    "ploi_get_server",
    {
      title: "Get Ploi server",
      description: "Retrieve details for a single Ploi server.",
      inputSchema: { server_id: serverId },
      annotations: readOnly,
    },
    async ({ server_id }) => toToolResult(await client.request("GET", `/servers/${server_id}`)),
  );

  server.registerTool(
    "ploi_create_server",
    {
      title: "Create Ploi server",
      description:
        "Create a new provider-backed Ploi server. Use account provider tools first to discover valid credentials, plans, and regions.",
      inputSchema: {
        name: z.string().min(1).describe("Server name."),
        plan: z.string().min(1).describe("Provider plan ID."),
        region: z.string().min(1).describe("Provider region ID."),
        credential: z.coerce.number().int().positive().describe("Server provider credential ID."),
        type: z
          .enum(["server", "load-balancer", "database-server", "redis-server"])
          .default("server")
          .describe("Server type to install."),
        database_type: z
          .enum(["none", "mysql", "mariadb", "postgresql", "postgresql13"])
          .default("mysql")
          .describe("Database type to install."),
        webserver_type: z.enum(["nginx", "nginx-docker"]).default("nginx").describe("Webserver type to install."),
        php_version: z.string().optional().describe("PHP version to install, for example 8.4."),
        install_monitoring: z.boolean().optional().describe("Whether to install monitoring."),
        webhook_url: z.string().url().optional().describe("Webhook called when server installation completes."),
      },
      annotations: mutating,
    },
    async (args) => toToolResult(await client.request("POST", "/servers", { body: compactRecord(args) })),
  );

  server.registerTool(
    "ploi_create_custom_server",
    {
      title: "Create custom Ploi server",
      description:
        "Create a custom server record and return the SSH command/start URL required to begin installation.",
      inputSchema: {
        name: z.string().min(1).describe("Server name."),
        ip: z.string().ip({ version: "v4" }).describe("Public IPv4 address of the custom server."),
        type: z
          .enum(["server", "load-balancer", "database-server", "redis-server", "storage-server"])
          .default("server")
          .describe("Server type to install."),
      },
      annotations: mutating,
    },
    async (args) => toToolResult(await client.request("POST", "/servers/custom", { body: args })),
  );

  server.registerTool(
    "ploi_start_custom_server_installation",
    {
      title: "Start custom server installation",
      description: "Start installation for a custom Ploi server after the returned SSH command has been run.",
      inputSchema: {
        server_id: serverId,
        install_monitoring: z.boolean().optional().describe("Whether to install monitoring."),
        webhook_url: z.string().url().optional().describe("Webhook called when server installation completes."),
      },
      annotations: mutating,
    },
    async ({ server_id, ...args }) =>
      toToolResult(await client.request("POST", `/servers/custom/${server_id}/start`, { body: compactRecord(args) })),
  );

  server.registerTool(
    "ploi_update_server",
    {
      title: "Update Ploi server",
      description: "Update server metadata such as name, IP address, and SSH port.",
      inputSchema: {
        server_id: serverId,
        name: z.string().min(1).optional().describe("New server name."),
        ip: z.string().ip({ version: "v4" }).optional().describe("New server IPv4 address."),
        ssh_port: z.coerce.number().int().positive().max(65535).optional().describe("SSH port for the server."),
      },
      annotations: mutating,
    },
    async ({ server_id, ...args }) =>
      toToolResult(await client.request("PATCH", `/servers/${server_id}`, { body: compactRecord(args) })),
  );

  server.registerTool(
    "ploi_restart_server",
    {
      title: "Restart Ploi server",
      description: "Reboot a Ploi server.",
      inputSchema: { server_id: serverId },
      annotations: destructive,
    },
    async ({ server_id }) => toToolResult(await client.request("POST", `/servers/${server_id}/restart`)),
  );

  server.registerTool(
    "ploi_delete_server",
    {
      title: "Delete Ploi server",
      description: "Delete a Ploi server. This is irreversible and removes associated data.",
      inputSchema: { server_id: serverId, confirm },
      annotations: destructive,
    },
    async ({ server_id }) => toToolResult(await client.request("DELETE", `/servers/${server_id}`)),
  );

  server.registerTool(
    "ploi_list_sites",
    {
      title: "List Ploi sites",
      description: "Retrieve a paginated list of all sites on a Ploi server.",
      inputSchema: { server_id: serverId, page, per_page: perPage },
      annotations: readOnly,
    },
    async ({ server_id, ...args }) =>
      toToolResult(await client.request("GET", `/servers/${server_id}/sites`, { query: withPagination(args) })),
  );

  server.registerTool(
    "ploi_get_site",
    {
      title: "Get Ploi site",
      description: "Retrieve details for a single site on a Ploi server.",
      inputSchema: { server_id: serverId, site_id: siteId },
      annotations: readOnly,
    },
    async ({ server_id, site_id }) => toToolResult(await client.request("GET", `/servers/${server_id}/sites/${site_id}`)),
  );

  server.registerTool(
    "ploi_create_site",
    {
      title: "Create Ploi site",
      description: "Create a new site on a Ploi server.",
      inputSchema: {
        server_id: serverId,
        root_domain: z.string().min(1).max(100).describe("Root domain for the site."),
        web_directory: z.string().min(1).max(50).default("/public").describe("Web directory path."),
        project_root: z.string().max(50).optional().describe("Project root path."),
        project_type: z
          .enum(["laravel", "nodejs", "statamic", "craft-cms", "symfony", "wordpress", "octobercms", "cakephp"])
          .optional()
          .describe("Application project type."),
        system_user: z.string().optional().describe("System user that owns the site files."),
        webserver_template: z.coerce.number().int().positive().optional().describe("Webserver template ID."),
        webhook_url: z.string().url().optional().describe("Webhook called when site creation completes."),
      },
      annotations: mutating,
    },
    async ({ server_id, ...args }) =>
      toToolResult(await client.request("POST", `/servers/${server_id}/sites`, { body: compactRecord(args) })),
  );

  server.registerTool(
    "ploi_update_site",
    {
      title: "Update Ploi site",
      description: "Update site properties. Domain changes are processed asynchronously by Ploi.",
      inputSchema: {
        server_id: serverId,
        site_id: siteId,
        root_domain: z.string().min(1).max(100).optional().describe("New root domain for the site."),
      },
      annotations: mutating,
    },
    async ({ server_id, site_id, ...args }) =>
      toToolResult(await client.request("PATCH", `/servers/${server_id}/sites/${site_id}`, { body: compactRecord(args) })),
  );

  server.registerTool(
    "ploi_delete_site",
    {
      title: "Delete Ploi site",
      description: "Delete a site from a Ploi server.",
      inputSchema: { server_id: serverId, site_id: siteId, confirm },
      annotations: destructive,
    },
    async ({ server_id, site_id }) =>
      toToolResult(await client.request("DELETE", `/servers/${server_id}/sites/${site_id}`)),
  );

  server.registerTool(
    "ploi_deploy_site",
    {
      title: "Deploy Ploi site",
      description: "Trigger or schedule a deployment using the site's configured deploy script.",
      inputSchema: {
        server_id: serverId,
        site_id: siteId,
        scheduled: z.string().optional().describe("Optional scheduled datetime, for example 2023-01-01 10:00."),
        variables,
      },
      annotations: mutating,
    },
    async ({ server_id, site_id, ...args }) =>
      toToolResult(await client.request("POST", `/servers/${server_id}/sites/${site_id}/deploy`, { body: compactRecord(args) })),
  );

  server.registerTool(
    "ploi_get_site_nginx_configuration",
    {
      title: "Get site NGINX configuration",
      description: "Retrieve the NGINX configuration for a Ploi site.",
      inputSchema: { server_id: serverId, site_id: siteId },
      annotations: readOnly,
    },
    async ({ server_id, site_id }) =>
      toToolResult(await client.request("GET", `/servers/${server_id}/sites/${site_id}/nginx-configuration`)),
  );

  server.registerTool(
    "ploi_update_site_nginx_configuration",
    {
      title: "Update site NGINX configuration",
      description: "Replace the NGINX configuration for a Ploi site. Ploi may require a reload/restart afterward.",
      inputSchema: {
        server_id: serverId,
        site_id: siteId,
        content: z.string().min(1).describe("Full NGINX configuration file contents."),
      },
      annotations: mutating,
    },
    async ({ server_id, site_id, content }) =>
      toToolResult(
        await client.request("PATCH", `/servers/${server_id}/sites/${site_id}/nginx-configuration`, {
          body: { content },
        }),
      ),
  );

  server.registerTool(
    "ploi_list_databases",
    {
      title: "List Ploi databases",
      description: "Retrieve a paginated list of databases on a Ploi server.",
      inputSchema: { server_id: serverId, page, per_page: perPage },
      annotations: readOnly,
    },
    async ({ server_id, ...args }) =>
      toToolResult(await client.request("GET", `/servers/${server_id}/databases`, { query: withPagination(args) })),
  );

  server.registerTool(
    "ploi_get_database",
    {
      title: "Get Ploi database",
      description: "Retrieve details for a single database on a Ploi server.",
      inputSchema: { server_id: serverId, database_id: databaseId },
      annotations: readOnly,
    },
    async ({ server_id, database_id }) =>
      toToolResult(await client.request("GET", `/servers/${server_id}/databases/${database_id}`)),
  );

  server.registerTool(
    "ploi_duplicate_database",
    {
      title: "Duplicate Ploi database",
      description: "Clone an existing database to a new database on the same server.",
      inputSchema: {
        server_id: serverId,
        database_id: databaseId,
        name: z.string().min(1).max(255).describe("Name for the new database."),
        user: z.string().max(255).optional().describe("Optional username for the new database user."),
        password: z.string().max(50).optional().describe("Optional password for the new database user."),
      },
      annotations: mutating,
    },
    async ({ server_id, database_id, ...args }) =>
      toToolResult(
        await client.request("POST", `/servers/${server_id}/databases/${database_id}/duplicate`, {
          body: compactRecord(args),
        }),
      ),
  );

  server.registerTool(
    "ploi_forget_database",
    {
      title: "Forget Ploi database",
      description: "Remove a database from Ploi records without deleting it from the server.",
      inputSchema: { server_id: serverId, database_id: databaseId, confirm },
      annotations: destructive,
    },
    async ({ server_id, database_id }) =>
      toToolResult(await client.request("DELETE", `/servers/${server_id}/databases/${database_id}/forget`)),
  );

  server.registerTool(
    "ploi_list_containers",
    {
      title: "List Ploi Docker containers",
      description: "Retrieve a paginated list of Docker containers on a Ploi server.",
      inputSchema: { server_id: serverId, page, per_page: perPage },
      annotations: readOnly,
    },
    async ({ server_id, ...args }) =>
      toToolResult(
        await client.request("GET", `/servers/${server_id}/docker/containers`, { query: withPagination(args) }),
      ),
  );

  server.registerTool(
    "ploi_get_container",
    {
      title: "Get Ploi Docker container",
      description: "Retrieve details for a single Docker container on a Ploi server.",
      inputSchema: { server_id: serverId, container_id: containerId },
      annotations: readOnly,
    },
    async ({ server_id, container_id }) =>
      toToolResult(await client.request("GET", `/servers/${server_id}/docker/containers/${container_id}`)),
  );

  server.registerTool(
    "ploi_create_container",
    {
      title: "Create Ploi Docker container",
      description: "Create a Docker application container on a Ploi server.",
      inputSchema: {
        server_id: serverId,
        name: z.string().min(1).describe("Container name. Must be unique per server."),
        deploy_script: z.string().optional().describe("Docker Compose YAML. Ploi provides a default when omitted."),
      },
      annotations: mutating,
    },
    async ({ server_id, ...args }) =>
      toToolResult(await client.request("POST", `/servers/${server_id}/docker/containers`, { body: compactRecord(args) })),
  );

  server.registerTool(
    "ploi_update_container",
    {
      title: "Update Ploi Docker container",
      description: "Update a Docker container name or compose deploy script.",
      inputSchema: {
        server_id: serverId,
        container_id: containerId,
        name: z.string().min(1).optional().describe("New container name."),
        deploy_script: z.string().optional().describe("Updated Docker Compose YAML."),
      },
      annotations: mutating,
    },
    async ({ server_id, container_id, ...args }) =>
      toToolResult(
        await client.request("PATCH", `/servers/${server_id}/docker/containers/${container_id}`, {
          body: compactRecord(args),
        }),
      ),
  );

  server.registerTool(
    "ploi_start_container",
    {
      title: "Start Ploi Docker container",
      description: "Queue a Docker container for startup on a Ploi server.",
      inputSchema: { server_id: serverId, container_id: containerId, flags: dockerFlags },
      annotations: mutating,
    },
    async ({ server_id, container_id, flags }) =>
      toToolResult(
        await client.request("POST", `/servers/${server_id}/docker/containers/${container_id}/up`, {
          body: flags === undefined ? undefined : { flags },
        }),
      ),
  );

  server.registerTool(
    "ploi_stop_container",
    {
      title: "Stop Ploi Docker container",
      description: "Queue a Docker container for shutdown on a Ploi server.",
      inputSchema: { server_id: serverId, container_id: containerId, flags: dockerFlags },
      annotations: mutating,
    },
    async ({ server_id, container_id, flags }) =>
      toToolResult(
        await client.request("POST", `/servers/${server_id}/docker/containers/${container_id}/down`, {
          body: flags === undefined ? undefined : { flags },
        }),
      ),
  );

  server.registerTool(
    "ploi_restart_container",
    {
      title: "Restart Ploi Docker container",
      description: "Queue a Docker container shutdown followed by startup using Ploi's documented down/up endpoints.",
      inputSchema: { server_id: serverId, container_id: containerId, down_flags: dockerFlags, up_flags: dockerFlags },
      annotations: destructive,
    },
    async ({ server_id, container_id, down_flags, up_flags }) => {
      const stop = await client.request("POST", `/servers/${server_id}/docker/containers/${container_id}/down`, {
        body: down_flags === undefined ? undefined : { flags: down_flags },
      });
      const start = await client.request("POST", `/servers/${server_id}/docker/containers/${container_id}/up`, {
        body: up_flags === undefined ? undefined : { flags: up_flags },
      });

      return toToolResult({ stop, start });
    },
  );

  server.registerTool(
    "ploi_delete_container",
    {
      title: "Delete Ploi Docker container",
      description: "Delete a Docker container from a Ploi server.",
      inputSchema: { server_id: serverId, container_id: containerId, confirm },
      annotations: destructive,
    },
    async ({ server_id, container_id }) =>
      toToolResult(await client.request("DELETE", `/servers/${server_id}/docker/containers/${container_id}`)),
  );

  server.registerTool(
    "ploi_list_server_providers",
    {
      title: "List Ploi server providers",
      description: "List server provider credentials linked to the authenticated Ploi account.",
      inputSchema: { page, per_page: perPage },
      annotations: readOnly,
    },
    async (args) =>
      toToolResult(await client.request("GET", "/user/server-providers", { query: withPagination(args) })),
  );

  server.registerTool(
    "ploi_get_server_provider",
    {
      title: "Get Ploi server provider",
      description: "Retrieve a server provider credential, including available plans and regions.",
      inputSchema: { provider_id: providerId },
      annotations: readOnly,
    },
    async ({ provider_id }) => toToolResult(await client.request("GET", `/user/server-providers/${provider_id}`)),
  );

  server.registerTool(
    "ploi_list_backup_configurations",
    {
      title: "List Ploi backup configurations",
      description: "List backup configurations linked to the authenticated Ploi account.",
      inputSchema: { page, per_page: perPage },
      annotations: readOnly,
    },
    async (args) =>
      toToolResult(await client.request("GET", "/user/backup-configurations", { query: withPagination(args) })),
  );

  server.registerTool(
    "ploi_get_ip_addresses",
    {
      title: "Get Ploi IP addresses",
      description: "Retrieve Ploi IP addresses for allow-listing workers and uptime checks.",
      annotations: readOnly,
    },
    async () => toToolResult(await client.request("GET", "/ips")),
  );

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
