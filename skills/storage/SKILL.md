---
name: cef-cubby-state
description: Use when storing data, managing state, or sharing state between CEF agents. Covers the Cubby API (SQLite query/exec, migrations, instances, sqlite-vec), state machine pattern, deduplication, buffered flush, and instance-per-entity isolation.
---

# CEF Cubby & State Management

Cubbies are SQLite databases managed by the Orchestrator. Each cubby is defined with a migration-based schema and can have multiple independent instances. Agents interact with cubbies through `ctx.cubbies.{alias}`.

> **Reminder:** All handler code must be fully inline. No `import` or `require`. See the **coding** skill.

> **CRITICAL: Always pass instanceId explicitly.** While the API technically allows omitting instanceId (it defaults to `"default"` when the first argument looks like SQL), this heuristic has caused silent write failures in production: the call returns successfully but zero rows are written. Always pass `'default'` for shared state or an entity-specific ID for per-entity isolation.

## Accessing Cubbies

```typescript
// Access by alias (defined in cef.config.yaml)
const result = await ctx.cubbies.mission_report.query('default', 'SELECT * FROM activity');
await ctx.cubbies.mission_report.exec('default', 'INSERT INTO activity (drone_id, action) VALUES (?, ?)', ['drone_7', 'takeoff']);
```

No factory function; cubbies are exposed as properties on `ctx.cubbies` keyed by the alias defined in the cubby definition.

## query() and exec()

```typescript
// query() for reads (SELECT)
ctx.cubbies.{alias}.query(instanceId?, sql, params?) -> Promise<QueryResult>

// exec() for writes (INSERT/UPDATE/DELETE)
ctx.cubbies.{alias}.exec(instanceId?, sql, params?) -> Promise<ExecResult>
```

### Overloaded Signatures

The `instanceId` argument is optional. If the first string contains a space, it is treated as SQL and instanceId defaults to `"default"`.

```typescript
// Default instance
await ctx.cubbies.store.query('default', 'SELECT * FROM items');
await ctx.cubbies.store.query('default', 'SELECT * FROM items WHERE id = ?', [42]);

// Explicit instance
await ctx.cubbies.store.query('user_123', 'SELECT * FROM items');
await ctx.cubbies.store.query('user_123', 'SELECT * FROM items WHERE id = ?', [42]);
```

> **Always pass instanceId explicitly.** The heuristic is convenient but has caused silent failures in production. All examples in this skill use explicit instanceId for safety.

### Response Types

```typescript
// QueryResult
{ columns: string[], rows: unknown[][], meta: { duration: number, rowsRead: number } }

// ExecResult
{ rowsAffected: number, lastInsertId: number, meta: { duration: number, rowsRead: number } }
```

## Instances

Instances are independent SQLite databases within a cubby definition. They are created lazily on first access.

```typescript
// Per-entity isolation: each entity gets its own database
await ctx.cubbies.player_data.exec('player_abc', 'INSERT INTO scores (match_id, score) VALUES (?, ?)', ['m1', 100]);
await ctx.cubbies.player_data.exec('player_xyz', 'INSERT INTO scores (match_id, score) VALUES (?, ?)', ['m1', 200]);

// Shared state: pass 'default' explicitly
await ctx.cubbies.global_config.query('default', 'SELECT * FROM settings');
```

## State Machine Pattern

The fundamental pattern for persistent state: read -> process -> write.

