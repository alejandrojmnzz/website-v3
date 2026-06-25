# Images

All image content on the site goes through a centralized registry and a single `UniversalImage` component. Raw paths are never hardcoded in components or YAML files (with one documented exception).

## The image registry

`4geeks-com/image-registry.json` is the single source of truth for all images. Every image has a unique ID and metadata including:

- `src` — path relative to the project root
- `alt` — accessibility description
- `tags` — semantic categories (hero, logo, avatar, card, etc.)
- `preset` — which optimization preset to use

## Storage locations

<!-- @dynamic:image_storage -->
<!-- /dynamic -->

## How to reference an image in YAML

Always use the image ID:

```yaml
sections:
  - type: hero_twoColumn
    image_id: hero-ai-engineering-01
```

The `UniversalImage` component resolves the ID to the full registry entry and renders an optimized `<img>` with `srcset`.

## The UniversalImage component

`client/src/components/UniversalImage.tsx` is the **only** component that should render images. Never use:
- Raw `<img>` tags with hardcoded paths
- `<picture>` elements manually
- Any other image library

**Exception:** `HeroSingleColumn` uses `image: { src, alt }` object syntax (not `image_id`) and renders a direct `<img>` tag. It has a backward-compatible fallback to `UniversalImage` for legacy `image_id` data.

## Image presets

Presets define the optimization parameters applied to each image:

| Preset | Use case |
|---|---|
| `hero-wide` | Full-width hero images (16:9) |
| `hero-tall` | Vertical hero for mobile (9:16) |
| `card` | Card thumbnails (4:3) |
| `card-wide` | Wide card thumbnails (16:9) |
| `avatar` | Profile pictures (1:1) |
| `logo` | Company logos (variable ratio) |
| `icon` | Small icons (1:1) |
| `full` | Full-size, preserves ratio |

## Tag definitions

Images are tagged for semantic categorization. Tags include: `hero`, `logo`, `avatar`, `card`, `icon`, `photo`, `badge`, `partner`, `press`, `illustration`, `testimonial`, `team`, `award`.

## Adding a new image

1. Copy the file to `4geeks-com/images/` (new images) or `attached_assets/` (legacy only)
2. Add an entry to `image-registry.json` with a unique ID, `src`, `alt`, and appropriate tags
3. Reference the ID via `image_id` in YAML content files
