# Cubby API

Cubbies are named key-value stores injected via `context.cubby(name)`. Each cubby has JSON, Vector, and primitive (Redis-style) sub-stores.

---

## Factory

```typescript
const cubby = context.cubby('my-cubby-name');
```

Cubby names should follow `{domain}-{concern}` convention:
- `sot-evals` — evaluation records
- `sot-deltas` — delta metadata
- `player-profile` — player state
- `mission-telemetry` — telemetry data

---

## JSON Store

Structured data with key-pattern queries.

```typescript
interface CEFCubbyJsonStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;  // glob patterns: 'faq:*/best'
}
```

### Usage

```typescript
const cubby = context.cubby('myStore');

// Write
await cubby.json.set('player:abc', { score: 100, level: 5 });

// Read
const data = await cubby.json.get('player:abc');

// Check existence
if (await cubby.json.exists('player:abc')) { ... }

// Pattern query
const allPlayers = await cubby.json.keys('player:*');
const allBest = await cubby.json.keys('faq:*/best');

// Delete
await cubby.json.delete('player:abc');
```

---

## Vector Store

Embedding storage with similarity search.

```typescript
interface CEFCubbyVectorStore {
  add(id: string, embedding: number[], metadata?: Record<string, unknown>): Promise<void>;
  get(id: string): Promise<{ vector: number[]; metadata?: Record<string, unknown> } | null>;
  search(
    vector: number[],
    options?: { limit?: number; filter?: Record<string, unknown> },
  ): Promise<Array<{ id: string; score: number; metadata?: Record<string, unknown> }>>;
  createIndex(config: { dimension: number }): Promise<void>;
}
```

### Usage

```typescript
const cubby = context.cubby('embeddings');

// Initialize
await cubby.vector.createIndex({ dimension: 768 });

// Store
await cubby.vector.add('chunk_1', embedding, { source: 'wiki', page: 'overview' });

// Search
const results = await cubby.vector.search(queryEmbedding, { limit: 5 });
// → [{ id: 'chunk_1', score: 0.95, metadata: { source: 'wiki' } }]
```

---

## Primitives (Redis-style)

String/counter operations on the cubby instance itself.

```typescript
interface CEFCubbyInstance {
  json: CEFCubbyJsonStore;
  vector: CEFCubbyVectorStore;

  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  del(key: string): Promise<void>;
  expire(key: string, seconds: number): Promise<void>;
}
```

### TTL

```typescript
// Short-lived intermediate data
await cubby.expire('job:123', 3600);        // 1 hour

// Long-lived archive
await cubby.expire('faq:001/best', 31536000); // 1 year

// No TTL = permanent (until deleted)
```

---

## Archive API (DRAFT — not yet shipped)

DDC-backed cold storage tier. Currently a stub — use `@cere-ddc-sdk/ddc-client` directly for now.

```typescript
// Future API (when shipped):
cubby.archive.snapshot({ prefix: '/important/' });
cubby.archive.restore(snapshotId, { mode: 'merge' });
cubby.archive.store('/reports/daily/2026-02-12', data);
cubby.archive.load('/reports/daily/2026-02-12');
cubby.archive.list('/reports/', { limit: 100 });
```

### Two-Tier Model

| Tier | Backing | Latency | Durability |
|------|---------|---------|------------|
| Hot | Redis Stack | < 1ms | Volatile (1GB, 24h TTL default) |
| Cold | DDC piece store | 10-100ms | Durable (erasure-coded, CID-based) |

---

## Key Schema Conventions

### Flat keys
```
{entity}:{id}                    → primary record
{entity}:{id}/{sub}              → sub-record
config:{name}                    → configuration
meta:{concern}                   → metadata / stats
```

### Namespaced (multi-agent)
```
faq:{id}/agent:{agentId}         → per-agent record
faq:{id}/agent:{agentId}/latest  → latest version pointer
faq:{id}/consensus               → cross-agent aggregate
meta:last_run:{agentId}          → per-agent run metadata
```

### Separate cubbies by concern
Use different cubbies for different TTL/access patterns:
- `sot-intermediate` — short TTL (1h), job results
- `sot-archive` — permanent, versioned history

## Key Naming Restrictions

- **No colons in keys.** Use `/` as separator instead.
- ✅ `complaints/2024-01-01`
- ✅ `player/abc/match/123`
- ❌ `complaints:2024-01-01`
- ❌ `faq:001/agent:gemini`

