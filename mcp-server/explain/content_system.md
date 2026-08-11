# Content System

All marketing content lives under `4geeks-com/`. Pages are YAML files grouped by content type directory.

## Directory layout

```
4geeks-com/
  content-types.yml       # single source of truth for all content types
  settings.yml            # site-wide settings (locales, optimization.tagmanager web_container_id + sGTM proxy,
                          # optimization.ip_normalization egress proxy at fixed /ipn/{id}/*, etc.)
                          # Cloudflare / entry-preview capture credentials are NOT stored here —
                          # env only: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
                          # ENTRY_PREVIEW_CAPTURE_SECRET (else SESSION_SECRET). Staff status UI:
                          # Debug Bubble → Settings → SEO/GEO → OG Image (display/test only; no writes).
                          # Legacy entry_preview keys in YAML are ignored; delete before content push.
                          # Web GTM ID is injected into the HTML shell from web_container_id (see server/gtm-web-inject.ts)
                          # IP Normalization: allowlisted destinations in settings.yml; shared secret is
                          # host env IPN_SECRET only (staff: Tracking → IP Normalization — display + Generate & copy).
                          # Empty IPN_SECRET while enabled → fail closed. Configure Constant + Request Headers
                          # in the GTM *server* container (not Stape admin).
                          # Recent /ipn calls: local .ipn-calls-state.txt (max 500), not content-repo / GitHub.
                          # Non-effect: does not call any CRM by name; side_effect of admin PUT: writes settings.yml.
  schema-org.yml          # Organization / Website (+ legacy catalogs) JSON-LD templates.
                          # Staff structured edit: Settings → SEO/GEO → Schema org; Brand tab still owns
                          # same_as / default_social_image / logos (dual write path — Brand fields not moved).
                          # Non-effect of OG capture env: does not edit schema-org.yml or Brand.
  image-registry.json     # centralized image metadata
  theme.json              # color theme tokens
  component-registry/     # versioned component schemas and examples
  menus/                  # menu definitions (navbar, footer, etc.)
  <type-directory>/       # one folder per content type (e.g. pages/, programs/)
    <slug>/
      _common.yml         # locale-independent fields (merged into every locale)
      en.yml              # English locale content (LIVE / published)
      es.yml              # Spanish locale content (LIVE / published)
      draft.en.yml        # unpublished draft (or any {variant}.{locale}.yml)
      versioning.yml      # optional: A/B / draft variant configuration
```

## Draft vs live vs variant

- **Draft entry:** folder has **no** live `{locale}.yml`. Content lives in `{variant}.{locale}.yml` (often `draft.en.yml`) + `versioning.yml` at 0%. ContentIndex skips it → public 404, not in sitemap. Create/duplicate (non-shared-layout) start this way. Publish with `publish_draft` (all remaining draft locales at once).
- **Live / published:** at least one `{locale}.yml` exists. Routable and sitemap-eligible (unless `robots: noindex`).
- **Variant (of a live page):** `{variant}.{locale}.yml` beside a live `{locale}.yml`, registered in `versioning.yml`. Traffic allocation allowed. `promote_variant` replaces live for one locale. Soft guidance: confirm with the user before promote/publish.
- **Shared-layout types** are excluded from draft-first create (still write live locales immediately). **Create/duplicate seeds exactly one live locale** — multi-locale create is rejected. A second language at create would go public before fields/body exist (broken listings/hreflang). Add translations later with `translate_entry` → `draft.{locale}.yml` → promote (detach first if still attached). Non-effects: create does not invent sibling locales; whole-entry draft-first remains out of scope for shared-layout.

## Merge behavior

When a page is loaded the system performs a deep merge: `_common.yml` fields are the base and the locale file overrides them. Arrays are replaced wholesale (not appended). This means locale-specific fields override shared ones for the same key.

## Safe loading — CRITICAL

**Never use raw `yaml.load()` on content files.** Always use `contentIndex.safeYamlLoad()` or higher-level `ContentIndex` methods. The safe loader handles template expressions like `{{ single.title }}` that contain characters (e.g. `:`) that break standard YAML parsing.

On the MCP server side, use the `safeLoad()` helper from `mcp-server/lib/content.ts`.

## Content types

Types are declared in `content-types.yml`. Each entry specifies:

