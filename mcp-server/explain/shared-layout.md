# Shared-layout entries

Use this topic before creating or restructuring entries for types with `single_template: true` and/or `database.slug`.

## Mental model

- **Shell** (hero, article wrapper, CTA, FAQ, breadcrumb, …) lives in `{directory}/single.{locale}.yml` (plus `_common.single.yml` defaults). It applies to **all attached** entries of that type in that locale.
- **Entry fields** live in `{directory}/{slug}/_common.yml` + `{locale}.yml` — `title`, `description`, `content`, `category`, `meta`, etc. Attached entries normally use `sections: []`.
- **`db_backed` ≠ `single_template`.** Static blog is YAML + `single_template` and **is** creatable via MCP `create_entry`. DB-backed types are not (`create_via: null` from `get_content_type_info`).

Example (blog): body markdown is `content` on the locale file; `{{ single.content }}` is bound inside `blog/single.es.yml`. Do **not** paste a page shell (hero/breadcrumb/article) into the entry.

## Playbook (create)

1. `list_sites` — if multi-site, pick a domain and pass `site` on every later call.
2. `get_content_type_info` with `contentType` + `site` — read `field_mapping`, `editor.required`, URL params, observed values, `create_via`.
3. `create_entry` with **exactly one** locale for shared-layout; put required fields on the locale object; `sections: []` (or omit); put URL params / category on `common` as the type expects.
4. If a URL-param/select value is **not** in observed peers → stop; get approval from the **principal** (human or orchestrator/reviewer), then re-call with `confirm_new_values: true`.
5. Fill SEO via `update_fields` or multi-entry `update_meta_fields` if needed; verify with `get_entry_content` / `get_entry_seo`.
6. `run_entry_diagnostics` when ready.

## Anti-patterns

- Treating `single_template` types as DB-backed and skipping `create_entry`.
- Authoring breadcrumb/hero/article shells on the entry locale file.
- Calling `list_entry_seo` without `slugs` expecting a full dump (unfiltered returns a **minimal sample** only).
- Inventing new `:category` (or other URL-param) values without principal approval.

## Related tools

- `get_content_type_info`, `create_entry`, `list_entry_seo`, `get_entry_seo`, `get_entry_content`, `update_fields`, `list_sites`
- Topic `content_system` for merge / drafts / detach translate loop
