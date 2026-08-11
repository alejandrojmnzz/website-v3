# Local private databases (YAML item CRUD)

Private databases may be **local** (`source.type: local` → YAML under `db/{name}/`) or **remote** (API fetch). MCP item CRUD only supports **local**.

## Tools

| Tool | Cap | Notes |
|---|---|---|
| `list_databases` | `databases_manage` **or** `content_edit_text` | Prefer `local_only: true` for CRUD targets |
| `list_database_items` | same | Each row has global `index` |
| `get_database_item` | same | By global index |
| `add_database_item` | same | FAQ defaults + dedupe |
| `update_database_item` | same | Prefer `expect_question` |
| `delete_database_item` | same | Requires `confirm: true` |
| `reindex_database` | **`databases_manage` only** | After writes when `vector_search.enabled` |

Call `explain_site` topic `local_databases` before bulk FAQ bank edits.

## Global index (critical)

PATCH/DELETE use the position in the **full unfiltered** item array (all locales mixed).

- `list_database_items` with `locale=en` still returns each row’s **global** `index`.
- Never use “position on this filtered page” as the mutate index.
- Pass `expect_question` on update/delete when the item has a `question` field so a shifted index fails closed.

## FAQ bank (`frequently_asked_questions`)

File: `db/frequently_asked_questions/faqs.yml` (`results_path: faqs`).

Required on add: `question`, `answer`, `locale`.

Defaults if omitted: `last_updated` (today), `priority: 2`, `locations: ["all"]`.

Rejects duplicate `(locale, normalized question)`. Does **not** auto-create sibling locales.

Warns if `related_features.length > 2`.

## Side effects and non-effects

**Does:** write YAML; `clearCache`; `markFileAsModified` (content sync dirty).

**Does not:** push content GitHub; edit page sections / `hardcoded_entries` / `dynamic_entries`; auto-reindex (unless `reindex: true` and caller has `databases_manage`).

When vector search is enabled, mutate responses `next_actions` → `reindex_database` until reindexed.

## Delete safety

Without `confirm: true` → `action_required: confirm_delete` plus usage summary from `GET /api/databases/:name/usage` when available. Hard delete only.

## Related

- Staff UI: Private Databases + FAQ section editor.
- HTTP: `/api/databases/:name/items` (local only for writes).
- Semantic search: `explain_site` topic `semantic_search`.

## When to call this topic

Before adding/updating/deleting local DB rows (especially FAQ), or when an agent needs the global-index / sync / reindex mental model.