- `directory` — subfolder inside `4geeks-com/`
- `url_pattern` — per-locale URL templates with `:slug` placeholder
- `field_mapping` — content-type **schema** keys. Non-underscore keys are available as `{{ single.* }}` and in the Fields tab (content-type fields, not SEO). Values are auto-fill sources: identity (same YAML/DB name); `{ source, default }` with required default (may be `null`); DB remap (column → schema key); `function:` computed. Mapping remaps are for **DB-attached types** and calculated fields — static YAML uses identity (schema key = YAML parent key). System identity is auto-exposed as `single.slug` / `single.locale` / `single.image` / `single.updated_at` and underscore aliases (`_slug`, `_locale`, `_image`, `_updated_at`). `_hreflangs` is routing-only (not a template var). `_updated_at` is DB-mappable; on static types it is inject-only from content-hash-gated sync-state (`getFileLastmod` / SHA change). **`published_at`** is reserved **editorial** go-live (authored in `_common.yml`, always ensured in mapping): stamped once on go-live (shared-layout/blog create; draft-first on `publish_draft` / first promote); omit on draft create (missing OK, never `""`); duplicates strip source date then re-stamp if live; static Fields edits write `_common.yml` (not locale root / FO); cannot clear to empty; not tied to YAML `status`; distinct from `_updated_at`. Do not declare regular keys `slug` or `image`. **Fields writes:** static types → **top-level root keys** on the active layer file (`{locale}.yml` or `{variant}.{locale}.yml`); DB-backed types → YAML `field_overrides` bag. API path stays `.../field-overrides` (historical name). MCP `update_entry_field` / `reset_entry_field` return `storage: "root_key" | "field_overrides"` plus concrete path in `side_effects`. Optional `variant` must exist (no live fallback); all-draft with no variant auto-resolves to `draft.{locale}.yml`. Live SEO/required gate skips draft/variant layers.
- `database.slug` — if present, the type is DB-backed; MCP `create_entry` cannot create those rows (use the DB/admin path). Do **not** confuse with `single_template: true` (e.g. static `blog`), which is YAML + shared `single.{locale}.yml` and **is** creatable via `create_entry`.
- `layout.menu` — which navbar/footer menus to render
- `schema_org_requirements` (optional) — list of `{ schema_type }` companions every entry must have as a leading `schema_org` section (e.g. location → `LocalBusiness`). Validated by `schema-org-companions` + live SEO gate. Coverage via `get_content_type_info`; attach missing with `ensure_content_type_schema_org` (seeds LocalBusiness from catalog / miami-usa|madrid-spain). Inspect resolved JSON-LD with `get_entry_seo` (not `get_entry_content`). Hero `course` variant separately requires a Course companion (`behaviors.schema_org.requires`).

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
- **Entry create:** exactly one live `{locale}.yml` (EN or ES — no primary special case). Gate: `createContentEntry` / MCP `create_entry`.
- **MCP does not auto-fan-out.** After a structural edit to one locale single, follow structured `next_actions` (exact tool name + `args_hint` + blast-radius `reason`) to update sibling `single.*.yml` files yourself. Soft prose warnings alone are not enough. Use `layout_target: "type_single"` | `"entry"` (or answer `confirm_layout_target`) so writes hit the shared single vs entry overlay intentionally. Mutating tool responses always include `warnings` and `next_actions` arrays via `ok()` / `actionRequired()`.

## Template variables

Content files may reference template expressions that are resolved at **delivery** time (API / SSR / menus / section render). Prefer the safe YAML loader so expressions survive parsing.

| Namespace | Source | Example |
|-----------|--------|---------|
| `{{ single.<field> }}` | Type schema / DB row / static root keys / `field_overrides` (DB); plus auto `slug`/`locale`/`image`/`updated_at` (and `_slug`/`_locale`/`_image`/`_updated_at`) | `{{ single.title }}`, `{{ single._slug }}`, `{{ single.updated_at }}` |
| `{{ meta.<key> }}` | Page SEO block (`meta:`), after `single.*` inside meta is resolved | `{{ meta.page_title }}` |
| `{{ param.<key> }}` | URL path params + querystring (path wins on conflict) | `{{ param.category }}`, `{{ param.utm }}` |
| `{{ brand.* }}` | Protected site identity in `variables.yml` (Brand Settings) | `{{ brand.logo }}`, `{{ brand.title }}` |
| `{{ global.* }}` / `reserved.*` | Other site variables in `variables.yml` | `{{ global.campus_phone }}` |

Resolve order at page delivery: **single → meta → param**. Site vars (`brand`/`global`) stay for React `SectionRenderer` (edit mode can preserve `{{ }}`); pass `skipSiteVars: false` only for non-React consumers (menus, schema.org, SEO, entry preview). Editors keep unresolved templates on write paths.

**Mental model:** schema / Fields stay in `single.*`. SEO Meta tab = SEO head only (`meta.*`). Mapping remaps are for DB columns and `function:` fields. New schema fields need a default; if no entry has the key yet, warn “new field”.

### Live SEO + Required for publish

