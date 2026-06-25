# AI Reskilling Platform

The AI Reskilling Platform is a minimalistic LMS for AI education, offering career path selection and skill acquisition.

## Run & Operate

_Populate as you build_

## Stack
- **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn UI, wouter, TanStack Query
- **Backend**: Express
- **ORM**: _Populate as you build_
- **Validation**: Zod (for component schemas and some backend data)
- **Build Tool**: Vite

## Where things live
- `/client/`: Frontend source code
- `/server/`: Backend source code
- `/4geeks-com/`: All content-related files (YAML, JSON)
    - `content-types.yml`: Single source of truth for content type definitions
    - `settings.yml`: Site-wide settings (e.g., i18n locales)
    - `image-registry.json`: Centralized image metadata
    - `theme.json`: Theme configuration (colors, etc.)
    - `component-registry/`: Versioned component schemas and examples
    - `db/<name>/config.yml`: Database configurations
    - `menus/`: Menu definitions
- `/shared/`: Shared types and schemas between frontend/backend
- `/scripts/validation/`: Content validation scripts

## Architecture decisions
- **Content-Driven Architecture**: Uses a YAML-based CMS (`4geeks-com/`) rendered dynamically by a `SectionRenderer`. Content types, settings, and menus are defined in YAML/JSON.
- **Dynamic Content Type & Routing**: `content-types.yml` defines all content types, which automatically generate frontend routes, API endpoints, and sitemap entries without code changes.
- **Universal Components**: `UniversalVideo` and `UniversalImage` are mandatory for all video and image content, enforcing consistent behavior, performance, and referencing a centralized image registry.
- **Hybrid Data Management**: Supports both static YAML-based content and dynamic database-backed content, with a unified field mapping and templating system (`{{ single.* }}` variables).
- **GitHub Content Sync with Auto-Commit**: Edits made via the inline editor are automatically committed back to GitHub, including webhook-driven auto-pulls and conflict resolution.

## Product
- Intuitive interface for career path selection and skill acquisition in AI education.
- Accessible, high-quality global education.
- Scalable, content-driven architecture.
- Future integration with 4geeks Breathecode API.

## User preferences
- Icon library: `@tabler/icons-react` (NEVER `lucide-react`)
- Design approach: Marketing-focused landing page
- Card border radius: 0.8rem throughout the platform
- Testing: NEVER use playwright for testing - it takes too much time. User prefers manual verification only.
- Font system: Noto Color Emoji for consistent emoji rendering across all operating systems
- Colors: ONLY semantic tokens - NEVER use hardcoded colors like `bg-blue-500`, `text-red-600`, or arbitrary hex values. Only use semantic classes: `bg-primary`, `text-foreground`, `bg-muted`, etc.
- Video: ALWAYS use the `UniversalVideo` component (`client/src/components/UniversalVideo.tsx`) for ALL video content. NEVER use raw `<video>` tags, `<iframe>` embeds, or other video libraries directly.
- Images: ALWAYS use the `UniversalImage` component (`client/src/components/UniversalImage.tsx`) for ALL image content. Reference images by ID from the centralized registry (`4geeks-com/image-registry.json`). NEVER use hardcoded image paths in components. Exception: `HeroSingleColumn` uses `image: { src, alt }` object syntax (not `image_id`) — renders a direct `<img>` tag, with backward compatibility fallback to `UniversalImage` for legacy `image_id` data.
- Image Storage: New images go in `4geeks-com/images/` (served at `/4geeks-com/images/`). Legacy images remain in `attached_assets/` (served at `/attached_assets/`). The `attached_assets/` folder also contains conversation screenshots which are excluded from the registry scanner and gitignored.
- URL Routing: Use `/en/` prefix for English pages and `/es/` prefix for Spanish pages. NEVER use `/us/` - this is incorrect. Example: `/en/geekforce-career-support` (correct), `/us/geekforce-career-support` (wrong).
- Agent Skills: All project-specific agent skills use the `internal-` prefix (e.g., `internal-image-gallery`). They live in `.agents/skills/` and are automatically loaded when working on related subsystems.

## Gotchas
- **Image Referencing**: Always use `UniversalImage` with `image_id` from `image-registry.json`. Hardcoded image paths are only for `HeroSingleColumn` (direct `src`).
- **Color Usage**: Strictly use semantic Tailwind classes (e.g., `bg-primary`), never hardcoded hex or utility colors (e.g., `bg-blue-500`).
- **Content File Loading**: NEVER use raw `yaml.load()` for content files; always use `contentIndex.safeYamlLoad()` or higher-level `ContentIndex` methods to ensure safe template variable handling and `_common.yml` merge logic.
- **Database-backed Content Editing**: For database-backed content types, sections and layouts are edited on shared templates (`single.{locale}.yml`), not per-entry `_common.yml` files. Changes apply to all entries of that type.
- **Slug Conflicts**: The system validates against duplicate slugs for non-DB content types at creation time and via diagnostics.

## Pointers
- **External API**: 4geeks Breathecode API for future integrations.
- **i18n**: `react-i18next` documentation for internationalization.
- **UI Components**: shadcn UI and Tailwind CSS documentation for styling.
- **Data Fetching**: TanStack Query documentation for client-side data management.
- **Content Schema**: Refer to `4geeks-com/content-types.yml` for all content type definitions.
- **Image Registry Schema**: Refer to `shared/schema.ts` for the `image-registry.json` schema.