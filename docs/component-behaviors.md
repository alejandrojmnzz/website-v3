# Component behavioral patterns

Structured `behaviors` on each component `schema.yml` declare how a section participates in platform patterns. Executable wiring stays in runtime code; this catalog is for staff and agents.

## Behavior ids

| Id | Meaning | Runtime | Non-effects |
|----|---------|---------|-------------|
| `ecommerce` | GA4-style ecommerce dataLayer funnel / catalog events | Client `trackEcommerce` in `client/src/lib/tracking.ts` | Does not charge; no on-site `purchase`; does not sync enrollment display prices from catalog |
| `schema_org` | Contributes JSON-LD during SSR | `server/schema-components` | Does not push GTM events by itself; OG/meta is separate |
| `listing` | Mapping fields + queries → card lists | `dynamic_entries` pipeline | Not a product SKU; not a lead form |
| `conversion` | Lead form conversion + webhook defaults | `form-settings` + `trackFormSubmission` | Not ecommerce funnel; CTA-only heroes are not conversions |

## CTA tracking (`cta.tracking`)

Bound via field-editor type `cta-tracking` (parallel to `form-settings`). Required values: `none` | `add_to_cart` | `click_begin_checkout`.

| Value | When |
|-------|------|
| `none` | Apply, login, unrelated links |
| `add_to_cart` | Enter purchase configurator (`/payment-component`) |
| `click_begin_checkout` | Click toward `/checkout` |

Save/MCP validation: missing tracking on bound paths fails; non-`none` requires a purchasable product in the ecommerce index.

## Funnel

`view_item` (hero course) → `add_to_cart` (payment-component CTA) → `view_item_list` / `select_item` (enrollment) → `click_begin_checkout` (checkout CTA on this site) → `begin_checkout` / `purchase` (off-site learn POS only).

## Ecommerce payload (UI vs central)

- **Call sites** supply context the central layer cannot know: enrollment `selected_plan_option` (`plans[].id`), `cohort_date`, `addon_id`, `amount`/`period`, and `item_list_name`.
- **Central** `trackEcommerce` resolves purchasable product identity (`item_id` / `item_name` / `item_category`) from `_ecommerce.yml` and no-ops when the product is missing or not purchasable.
- `selected_plan_option` is the enrollment selector option slug — not the learn.4geeks billing `plan` field.
- `cta-tracking` field-editors (hero course CTA, enrollment summary CTAs) set ecommerce **intent** (`none` | `add_to_cart` | `click_begin_checkout`). `cta_banner` does not bind `cta-tracking` and does not fire ecommerce events.
- Display price strings are not GA4 `value` / revenue.