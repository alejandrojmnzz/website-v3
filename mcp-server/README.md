# Content Entries MCP Server

An MCP (Model Context Protocol) server that gives Claude read and write access to the platform's YAML-driven **content entries** (any content type — not only `page`). Works with **Claude Desktop** and **claude.com** custom connectors.

**Vocabulary:** an *entry* is one slug under a content type (`blog`, `program`, `page`, …). The content type key `page` is unrelated to tool names.

**Multi-site:** call `list_sites` first when more than one domain exists, then pass `site` (e.g. `4geeks.com`) on every tool.

**Shared-layout / `single_template`:** shell lives in `single.{locale}.yml`; create with `create_entry`, locale fields (e.g. `content`), and `sections: []`. See `explain_site` topic `shared-layout`. Call `get_content_type_info` before creating when unsure (`db_backed` vs `single_template`, `create_via`).

## Mutating response envelope

Every **mutating** tool success payload is JSON inside `content[0].text` and always includes:

| Field | Meaning |
|---|---|
| `warnings` | What did **not** / will not happen (e.g. no binding propagate on variants). Always an array (`[]` when none). |
| `side_effects` | Optional blast radius beyond the obvious write (`bound_updates`, shared-template impact). |
| `next_actions` | Exact registered tool names the agent should call next (`required` / `recommended` / `optional`), with optional `args_hint`. Always an array. |

Helpers live in `mcp-server/lib/respond.ts` (`ok` / `fail` / `actionRequired`). Gates such as `confirm_live_edit`, `confirm_layout_target`, multi-site `site`, and `confirm_new_values` use `actionRequired` (not bare errors).

**Shared layout:** use the same tools with `layout_target` (`auto` \| `entry` \| `type_single`). MCP does **not** auto-fan-out sibling `single.*.yml` files — follow `next_actions`. Live single-section field edits **do** propagate section bindings on the server (`bound_updates`); `batch_update_fields` does not.

## Tools

| Tool | Description |
|---|---|
| `list_sites` | Configured domains + content folders (`sites.yml`) |
| `list_entries` | List YAML (non-DB) entries with slug, content type, locales, title, urls |
| `get_content_type_info` | Type contract: db_backed, single_template, mapping, editor, observed URL-param values, create_via |
| `get_entry_content` | Merged entry content without meta/SEO |
| `get_entry_seo` | SEO/meta + resolved schema.org preview + companion/CT gaps for one entry |
| `ensure_content_type_schema_org` | Attach seeded schema_org companions for CT `schema_org_requirements` |
| `list_entry_seo` | SEO listing; **unfiltered = minimal sample**; pass `slugs` for full meta |
| `create_entry` | Create YAML entry (draft-first or live shared-layout); not for DB-backed types |
| `update_section_field` | Patch a section or safe top-level field (`editor.type`-gated) |
| `update_section_fields` | Bulk section / safe top-level fields |
| `update_meta_field` | Patch one SEO/meta field |
| `update_meta_fields` | Patch multiple SEO/meta fields |
| `add_section` / `remove_section` / `reorder_sections` / `replace_entry_sections` | Section topology |
| `batch_update_fields` | Bulk paths including `content` / `description` when allowed by editor |
| `translate_entry` | Draft/live translation workflow |
| `run_entry_diagnostics` | Async diagnostics job |
| `get_section_bindings` | Binding-group membership |
| `list_components` / `get_component_schema` / `get_component_variant` | Component registry |

---

## Tool Reference

### `list_sites`

Returns `{ count, sites: [{ domain, contentFolder }], hint }`.

### `list_entries`

Lists YAML-driven content entries (includes static `single_template` types such as blog; excludes `database.slug` types).

**Parameters:** optional `contentType`, `locale`, `slugs`, `search`, `site`.

### `get_content_type_info`

**Parameters:** `contentType` (required), `site` (multi-site).

### `get_entry_content`

Gets the merged content of an entry (sections, title, and all other top-level YAML keys) without the `meta`/SEO block. Merges `_common.yml` with the locale file. Use `get_entry_seo` when you only need SEO/meta fields.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string | yes | Entry slug (folder name), e.g. `home` or `full-stack-developer` |
| `locale` | string | no | Locale code (default: `en`), e.g. `en` or `es` |
| `contentType` | string | no | Content type hint (e.g. `page`, `program`, `blog`). Omit to auto-detect from slug. |
| `site` | string | multi-site | Domain from `list_sites` |

