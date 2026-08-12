# Relation fields + authors hubs

## What `editor.type: relation` stores

- **Pointers only** — a slug string or `string[]` when `multiple: true`.
- Never write Person / related-entry JSON into the field. Create/edit Person data on the **source** content type (e.g. `authors`).
- Empty `[]` fails `required: true`.
- First array element = **primary** (byline / LD order).

```yaml
# blog _common.yml
authors:
  - ada-lovelace
  - bob
```

## Source namespace

`source` is a **content-type key** or **private DB slug**. Those namespaces must never collide (`findSourceNameCollisions` / `assertSourceNameAvailable`). Example rename: DB `lesson` → `lesson_tuples`.

Picker options come from `/api/query-options?source=…` (omit locale → entries present in **any** locale, deduped by value).

## Listing vs page

| Surface | Shape |
|--------|--------|
| Listing / list_cards | Keep slug pointers; display via **deslugify** (`shared/relation-field.ts`) |
| Page / SSR `{{ single.authors }}` | Hydrated object[] via `server/resolve-relations.ts` (locale + fallback) |

## Blog + authors (4geeks)

- Content type `authors` (seeded on `site_4geeks-com` only): public hubs, `immutable_slug`, protected default `4geeks-academy`.
- Blog `authors` relation is required, multi, stored on `_common.yml`, indexed.
- Article template must map explicitly:

```yaml
- type: article
  content: "{{ single.content }}"
  authors: "{{ single.authors }}"
```

Missing map → byline/LD may fall back to Organization; do not rely on silent React autoread.

## JSON-LD

Hydrated authors → `Person[]` with `url` / `@id` = author page. Broken / unresolved → **Organization** (not a fake Person).

## `delete_entries`

- Preview without `confirm: true` (dependents, `needs_reassignment`, blocked protected slugs).
- On confirm: best-effort `results[]`; cascade removes deleted author slugs from `blog.authors`.
- If a post would become `[]`: require **reassignment** (picker / `reassignments` map); default = `4geeks-academy`.
- Deleted author URLs **404** (no soft redirect).

## Agent tools

- `get_content_type_info` → `relation_fields[]`, `immutable_slug`, `protected_slugs`
- `delete_entries` → confirm + reassign
- `explain_site` topic `relation-fields` (this doc)