```typescript
async function handle(event: any, ctx: any) {
    const { entityId, newItem } = event.payload;
    const instanceId = entityId;

    // Read
    const existing = await ctx.cubbies.my_domain.query(
        instanceId,
        'SELECT * FROM entity_state WHERE id = ?',
        [entityId]
    );
    const existingRows = existing.rows ?? []; // guard: deployed runtime returns null, not [] on empty

    if (existingRows.length === 0) {
        // Create
        await ctx.cubbies.my_domain.exec(
            instanceId,
            'INSERT INTO entity_state (id, count, updated_at) VALUES (?, ?, ?)',
            [entityId, 1, new Date().toISOString()]
        );
    } else {
        // Update
        const currentCount = existingRows[0][1];
        await ctx.cubbies.my_domain.exec(
            instanceId,
            'UPDATE entity_state SET count = ?, updated_at = ? WHERE id = ?',
            [currentCount + 1, new Date().toISOString(), entityId]
        );
    }

    // Append item
    await ctx.cubbies.my_domain.exec(
        instanceId,
        'INSERT INTO items (entity_id, data, added_at) VALUES (?, ?, ?)',
        [entityId, JSON.stringify(newItem), new Date().toISOString()]
    );

    const countResult = await ctx.cubbies.my_domain.query(
        instanceId, 'SELECT count FROM entity_state WHERE id = ?', [entityId]
    );
    return { count: countResult.rows[0][0] };
}
```

## Safe Reads

**`rows` can be `null` on the deployed platform when no data exists.** Local `cef dev` returns an empty array `[]`, but the deployed runtime returns `null`. Always guard with `?? []` before accessing `.length` or indexing — this is the most common cause of stage-only crashes.

```typescript
// ✅ Safe on both local dev and deployed
const result = await ctx.cubbies.store.query(instanceId, 'SELECT * FROM items WHERE id = ?', [itemId]);
const rows = result.rows ?? [];
if (rows.length === 0) {
    // No data found; use defaults
}
const firstRow = rows[0]; // safe

// ❌ Crashes on stage with "Cannot read properties of null (reading 'length')"
if (result.rows.length === 0) { ... }
```

Apply this guard to every query result before reading `.length` or indexing. Confirmed platform difference: deployed cubby runtime vs local sql.js in `cef dev`.

## Deduplication

### INSERT OR IGNORE

```typescript
// Schema: CREATE TABLE processed (event_id TEXT PRIMARY KEY, processed_at TEXT)
const check = await ctx.cubbies.dedup.query('default', 'SELECT 1 FROM processed WHERE event_id = ?', [eventId]);
if (check.rows.length > 0) return { skipped: true, reason: 'duplicate' };

// ... process event ...

await ctx.cubbies.dedup.exec('default',
    'INSERT OR IGNORE INTO processed (event_id, processed_at) VALUES (?, ?)',
    [eventId, new Date().toISOString()]
);
```

### UPSERT

