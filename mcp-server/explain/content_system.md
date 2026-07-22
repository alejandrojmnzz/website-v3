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

## Database-backed / shared-layout types

Types with a `database.slug` key (or static types with `single_template: true`) use shared layout:

- Structure lives in each `single.{locale}.yml` (kept structurally in sync by the structured UI).
- `_common.single.yml` is **layout defaults only** — do not put `sections` there.
- Empty `sections: []` stubs are invalid; new/missing locale singles should be mirrored from a sibling.
- Content props stay locale-local. Topology + `showOn*` / generic layout sync across siblings in the structured UI.
- Changing `type` / `version` / `variant` does **not** auto-replicate — update sibling locales manually.
- **MCP does not auto-fan-out.** After a structural edit to one locale single, follow structured `next_actions` (exact tool name + `args_hint` + blast-radius `reason`) to update sibling `single.*.yml` files yourself. Soft prose warnings alone are not enough. Use `layout_target: "type_single"` | `"entry"` (or answer `confirm_layout_target`) so writes hit the shared single vs entry overlay intentionally. Mutating tool responses always include `warnings` and `next_actions` arrays via `ok()` / `actionRequired()`.

## Template variables

Content files may reference `{{ single.<field> }}` variables that are resolved at render time using the `field_mapping` for the content type. These expressions must survive YAML parsing — use `safeYamlLoad` which swaps them out temporarily.
