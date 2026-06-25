# Content System

All marketing content lives under `4geeks-com/`. Pages are YAML files grouped by content type directory.

## Directory layout

```
4geeks-com/
  content-types.yml       # single source of truth for all content types
  settings.yml            # site-wide settings (locales, tag manager, etc.)
  image-registry.json     # centralized image metadata
  theme.json              # color theme tokens
  component-registry/     # versioned component schemas and examples
  menus/                  # menu definitions (navbar, footer, etc.)
  <type-directory>/       # one folder per content type (e.g. pages/, programs/)
    <slug>/
      _common.yml         # locale-independent fields (merged into every locale)
      en.yml              # English locale content
      es.yml              # Spanish locale content
      versioning.yml      # optional: A/B variant configuration
```

## Merge behavior

When a page is loaded the system performs a deep merge: `_common.yml` fields are the base and the locale file overrides them. Arrays are replaced wholesale (not appended). This means locale-specific fields override shared ones for the same key.

## Safe loading — CRITICAL

**Never use raw `yaml.load()` on content files.** Always use `contentIndex.safeYamlLoad()` or higher-level `ContentIndex` methods. The safe loader handles template expressions like `{{ single.title }}` that contain characters (e.g. `:`) that break standard YAML parsing.

On the MCP server side, use the `safeLoad()` helper from `mcp-server/lib/content.ts`.

## Content types

Types are declared in `content-types.yml`. Each entry specifies:

- `directory` — subfolder inside `4geeks-com/`
- `url_pattern` — per-locale URL templates with `:slug` placeholder
- `field_mapping` — which YAML keys are exposed as `{{ single.* }}` template variables
- `database.slug` — if present, the type is DB-backed (blog posts); YAML editing tools skip these
- `layout.menu` — which navbar/footer menus to render

## Active content types

<!-- @dynamic:content_types -->
<!-- /dynamic -->

## Database-backed types

Types with a `database.slug` key (e.g. `blog`) store their entries in a relational database, not YAML files. The `sections` and `layout` for these types live in shared template files (`single.{locale}.yml`) that apply to all entries of that type. Do not attempt to edit per-entry `_common.yml` files for DB-backed types — they do not exist.

## Template variables

Content files may reference `{{ single.<field> }}` variables that are resolved at render time using the `field_mapping` for the content type. These expressions must survive YAML parsing — use `safeYamlLoad` which swaps them out temporarily.