---

### `get_entry_seo`

Gets the SEO/meta block plus a rich `schema_org` preview (resolved JSON-LD documents + sources from the same SSR section pipeline, including `@organization` dual-emit), companion/CT requirement gaps, and cached SEO `validation_issues`. Use this to inspect what Google gets. Edit Course/LocalBusiness YAML via `get_entry_content` / section tools — do not expect a derived JSON-LD dump on `get_entry_content`.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string | yes | Entry slug (folder name), e.g. `home` or `full-stack-developer` |
| `locale` | string | no | Locale code (default: `en`), e.g. `en` or `es` |
| `contentType` | string | no | Content type hint (e.g. `page`, `program`, `blog`). Omit to auto-detect from slug. |
| `site` | string | multi-site | Domain from `list_sites` |

---

### `update_section_field`

Updates a **single** section field (or safe top-level entry field) in a locale YAML file.

Use this for all **content and section edits**. Do **not** use it for SEO/meta fields — use `update_meta_field` instead.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string | yes | Entry slug |
| `locale` | string | no | Locale code (default: `en`) |
| `field_path` | string | yes | Dot-notation path. Must start with `sections.` or be a safe top-level field for the type (`title`, `slug`, `content`, … via `editor.type`). Paths starting with `meta.` are rejected. |
| `value` | any | yes | New value for the field |
| `contentType` | string | no | Content type hint. Omit to auto-detect from slug. |
| `site` | string | multi-site | Domain from `list_sites` |

**Example:**

```json
{
  "name": "update_section_field",
  "arguments": {
    "slug": "home",
    "locale": "en",
    "field_path": "sections.0.title",
    "value": "Learn AI From Day One"
  }
}
```

---

### `update_section_fields`

Updates **multiple** section fields (or safe top-level page fields) in a single write to a page's locale YAML file.

Use this for all **content and section edits** when changing more than one field at once. Do **not** use it for SEO/meta fields — use `update_meta_fields` instead.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string | yes | Page slug |
| `locale` | string | no | Locale code (default: `en`) |
| `fields` | object | yes | Map of dot-notation field paths to new values. Every key must start with `sections.` or be `title`/`slug`. |
| `contentType` | string | no | Content type hint. Omit to auto-detect from slug. |

**Example:**

```json
{
  "name": "update_section_fields",
  "arguments": {
    "slug": "home",
    "locale": "en",
    "fields": {
      "sections.0.title": "Learn AI From Day One",
      "sections.0.subtitle": "Join thousands of students worldwide",
      "title": "Home"
    }
  }
}
```

---

### `update_meta_field`

Updates a **single** SEO/meta field on a page. Known fields are **auto-routed** to the correct YAML file — see the routing table below.

For non-standard meta fields not in the known list, use `custom_fields` + `target`.

Do **not** use this for section/content edits — use `update_section_field` instead.

#### Meta field auto-routing

| Field | Written to |
|---|---|
| `page_title` | `{locale}.yml` |
| `description` | `{locale}.yml` |
| `og_image` | `{locale}.yml` |
| `og_type` | `{locale}.yml` |
| `og_url` | `{locale}.yml` |
| `og_locale` | `{locale}.yml` |
| `canonical_url` | `{locale}.yml` |
| `robots` | `_common.yml` |
| `priority` | `_common.yml` |
| `change_frequency` | `_common.yml` |

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string | yes | Page slug |
| `locale` | string | no | Locale code (default: `en`) used when writing to a locale file |
| `field` | enum | no* | Known meta field name (see routing table above). Auto-routed to the correct file. Required when not using `custom_fields`. |
| `value` | any | no* | New value for the known `field`. Required when `field` is provided. |
| `custom_fields` | object | no* | Map of non-standard meta field names to values. Cannot contain known field names. Requires `target`. |
| `target` | `"locale"` \| `"common"` | no* | Required when `custom_fields` is provided. `locale` → `{locale}.yml`, `common` → `_common.yml`. |
| `contentType` | string | no | Content type hint. Omit to auto-detect from slug. |