```typescript
await ctx.cubbies.store.exec('default',
    `INSERT INTO entity_state (id, count, updated_at) VALUES (?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET count = count + 1, updated_at = ?`,
    [entityId, now, now]
);
```

## Buffered Flush Pattern

Accumulate rows, flush when a time window expires.

```typescript
const FLUSH_WINDOW_MS = 120000; // 2 minutes

async function handle(event: any, ctx: any) {
    const { entityId, entry } = event.payload;

    // Insert into buffer table
    await ctx.cubbies.buffer.exec(
        entityId,
        'INSERT INTO buffer (data, created_at) VALUES (?, ?)',
        [JSON.stringify(entry), Date.now()]
    );

    // Check if flush window expired
    const oldest = await ctx.cubbies.buffer.query(
        entityId, 'SELECT MIN(created_at) as oldest FROM buffer'
    );

    if (oldest.rows.length > 0 && oldest.rows[0][0]) {
        const elapsed = Date.now() - oldest.rows[0][0];
        if (elapsed >= FLUSH_WINDOW_MS) {
            // Read all buffered entries
            const buffered = await ctx.cubbies.buffer.query(
                entityId, 'SELECT data FROM buffer ORDER BY created_at'
            );
            const entries = buffered.rows.map(r => JSON.parse(r[0]));

            // Process buffer
            await processEntries(entries, entityId, ctx);

            // Clear buffer
            await ctx.cubbies.buffer.exec(entityId, 'DELETE FROM buffer');
        }
    }
}
```

## Cross-Agent Shared State

Two agents share data through the same cubby alias and instance.

**Writer agent:**

```typescript
async function handle(event: any, ctx: any) {
    const { instanceId, rows } = event.payload;
    for (const row of rows) {
        await ctx.cubbies.mission_report.exec(
            instanceId,
            'INSERT INTO notes (author, content) VALUES (?, ?)',
            [row.author, row.content]
        );
    }
    return { inserted: rows.length };
}
```

**Reader agent:**

```typescript
async function handle(event: any, ctx: any) {
    const { instanceId } = event.payload;
    return await ctx.cubbies.mission_report.query(
        instanceId,
        'SELECT author, content FROM notes ORDER BY id'
    );
}
```

## Vector Operations (sqlite-vec)

The SQLite engine includes `sqlite-vec` for vector similarity search.

```typescript
// Create vector table (width must match the embedding dimension)
await ctx.cubbies.embeddings.exec('default', `
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_items
    USING vec0(embedding float[768], +id TEXT, +metadata TEXT)
`);

// Insert embedding
await ctx.cubbies.embeddings.exec('default',
    'INSERT INTO vec_items (id, embedding, metadata) VALUES (?, ?, ?)',
    ['chunk_1', JSON.stringify(embedding), JSON.stringify({ source: 'wiki' })]
);

// KNN search
const results = await ctx.cubbies.embeddings.query('default',
    `SELECT id, metadata, distance
     FROM vec_items
     WHERE embedding MATCH ?
     ORDER BY distance LIMIT ?`,
    [JSON.stringify(queryEmbedding), 5]
);
```

> **Tip:** The `embedding` model (Qwen3 4B) supports MRL dimensions from 32 to 2560. Request a smaller dimension via `context.models.embedding.infer({ text, dimensions: 768 })` to cut cubby row size and speed up `sqlite-vec` search. Keep the `float[N]` column width matching the dimension you request. See the **inference** skill.

## Schema Definition

Define table schemas in `cef.config.yaml` migrations, not in handler code. `CREATE TABLE IF NOT EXISTS` inside a handler is unreliable: if the handler crashes before reaching that line, the table never gets created and all subsequent queries fail silently.

```yaml
# Always define schema in migrations
migrations:
  - version: 1
    up: "CREATE TABLE items (id INTEGER PRIMARY KEY, data TEXT, created_at TEXT)"
```

## Config (cef.config.yaml)

```yaml
cubbies:
  - alias: "mission_report"
    name: "Mission Report"
    description: "Per-mission structured data"
    migrations:
      - version: 1
        up: "CREATE TABLE notes (id INTEGER PRIMARY KEY, author TEXT, content TEXT)"
      - version: 2
        up: "ALTER TABLE notes ADD COLUMN created_at TEXT DEFAULT (datetime('now'))"
    maxSizeBytes: 10737418240
    idleTimeout: "24h"
```

Alias rules: valid JS identifier, unique within the Agent Service. Never modify existing migrations; only append new versions.

## Redeploy After Cubby Creation

After creating a new cubby via the orchestrator API, `ctx.cubbies.{alias}` will be `undefined` in handler code until the engagement is redeployed. The cubby alias only appears in `ctx.cubbies` after a deploy picks up the new definition.

```bash
# After creating cubby via API, redeploy engagement:
cef deploy --only engagement
```

If your handler crashes with `Cannot read properties of undefined (reading 'exec')` on a cubby alias, redeploy.

## Related Skills

- **coding**: Handler signature, Context API (models, agents, streams, rafts, image, emit, workspace), orchestration patterns, topology generation. For cropping/resizing/encoding images before hitting a model, use `context.image.*` (native, ~5ms) from the coding skill — do not store binary image bytes in a cubby for that purpose.
- **cli**: Config schema (cubby definitions, migrations), deploy commands, environment setup
- **inference**: `context.models.<alias>.infer/.stream`, the 16-model catalog, and the `embedding` model's MRL dimensions for vector storage
