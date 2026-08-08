# Component behavioral patterns

Structured `behaviors` on each component `schema.yml` declare how a section participates in platform patterns. Executable wiring stays in runtime code; this catalog is for staff and agents.

## Behavior ids

| Id | Meaning | Runtime | Non-effects |
|----|---------|---------|-------------|
| `ecommerce` | GA4-style ecommerce dataLayer funnel / catalog events | Client `trackEcommerce` in `client/src/lib/tracking.ts` | Does not charge; no on-site `purchase`; CMS does not manage billing plan catalogs |
| `schema_org` | Contributes JSON-LD during SSR | `server/schema-components` | Does not push GTM events by itself; OG/meta is separate |
| `listing` | Mapping fields + queries → card lists | `dynamic_entries` pipeline | Not a product SKU; not a lead form |
| `conversion` | Lead form conversion + webhook defaults | `form-settings` + `trackFormSubmission` | Not ecommerce funnel; CTA-only heroes are not conversions |

## CTA tracking (`cta.tracking`)

Bound via field-editor type `cta-tracking`. Required values: `none` | `add_to_cart` | `begin_checkout`.

| Value | When |
|-------|------|
| `none` | Apply, login, unrelated links |
| `add_to_cart` | Enter purchase configurator (`/payment-component`) |
| `begin_checkout` | External POS (`/checkout`) |

Example paths: `signup_card.cta_button.tracking`, `programs[].summary.cta.tracking`.

Save/MCP validation: missing tracking on bound paths fails; non-`none` requires a purchasable product in the ecommerce index.

## Product scope (exact paths)

| Component | Property path |
|-----------|---------------|
| `hero` course on program page | inherit entry slug; optional `ecommerce_products` |
| `hero` course elsewhere | `ecommerce_products` (`string[]` \| `"all"`) |
| `enrollment_selector` | `programs[].id`; optional `ecommerce_products: all` for shared hubs |
| `pricing_plans` | inherit or `ecommerce_products`; prices in content-owned `plans[]` |

See `shared/resolveProductScope.ts`. Agents: `explain_site` topic `ecommerce`.

## Funnel

Effective journey: top-of-funnel `funnel.traffic_sources` (content type + role, documentation only) → locked product page → authored `funnel.steps` in `_ecommerce.yml` → auto pages with `ecommerce_products: all`.

MCP: `get_product_funnel` / `update_product_funnel`. Property paths: `funnel.steps` (URL steps), `funnel.traffic_sources` (inbound types — not URL steps, not auto-detected).

Events: `view_item` → `add_to_cart` → `view_item_list` / `select_item` → `begin_checkout` → `purchase` (off-site only).
