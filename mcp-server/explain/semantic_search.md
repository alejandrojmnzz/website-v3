# Semantic search (Qdrant)

Private databases can search by meaning, not only exact keywords. That requires a running Qdrant vector store plus a local embedding model.

## Stack

| Piece | Detail |
|---|---|
| Vector DB | Qdrant (`QDRANT_URL`, default `http://localhost:6333`) |
| Embeddings | Local `Xenova/all-MiniLM-L6-v2` (384-d, Cosine) — **not** OpenRouter |
| Runtime | `server/vector-search.ts` |
| Job state | `server/db-job-state.ts` → `{contentRoot}/.db-job-state.json` |

Collection name = database name. Indexing recreates the collection and upserts points in batches of 32.

## Config

Per-database YAML/config:

```yaml
vector_search:
  enabled: true
  fields: [title, description]  # fields concatenated into the embedded text
```

Staff enable fields under Private Databases → Settings → Field Mappings. Re-index via `POST /api/databases/:name/reindex` or the Qdrant settings UI.

## Search behavior

`GET /api/databases/:name/search?q=…`

- Healthy semantic path: `{ items, count, semantic: true, scores }`
- Fallback: `{ semantic: false, fallback_reason, fallback_message }`
  - `vector_store_unavailable` — Qdrant unreachable
  - `semantic_index_empty` — enabled but no usable index

Non-effects: embeddings do not use `OPENROUTER_API_KEY`; keyword fallback still works when Qdrant is down.

## Staff / ops

| What | Where |
|---|---|
| Health UI | `/private/settings/ai/qdrant` |
| Status API | `GET /api/admin/qdrant/status` (admin auth) — host, port, error, collections, per-DB index jobs |
| Dashboard | `http://localhost:6333/dashboard` (local default) |

Local Docker example:

```bash
docker run -d --name qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant:v1.13.4
```

## When to call this topic

Call `explain_site` with `semantic_search` before changing vector indexing, database search fallbacks, Qdrant wiring, or the AI Settings Qdrant page.