\* Either `field` + `value`, or `custom_fields` + `target`, must be provided.

**Examples:**

Update a known locale field:
```json
{
  "name": "update_meta_field",
  "arguments": {
    "slug": "home",
    "locale": "en",
    "field": "page_title",
    "value": "Learn AI | 4Geeks Academy"
  }
}
```

Update a known common field:
```json
{
  "name": "update_meta_field",
  "arguments": {
    "slug": "home",
    "field": "robots",
    "value": "index, follow"
  }
}
```

Update a non-standard meta field:
```json
{
  "name": "update_meta_field",
  "arguments": {
    "slug": "home",
    "locale": "en",
    "custom_fields": { "twitter_card": "summary_large_image" },
    "target": "locale"
  }
}
```

---

### `update_meta_fields`

Updates **multiple** SEO/meta fields on a page in a single call. Auto-routes each known field to the correct file. May write to both `_common.yml` and a locale file in one call if the fields span both.

For non-standard meta fields not in the known list, use `custom_fields` + `target`.

Do **not** use this for section/content edits — use `update_section_fields` instead.

#### Meta field auto-routing

| Field | Written to |
|---|---|
| `page_title` | `{locale}.yml` |
| `description` | `{locale}.yml` |
| `og_image` | `{locale}.yml` |
| `og_type` | `{locale}.yml` |
| `og_url` | `{locale}.yml` |
| `og_locale` | `{locale}.yml` |
| `canonical_url` | `{locale}.yml` |
| `robots` | `_common.yml` |
| `priority` | `_common.yml` |
| `change_frequency` | `_common.yml` |

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string | yes | Page slug |
| `locale` | string | no | Locale code (default: `en`) used when writing to a locale file |
| `fields` | object | no* | Map of **known** meta field names to values. Auto-routed per field. May write to both files in one call. |
| `custom_fields` | object | no* | Map of non-standard meta field names to values. Cannot contain known field names. Requires `target`. |
| `target` | `"locale"` \| `"common"` | no* | Required when `custom_fields` is provided. `locale` → `{locale}.yml`, `common` → `_common.yml`. |
| `contentType` | string | no | Content type hint. Omit to auto-detect from slug. |

\* At least one of `fields` or `custom_fields` must be provided.

**Examples:**

Update multiple known fields (may write to both files automatically):
```json
{
  "name": "update_meta_fields",
  "arguments": {
    "slug": "home",
    "locale": "en",
    "fields": {
      "page_title": "Learn AI | 4Geeks Academy",
      "description": "Join our AI bootcamp and start your tech career.",
      "robots": "index, follow",
      "priority": 0.9
    }
  }
}
```

Known fields + custom fields in one call:
```json
{
  "name": "update_meta_fields",
  "arguments": {
    "slug": "home",
    "locale": "en",
    "fields": {
      "page_title": "Learn AI | 4Geeks Academy",
      "description": "Join our AI bootcamp."
    },
    "custom_fields": { "twitter_card": "summary_large_image" },
    "target": "locale"
  }
}
```

### `list_components`

Lists all available section component types from the component registry.

**Returns:** type, version, name, description, and variants (name only) for each registered component.

**Parameters:** none

---

### `get_component_schema`

Gets the top-level schema info for a component: its name, description, when_to_use guidance, and the full list of variants (each with name, description, and best_for). Use this first to understand which variant fits your use case. Then call `get_component_variant` to get field definitions and a worked YAML example for your chosen variant.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `componentType` | string | yes | Component type name, e.g. `faq`, `hero`, `two_column` |

**Example:**

```json
{
  "name": "get_component_schema",
  "arguments": {
    "componentType": "hero"
  }
}
```

**Returns:** `{ componentType, name, description, when_to_use, variants: [{ name, description, best_for }, ...] }`

---

### `get_component_variant`

Gets the field definitions (`variant_props`) and a worked YAML example for a specific component variant. Call `get_component_schema` first to see the available variants, then call this tool with your chosen variant to get everything you need to write the YAML.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `componentType` | string | yes | Component type name, e.g. `hero`, `faq`, `two_column` |
| `variant` | string | yes | Variant name as listed by `get_component_schema`, e.g. `singleColumn`, `showcase` |

