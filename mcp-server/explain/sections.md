# Sections

Every page on the site is built from a list of section objects. Sections are authored in YAML, stored in content files, and rendered dynamically by `SectionRenderer`.

## How sections work

A page's YAML file contains a top-level `sections` array:

```yaml
sections:
  - type: hero_twoColumn
    variant: default
    title: Learn AI Engineering
    subtitle: Build real-world skills
    image_id: hero-ai-01

  - type: features_quad
    variant: grid
    title: What you'll learn
    items:
      - title: Python
        description: Industry-standard language for AI
```

Each section object must have a `type` field that maps to a registered React component. The `variant` field selects which visual variant of the component to render (defaults to `default` if omitted).

## SectionRenderer

`client/src/components/SectionRenderer.tsx` maps section types to React components. When the `type` field matches a registered key, it renders the corresponding component with the YAML object as props.

To add a new section type you must:
1. Create the React component in `client/src/components/sections/`
2. Register the component type in `SectionRenderer`
3. Add a schema entry in `4geeks-com/component-registry/<type>/v1/schema.yml`
4. Add example YAML in `4geeks-com/component-registry/<type>/v1/`

## Component registry

`4geeks-com/component-registry/` contains versioned schemas for each section component. Each component has:

```
component-registry/
  <component-type>/
    v1/
      schema.yml    # component description, props, variants
      example.yml   # example YAML usage
```

The schema defines:
- `name` — human-readable component name
- `description` — what the component does
- `when_to_use` — guidance for content editors
- `variants` — map of variant names to descriptions and `best_for` text
- `variant_props` — per-variant prop definitions

## Variants

A single component can have multiple visual layouts controlled by the `variant` field in YAML. For example, `features_quad` might have `grid`, `list`, and `carousel` variants. Always consult the component schema (via the `get_component_schema` MCP tool) before writing a section to understand which variants are available.

## Split articles and shared TOC (`toc_group`)

Long-form pages often insert a CTA (or other section) between two halves of an article. Use **two `article` sections** on the same page rather than one oversized block.

Before adding a second (or later) `article`, **ask the user** whether those articles should share one table of contents:

- **Yes — share TOC:** set the same `toc_group` string on every article (e.g. `group_482910374`). Only the first article in page order should have `show_toc: true`; later ones use `show_toc: false`. Headings from all members merge into one TOC. See `get_component_variant` → article example `article_split_toc_group`.
- **No — separate:** omit `toc_group` (each article can have its own TOC or none).

A page should use at most **one** `toc_group` value across its articles (all share, or none share). The editor UI prompts for this when adding articles; MCP agents should ask proactively the same way. If you already added a second article without grouping, `add_section` may return warning `article_toc_group_suggested` with `next_actions` to apply `toc_group` via `update_section_fields`.

## Database-backed content types

For DB-backed types (e.g. `blog`), sections are defined in shared template files (`single.en.yml`, `single.es.yml`) rather than per-entry files. Changes to these templates affect **all** entries of that content type. Never edit per-entry YAML for DB-backed types — it does not exist.

## Images in sections

Always reference images by `image_id` (registry ID), never by raw path. The `UniversalImage` component resolves the ID at render time. See the `images` topic for details.

## Safe YAML loading

Sections may contain template variables like `{{ single.title }}`. Always load section YAML through the safe loader (`safeYamlLoad` / `safeLoad`) — never raw `yaml.load()`.
