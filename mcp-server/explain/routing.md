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

Routes are also used to generate the sitemap automatically. Every page with a valid `url_pattern` and at least one locale file is included.

## DB-backed content types

For database-backed types (e.g. `blog`), the slug comes from the database record via `field_mapping._slug` rather than the file system. Static types also declare `_slug` (default identity `slug`). The URL pattern still applies; `:slug` is resolved from that mapping or the folder name.

## Canonical URLs and Open Graph

Each page's `meta.canonical_url` field should match its resolved URL pattern. If omitted, the system auto-computes the canonical URL from the pattern. The `og:url` tag is injected alongside it.
