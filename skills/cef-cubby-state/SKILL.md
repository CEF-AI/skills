---
name: cef-cubby-state
description: Use when storing data, managing state, or sharing state between CEF agents. Covers the Cubby API (SQLite query/exec, migrations, instances, sqlite-vec), state machine pattern, deduplication, buffered flush, and instance-per-entity isolation.
---

# CEF Cubby & State Management

Cubbies are SQLite databases managed by the Orchestrator. Each cubby is defined with a migration-based schema and can have multiple independent instances. Agents interact with cubbies through `ctx.cubbies.{alias}`.

> **Reminder:** All handler code must be fully inline. No `import` or `require`. See the **cef-agent-basics** skill.

## Accessing Cubbies

```typescript
// Access by alias (defined in cef.config.yaml)
const result = await ctx.cubbies.mission_report.query('SELECT * FROM activity');
await ctx.cubbies.mission_report.exec('INSERT INTO activity (drone_id, action) VALUES (?, ?)', ['drone_7', 'takeoff']);
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
await ctx.cubbies.store.query('SELECT * FROM items');
await ctx.cubbies.store.query('SELECT * FROM items WHERE id = ?', [42]);

// Explicit instance
await ctx.cubbies.store.query('user_123', 'SELECT * FROM items');
await ctx.cubbies.store.query('user_123', 'SELECT * FROM items WHERE id = ?', [42]);
```

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

// Shared state: omit instanceId (uses "default")
await ctx.cubbies.global_config.query('SELECT * FROM settings');
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

    if (existing.rows.length === 0) {
        // Create
        await ctx.cubbies.my_domain.exec(
            instanceId,
            'INSERT INTO entity_state (id, count, updated_at) VALUES (?, ?, ?)',
            [entityId, 1, new Date().toISOString()]
        );
    } else {
        // Update
        const currentCount = existing.rows[0][1];
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

SELECT queries return an empty `rows` array when no data exists. No try/catch needed for missing data.

```typescript
const result = await ctx.cubbies.store.query(instanceId, 'SELECT * FROM items WHERE id = ?', [itemId]);
if (result.rows.length === 0) {
    // No data found; use defaults
}
```

## Deduplication

### INSERT OR IGNORE

```typescript
// Schema: CREATE TABLE processed (event_id TEXT PRIMARY KEY, processed_at TEXT)
const check = await ctx.cubbies.dedup.query('SELECT 1 FROM processed WHERE event_id = ?', [eventId]);
if (check.rows.length > 0) return { skipped: true, reason: 'duplicate' };

// ... process event ...

await ctx.cubbies.dedup.exec(
    'INSERT OR IGNORE INTO processed (event_id, processed_at) VALUES (?, ?)',
    [eventId, new Date().toISOString()]
);
```

### UPSERT

```typescript
await ctx.cubbies.store.exec(
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
// Create vector table
await ctx.cubbies.embeddings.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_items
    USING vec0(embedding float[768], +id TEXT, +metadata TEXT)
`);

// Insert embedding
await ctx.cubbies.embeddings.exec(
    'INSERT INTO vec_items (id, embedding, metadata) VALUES (?, ?, ?)',
    ['chunk_1', JSON.stringify(embedding), JSON.stringify({ source: 'wiki' })]
);

// KNN search
const results = await ctx.cubbies.embeddings.query(
    `SELECT id, metadata, distance
     FROM vec_items
     WHERE embedding MATCH ?
     ORDER BY distance LIMIT ?`,
    [JSON.stringify(queryEmbedding), 5]
);
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

## Related Skills

- **cef-agent-basics**: Handler signature, runtime API, entity hierarchy
- **cef-cli**: Config schema, deploy commands, environment setup
- **cef-orchestration**: Multi-agent state sharing via cubby
- **cef-inference**: Storing inference results