- **Live locale writes / publish / promote** require resolved non-empty `meta.page_title` and `meta.description` (no leftover `{{ }}`). Draft-only writes are exempt. Gate: `server/live-entry-seo-gate.ts` + `shared/validateRequiredMeta.ts`.
- **`editor.<field>.required: true`** (Fields UI asterisk / YAML): drafts may omit the value; `publish_draft` / `promote_variant` and live saves fail if empty or cleared. Distinct from field_mapping `?` (key may be absent). Blog sets `title` + `description` required. Validator: `scripts/validation/validators/required-fields.ts`.
- **Circular trap (meta vs body):** Live saves validate SEO meta **and** editor.required fields on the post-write merged document. If both `meta.description` and body `description` are empty strings, fixing only one side still fails the other gate. Remedy: set all missing paths in **one** multi-field write — MCP `update_fields` (or `edit-sections` with multiple `update_field` ops). Multi-entry `update_meta_fields` is meta-only and cannot set body `description`. Failures return `code: live_required_fields` + `missing_fields` and MCP `action_required: fix_live_required_fields`.
- **schema_org companions:** CT `schema_org_requirements` (e.g. location → LocalBusiness) and hero `course` → Course must be present on merged sections or live save fails. Validator: `schema-org-companions`. Attach: `ensure_content_type_schema_org` / `POST .../schema-org-ensure`. Preview: `get_entry_seo.schema_org`.
- **Empty detached locale (`EMPTY_LOCALE`):** A live locale is empty only when the entry is **detached** (`detached: true` in `_common.yml`) **and** merged data has no sections (`missing` / `length === 0`) **and** no non-empty string `content`. Classic blogs with body in `content` are not empty. Attached shared-layout `sections: []` on the entry is normal (structure from `single.{locale}.yml`) and is **never** empty via this rule. Empty detached locales are hidden from listings / sitemap / hreflang; direct URL returns **HTTP 404** with a custom “not available in this language” body + links to public alternates (`noindex`). Helper: `shared/isEmptyLocaleContent.ts` + `server/empty-locale.ts`. Publish/promote/live writes are blocked. Manage UI surfaces all via `emptyLocales` + Errors. MCP `run_entry_diagnostics` / content-quality still scan live empty files so agents see `EMPTY_LOCALE`.
- **Non-effects:** clearing required fields on a draft is OK; listing `pickListingFields` does not invent fallbacks for missing title/description; emptiness is not a language classifier (no fuzzy “English shell” detection); mirrored sections stay **per-section** hide/`_label` only — an entire locale is not taken offline because some section was mirrored; the gate does **not** auto-copy `description` ↔ `meta.description`.

### Shared-layout translations (detach → draft → promote)

Agent loop for adding a locale on shared-layout types (e.g. blog):

1. **Detach** if still attached (`POST /api/content/{type}/{slug}/detach` / DebugBubble). Detach bakes **only locales that already have a live `{locale}.yml`** on the entry — never invents siblings from `supported_locales` / `single.*.yml`. Fails clearly if the entry has **zero** locale files.
2. **`translate_entry`** — requires detached entry (`action_required: require_detach` if attached). New target locale (no live file) → writes `draft.{locale}.yml` at 0% (`live: false`, `layer: "draft_locale"`, reason `new_locale_starts_as_draft`). Empty live stub → auto-convert to `draft.{locale}.yml` then write translation (`empty_live_converted_to_draft`). Non-empty live → overwrite live (SEO/required/empty gates). Not public until promote/publish.
3. Edit draft (`get_entry_content` with `variant: draft`) → `run_entry_diagnostics` with `slugs: [slug]` and `freshness: "hard"` (returns `queued` — do not wait) → poll `get_diagnostics_job` until `completed` → **`promote_variant`** (one locale on a live entry) or **`publish_draft`** (all-draft entry). Confirm with the user before promote/publish. Empty `validation_issues` without a completed job / `lastFullRunAt` is not proof the page is clean.

**Non-effects:** `translate_entry` does not AI-translate; it does not create live public stubs for new locales; detach does not create missing locale files; migrate script `scripts/migrate-empty-detached-locales.ts` moves leftover empty live stubs to draft.

### Entry preview (`preview.props`)

OG / list thumbnail captures map component props to source keys using the **same namespaces**:

- Schema / mapped field key → `single` bag (`title`, …)
- `meta.<key>` → entry SEO meta (loaded like the SEO UI; `{{ single.* }}` inside meta is expanded before apply)
- `brand.<key>` → `variables.yml` brand vars (resolved live at capture). Logo IDs (`brand.logo`, `brand.logo_dark`) are resolved to Media Gallery URLs for the screenshot.

Blocked (circular): `_image`, `image`, `og_image`, `meta.og_image`. Prefixes `brand.*` / `meta.*` are reserved (not dotted paths into the entry).

**Capture runtime:** Cloudflare Browser Run on the server (`regenerate_entry_previews` MCP / admin enqueue). Requires `locales[]` (mandatory). Variants/drafts are skipped. On success: WebP under `images/entry-previews/` (gitignored) and live `{locale}.yml` `meta.og_image` with `?t=` cache-bust — **unless** a distinct gallery/editorial `meta.og_image` / `_image` is already set. Credentials: host env only (`CLOUDFLARE_*`, optional `ENTRY_PREVIEW_CAPTURE_SECRET`, else `SESSION_SECRET` for signing). Staff SEO/GEO → OG Image is display/test only. Non-effects: no MCP tool writes those secrets; does not touch `settings.yml` for Cloudflare.

**Non-effects:** changing brand does **not** dirty / auto-recapture — brand is omitted from `propsHash`. Missing or unusable mapped sources fail **that** entry’s capture only; the queue continues. Capture does not `commitAndPush` by itself (AutoCommitQueue when enabled). Component gallery thumbs stay on client `modern-screenshot`.
