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

Bound via field-editor type `cta-tracking` (parallel to `form-settings`). Values: `none` | `add_to_cart` | `begin_checkout`. Optional — absent/empty ≡ `none`.

| Value | When |
|-------|------|
| `none` (or omitted) | Apply, login, unrelated links |
| `add_to_cart` | Enter purchase configurator (`/payment-component`) |
| `begin_checkout` | External POS (`/checkout`) |

Save/MCP validation: invalid tracking values fail; non-`none` requires a purchasable product in the ecommerce index. Missing tracking is allowed.

## Funnel

`view_item` (hero course) → `add_to_cart` (payment-component CTA) → `view_item_list` / `select_item` (enrollment) → `begin_checkout` (checkout CTA) → `purchase` (off-site POS only).
