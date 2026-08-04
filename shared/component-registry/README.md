# Shared component registry

Platform-default section components available to every site.

- Keep this catalog small (about ≤12 types).
- During early rollout this folder may contain only `_common` and **no** component types (intentionally empty).
- A type must not also exist under `site_*/component-registry/` — boot fails on collision.
- Shared packages may import only `shared/component-registry/_common` (never site helpers).
- Gallery screenshots for shared types live under each type’s `screenshots/` directory.

Site-only components stay in `site_<name>/component-registry/` (content-synced).
