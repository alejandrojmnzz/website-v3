# Site Architecture Overview

This is a content-driven marketing platform built with React (Vite/TypeScript) on the frontend and Express on the backend. All public-facing pages are authored in YAML files stored in `4geeks-com/` and rendered dynamically by a `SectionRenderer` component.

## Core concepts

- **Content types** — defined in `4geeks-com/content-types.yml`. Each type has a directory, URL pattern, and optional field mappings. Some types are backed by a database (e.g. `blog`); the rest are pure YAML.
- **Sections** — every page is a list of section objects. Each section has a `type` that maps to a React component registered in `SectionRenderer`. Sections are authored in YAML and never in code.
- **i18n** — pages exist in one or more locales. Each locale has its own YAML file (`en.yml`, `es.yml`). Shared fields live in `_common.yml` and are deep-merged at read time.
- **Image registry** — all images are referenced by ID from `4geeks-com/image-registry.json`. Raw paths are never hardcoded in components.
- **Routing** — URL patterns are defined per content type in `content-types.yml`. English pages use `/en/` and Spanish pages use `/es/` prefixes.

## Active content types

<!-- @dynamic:content_types -->
<!-- /dynamic -->

## Active locales

<!-- @dynamic:active_locales -->
<!-- /dynamic -->

## Available topics

| Topic | When to use |
|---|---|
| `overview` | This file — start here for a general map of the codebase |
| `content_system` | How YAML content files are structured, merged, and loaded safely |
| `routing` | How URL patterns and locale prefixes work |
| `images` | How images are registered, referenced, and rendered |
| `sections` | How section components are defined, registered, and rendered |

**Before making any structural change to this codebase, call `explain_site` with the relevant topic.**
