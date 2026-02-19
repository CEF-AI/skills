# RAFT Indexer Pattern

Pre-process and categorize stream data so agents receive "data ready" signals instead of collecting data themselves.

---

## Architecture

```
External source (webhook, API)
    │
    ▼
Stream (workspace stream)
    │ tagged with: source_id, topic, timestamp
    ▼
RAFT (preprocessor)
    │ classify → batch → store
    │ no compute cost — filter/map/reduce only
    ▼
Pre-indexed data ready for agents
    │ signal: "your data is ready"
    ▼
Agent consumes pre-indexed data
```

## Key Insight

> "The agent receives a signal that says 'what you need is already here.' It doesn't need to collect anything — it's already pre-indexed."

---

## Topic Classification

Rules-based first, ML-based optional:

```typescript
class TopicClassifier {
  classify(title: string, content: string): TopicCategory {
    // Keyword scoring: title words weighted 3x, first 500 chars of content weighted 1x
    // Match against category keyword lists
    // Return highest-scoring category
  }
}
```

### Category convention

| Category | Label | Description |
|----------|-------|-------------|
| A | Product | Features, use cases, product docs |
| B | Technical | Architecture, APIs, implementation |
| C | Business | Partnerships, market, BD |
| D | Operations | Team, process, legal |

Categories are configurable via `config/topics.json`.

---

## Change Detection

Don't re-process unchanged content:

```typescript
// 1. Hash incoming content
const contentHash = sha256(content);

// 2. Compare against last-known hash in cubby
const existing = await cubby.json.get(`page:${pageId}`);
if (existing?.contentHash === contentHash) return null; // no change

// 3. Store new delta metadata
const delta = { deltaId, title, category, contentHash, timestamp };
await cubby.json.set(`page:${pageId}`, delta);
```

---

## RAFT KV for Category Indices

```typescript
// Store delta reference in category list (Redis list)
await context.kv.rpush(`delta:cat:${category}`, deltaKey);

// Store delta content (Redis hash)
await context.kv.hset(deltaKey, {
  page_id: pageId,
  page_title: title,
  content: content,
  category: category,
});

// Keep list bounded
await context.kv.ltrim(`delta:cat:${category}`, -100, -1);

// Read recent deltas for a category
const keys = await context.kv.lrange(`delta:cat:${category}`, -20, -1);
```
