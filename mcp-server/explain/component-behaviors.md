# Component behavioral patterns

See [docs/component-behaviors.md](../../docs/component-behaviors.md) for the full catalog.

Agents: when adding tracking, SSR schema contributors, `dynamic_entries`, or `form-settings`, declare matching `behaviors` on that component's `schema.yml`.

## Wipe on duplicate (derived)

Page/section duplicate clears identity fields — no `reset_on_duplicate` schema key:

- Any `conversion_name` under the section (incl. routes)
- Whole `ecommerce_products`
- CTA `tracking` on `cta-tracking` binds (delete key → save fails until set)

Not wiped: `programs[].id`, automations/tags/webhook, copy/layout.

Adding `form-settings` / `cta-tracking` / `ecommerce-products` **implies** wipe-on-duplicate. Ordinary props stay. Staff/API responses may include `clearedFields`.

**Identity gates (missing ≠ off):** wipe deletes keys. Save/publish/promote fail until re-decided. Opt-out: `conversion_name: null`, `ecommerce_products: null`, CTA `tracking: none`. Valid on: known conversion name; product slug list / `"all"` / `programs[].id` / program inherit; non-`none` CTA + purchasable product. **Exception:** nested `form-settings` object entirely absent (CTA-only) → no conversion_name required; lead tracking belongs on the submitting form (e.g. modal).

## CTA tracking (exact paths)

CTA intent uses required `tracking` on CTA objects at **`cta-tracking` field-editor paths** — not URL sniffing.

Examples:

- `hero` course: `signup_card.cta_button.tracking` (bind `course:signup_card.cta_button`)
- `enrollment_selector`: `programs[].summary.cta.tracking`, `programs[].plans[].summary.cta.tracking`

Values: `none` | `add_to_cart` | `begin_checkout`.

## Ecommerce product scope + funnels

For product scope (`ecommerce_products`, `programs[].id`, inherit), conversion funnels, and “no CMS plans”, call **`explain_site` topic `ecommerce`** — it lists exact property paths per component.
