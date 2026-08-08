# Component behavioral patterns

See [docs/component-behaviors.md](../../docs/component-behaviors.md) for the full catalog.

Agents: when adding tracking, SSR schema contributors, `dynamic_entries`, or `form-settings`, declare matching `behaviors` on that component's `schema.yml`.

## CTA tracking (exact paths)

CTA intent uses required `tracking` on CTA objects at **`cta-tracking` field-editor paths** — not URL sniffing.

Examples:

- `hero` course: `signup_card.cta_button.tracking` (bind `course:signup_card.cta_button`)
- `enrollment_selector`: `programs[].summary.cta.tracking`, `programs[].plans[].summary.cta.tracking`

Values: `none` | `add_to_cart` | `begin_checkout`.

## Ecommerce product scope + funnels

For product scope (`ecommerce_products`, `programs[].id`, inherit), conversion funnels, and “no CMS plans”, call **`explain_site` topic `ecommerce`** — it lists exact property paths per component.
