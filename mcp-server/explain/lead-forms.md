# Lead forms: catalog source + purchasable

Lead-form (and nested `form:`) choice fields load options from `fields.*.source`. This is the dropdown contract — not `mergeLeadFormOptions` (label overlay only) and not `valid_lead_form_option` (removed).

## Source object (exactly one kind)

```yaml
# Vendible catalog (typical on home, upcoming-dates, blog, offer landings, sticky)
source:
  content_type: program
  query: "purchasable=true"

# Subset of that catalog
source:
  content_type: program
  query: "slug=ai-fluency,ai-flex"

# This entry’s relation pointers (landings / program pages that already inherit products)
source:
  relation: programs

# Private database catalog
source:
  database: some_db
  query: "status=open"
```

- Exactly one of `content_type` | `database` | `relation`.
- Runtime still reads legacy `name` / string shorthand during migration; do not write them.
- `options[]` overlays marketing labels — **does not filter**.
- `slugs` is ignored when `source` is set.
- EN and ES are separate files — no locale fan-out.

## `purchasable` vs `actively_selling`

| Key | Where | Meaning |
|---|---|---|
| `purchasable` | Computed `single.purchasable` + listing rows | Entry is in the ecommerce product index (`_ecommerce.yml` with `purchasable: true`). **Not authored** on `_common.yml`. |
| `actively_selling` | `_ecommerce.yml` | Store/vitrine pause. Default `true` if omitted. **Not** the lead-form filter. |

Ecommerce **on** for a content type = that type has **at least one** product in `server/ecommerce/ecommerce-index.ts` (`productMap`).

## Playbook

1. `explain_site` topic `lead-forms` (this file).
2. `get_content_type_info` → `ecommerce.enabled` + `system_fields: ["purchasable"]`.
3. `query_options` with `content_type` XOR `database`. **Unfiltered unless `query` is passed.** Items include `purchasable` when the type has ecommerce. Confirm the subset with the user.
4. Catalog forms on an ecommerce type **must** set `source.query`. Typical: `purchasable=true`. Exception: form **on a non-purchasable program page** → that program only (`source.relation` or `query: "slug=<this>"`), not the vendible catalog. Purchasable program pages that already inherit one product: leave relation/inherit.
5. Writes of `source.content_type` on an ecommerce type **without** `query` return `actionRequired` (`catalog_source_query_required`) with proposed `purchasable=true` or a slug subset. Re-call `update_fields` / `add_section` with query set. Real tools only — no `validate_content`.
6. `get_entry_fields` / `get_entry_content` show computed `purchasable` (`writable: false`). Do **not** write `single.purchasable`. Edit `_ecommerce.yml` or `get_product_funnel` / `update_product_funnel`.

## Non-effects

- `/api/query-options` and `query_options` do **not** auto-filter purchasable (relation pickers need the full list).
- `mergeLeadFormOptions` does not choose which programs appear.
- `actively_selling: false` does not remove a product from a `purchasable=true` form query in this cut.
- Navbar is not an offer catalog.
- Do not hardcode `content_type === "program"`.

## Paths

- Parse: `shared/parseFormFieldSource.ts`
- Catalog API: `server/query-options.ts`
- Index: `server/ecommerce/ecommerce-index.ts`
- Runtime: `client/src/components/lead_form/variants/LeadFormDefault.tsx`
- Staff UI: `client/src/components/editing/FormFieldsCard.tsx`