**Example:**

```json
{
  "name": "get_component_variant",
  "arguments": {
    "componentType": "hero",
    "variant": "singleColumn"
  }
}
```

**Returns:** `{ componentType, variant, variant_props: { <field definitions> }, example: "<worked YAML string>" }`

---

## Auth

All `/mcp` requests require authentication. The server will refuse to start if the internal loopback credential is not set — see [Environment variables](#environment-variables) below.

Inbound callers (Claude Desktop, Claude.ai, curl) authenticate via:
- An **OAuth 2.0 Bearer token** issued by this server's `/oauth/token` endpoint, or
- A **Breathecode API token** passed via `Authorization: Bearer <token>` or `X-Api-Key: <token>`.

The `/health` endpoint is open without auth.

> **Note:** `MCP_SERVER_SECRET` is an *internal* server-to-server credential used only for the MCP server's own loopback requests to the main app's `/api/auth/check-capability` endpoint. It is **not** accepted as an inbound caller credential — callers must use OAuth or a Breathecode token.

## Running locally

The MCP server starts automatically alongside the main app via the **MCP Server** workflow. It listens on port `3001` by default (configurable via `MCP_PORT`).

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `MCP_SERVER_SECRET` | _(none)_ | **Required.** Internal loopback credential used by the MCP server to authenticate its own requests to the main app. Server exits with a FATAL error if neither this nor the legacy `MCP_API_KEY` is set. |
| `MCP_API_KEY` | _(none)_ | **Legacy alias for `MCP_SERVER_SECRET`.** Supported for backward compatibility — a deprecation warning is emitted at startup. Rename to `MCP_SERVER_SECRET` for new deployments. |
| `MCP_PORT` | `3001` | Port the MCP server listens on. |
| `SITE_URL` | auto (`REPLIT_DEV_DOMAIN`) | Public base URL used in OAuth metadata. Automatically resolved from `REPLIT_DEV_DOMAIN` in Replit — only set this manually if deploying outside Replit. |
| `OAUTH_CLIENT_ID` | _(none)_ | Optional static Client ID for the legacy pre-configured OAuth flow. Not needed when using dynamic registration (Claude.ai default). |
| `OAUTH_CLIENT_SECRET` | _(none)_ | Optional static Client Secret for the legacy pre-configured OAuth flow. |

Set all secrets in the Replit **Secrets** tab (or `.env` locally). See `.env.example` in the repo root for a complete template.

## Connect via Claude Desktop

Add this to your `claude_desktop_config.json` (usually at `~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "content-pages": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "X-Api-Key": "YOUR_BREATHECODE_TOKEN"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

## Connect via Claude.ai (OAuth 2.0)

Claude.ai uses **dynamic client registration** (RFC 7591) — it registers itself automatically when you add the connector URL. No secrets need to be pre-configured.

### 1. Set the public URL secret

In the Replit **Secrets** tab, add:

| Secret | Value |
|---|---|
| `PUBLIC_URL` | Your deployed URL, e.g. `https://your-project.replit.app` |

This tells the OAuth metadata endpoint what base URL to advertise to Claude.ai.

### 2. Deploy the project

Anthropic's cloud must be able to reach your server from the internet. Deploy the Replit project so it gets a public URL (e.g. `https://your-project.replit.app`).

### 3. Add the connector in Claude.ai

1. Go to **Claude.ai → Settings → Connectors** and click **+**.
2. Enter the **Connector URL**: `https://your-project.replit.app/mcp`
3. Claude.ai will automatically register itself with the server (no credentials to enter).
4. Your browser is redirected to the MCP server's consent page.
5. Click **Allow**.
6. You are redirected back to Claude.ai and the connector is now active.

The connector is now available in conversations via the **+** button.

> **Restart behaviour**: Registered clients are persisted to `mcp-server/data/oauth-clients.json` and survive server restarts. However, access tokens are in-memory only — after a restart, Claude.ai will automatically re-exchange its token on the next request. If that fails, disconnect and re-add the connector to repeat the OAuth flow.

## Connect via claude.com (Breathecode token header — legacy)

1. Deploy the Replit project so it gets a public URL (e.g. `https://your-project.replit.app`).
2. In Claude → **Settings → Connectors**, click **+** and enter:
   - **Name**: Content Pages
   - **URL**: `https://your-project.replit.app/mcp`
3. Click **Advanced settings** and add a custom header:
   - `X-Api-Key: YOUR_BREATHECODE_TOKEN`
4. Click **Add**. The connector is now available in conversations via the **+** button.

> **Note**: Anthropic's cloud connects to your server from the internet, so the Replit project must be deployed (not just running in dev mode).

## Example workflow for Claude

A typical editing session looks like this:

1. **Discover available components**
   ```
   Call list_components to see what section types exist.
   Call get_component_schema with componentType="hero" to read the variant list (name, description, best_for) and choose the right variant.
   Call get_component_variant with componentType="hero", variant="singleColumn" to get the full field definitions and a worked YAML example for that variant.
   For single-variant components (e.g. "faq"), get_component_schema returns a synthetic "default" variant — call get_component_variant with variant="default" to get the field definitions.
   ```

2. **Find the right page**
   ```
   Call list_entries to find all available pages.
   Call get_entry_content with slug="home", locale="en" to read its sections and content.
   Call get_entry_seo with slug="home", locale="en" to read only the meta/SEO fields.
   ```

3. **Make edits**
   ```
   Call add_section to insert a new FAQ section.
   Call update_section_field to change a section heading:
     { slug: "home", locale: "en", field_path: "sections.2.title", value: "FAQ" }
   Call update_meta_field to update the SEO title:
     { slug: "home", locale: "en", field: "page_title", value: "Home | 4Geeks Academy" }
   Call update_meta_fields to set multiple SEO fields at once:
     { slug: "home", locale: "en", fields: { description: "...", robots: "index, follow" } }
   Call reorder_sections to move the new section earlier.
   ```

### Choosing the right update tool

| What you want to edit | Tool to use |
|---|---|
| A section field (e.g. `sections.0.title`) | `update_section_field` |
| Multiple section fields at once | `update_section_fields` |
| Page `title` or `slug` top-level field | `update_section_field` |
| A single SEO/meta field | `update_meta_field` |
| Multiple SEO/meta fields at once | `update_meta_fields` |

## Transport

The server uses the **MCP Streamable HTTP transport** on a single `/mcp` endpoint. This satisfies the "HTTP + SSE" intent from the original design: the client sends a JSON-RPC POST and the server responds either as plain JSON or as a Server-Sent Events stream depending on what the client's `Accept` header requests. Both modes work through the same URL — no separate SSE endpoint is needed.

Clients must include both `application/json` and `text/event-stream` in their `Accept` header, which all MCP-compatible clients do automatically.

## Smoke test (curl)

Use these commands to verify auth and basic read/write behaviour. Replace `$TOKEN` with your Breathecode API token.

```bash
# Health (no auth required)
curl http://localhost:3001/health

# Auth enforcement — should return 401
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# List all pages (read tool)
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Api-Key: $TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":2,"params":{"name":"list_entries","arguments":{}}}'

# Get page content (sections, no meta) by slug only (contentType auto-detected)
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Api-Key: $TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":3,"params":{"name":"get_entry_content","arguments":{"slug":"home","locale":"en"}}}'

# Get page SEO/meta only by slug
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Api-Key: $TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":3,"params":{"name":"get_entry_seo","arguments":{"slug":"home","locale":"en"}}}'

# Update a section field (write tool)
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Api-Key: $TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":4,"params":{"name":"update_section_field","arguments":{"slug":"home","locale":"en","field_path":"sections.0.title","value":"Learn AI From Day One"}}}'

# Update a meta field (write tool)
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Api-Key: $TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":5,"params":{"name":"update_meta_field","arguments":{"slug":"home","locale":"en","field":"page_title","value":"Home | 4Geeks Academy"}}}'

# Update multiple meta fields at once
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-Api-Key: $TOKEN" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":6,"params":{"name":"update_meta_fields","arguments":{"slug":"home","locale":"en","fields":{"page_title":"Home | 4Geeks Academy","description":"Join our AI bootcamp.","robots":"index, follow"}}}}'

```

## Health check

```
GET /health
```

Returns `{"status":"ok","server":"content-pages-mcp","version":"1.0.0"}`.
