# Routing

URL routing is entirely configuration-driven. No code changes are required to add a new page route — only a new YAML directory and an entry in `content-types.yml`.

## URL pattern rules

Each content type in `content-types.yml` declares a `url_pattern`. Two formats are supported:

**Per-locale** (most common):
```yaml
url_pattern:
  en: /en/career-programs/:slug
  es: /es/programas-de-carrera/:slug
```

**Shorthand** (same path for all locales):
```yaml
url_pattern:
  default: /landing/:slug
```

The `:slug` placeholder is replaced with the page's slug (folder name) at runtime.

## Locale prefixes

- English pages: `/en/` prefix — e.g. `/en/career-programs/ai-engineering`
- Spanish pages: `/es/` prefix — e.g. `/es/programas-de-carrera/ai-engineering`
- **Never use `/us/`** — this is incorrect and will break routing

## Active locales

<!-- @dynamic:active_locales -->
<!-- /dynamic -->

## How routes are generated

The frontend router reads all content types at startup and generates routes for every slug × locale combination it finds on disk. Adding a new YAML folder automatically creates a new route — no code change needed.

## Sitemap

Routes are also used to generate the sitemap automatically. Every page with a valid `url_pattern` and at least one **live** locale file (`en.yml` / `es.yml`) is included. Unpublished drafts (only `{variant}.{locale}.yml`) are not indexed and are not in the sitemap.

## Redirects (301/302)

CMS redirects are a separate first-match layer on top of URL patterns. Two stores: `{directory}/{slug}/{locale}.yml` `meta.redirects` (dest locale only) and `site_<name>/custom-redirects.yml`. Inspect with `test_redirect`; mutate with `update_redirect` (`seo_edit`). See `explain_site` topic `redirects`.

## DB-backed vs static slugs

For **database-backed** types (`database.slug` set), the slug comes from the database record via `field_mapping._slug`. For **static** types (including `single_template` types such as `blog`), the slug is the entry folder name / YAML identity (`_slug` → `slug`). The URL pattern still applies; `:slug` and other params (e.g. `:category`) resolve from mapped fields or folder data.

## Canonical URLs and Open Graph

Each page's `meta.canonical_url` field should match its resolved URL pattern. If omitted, the system auto-computes the canonical URL from the pattern. The `og:url` tag is injected alongside it.
