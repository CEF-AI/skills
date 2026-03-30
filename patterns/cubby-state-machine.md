# Cubby State Machine Pattern

A cubby state machine reads existing state via SQL SELECT, processes new input, and writes updated state back via SQL INSERT/UPDATE. This is the fundamental pattern for persistent state management in CEF agents.

---

## When to Use

- Agent needs to maintain state across invocations (e.g. entity counters, accumulated records, violation buffers)
- State grows incrementally with each event
- Multiple agents read/write the same state (shared cubby alias + instance)
- You need queryable, structured data with indexes and constraints

---

## Structure

```
Event arrives
  -> SELECT current state from cubby (empty rows = no prior state)
  -> Process input against current state
  -> INSERT/UPDATE state back to cubby
  -> Return result
```

---

## Inline Template

```typescript
async function handle(event: any, ctx: any) {
    const { entityId, newItem } = event.payload;
    const instanceId = entityId;

    // Read current state
    const existing = await ctx.cubbies.my_domain.query(
        instanceId,
        'SELECT id, count, updated_at FROM entity_state WHERE id = ?',
        [entityId]
    );

    const now = new Date().toISOString();

    if (existing.rows.length === 0) {
        // Initialize state
        await ctx.cubbies.my_domain.exec(
            instanceId,
            'INSERT INTO entity_state (id, count, updated_at) VALUES (?, ?, ?)',
            [entityId, 0, now]
        );
    }

    // Append item
    await ctx.cubbies.my_domain.exec(
        instanceId,
        'INSERT INTO items (entity_id, data, added_at) VALUES (?, ?, ?)',
        [entityId, JSON.stringify(newItem), now]
    );

    // Update count
    await ctx.cubbies.my_domain.exec(
        instanceId,
        'UPDATE entity_state SET count = count + 1, updated_at = ? WHERE id = ?',
        [now, entityId]
    );

    // Read back final count
    const result = await ctx.cubbies.my_domain.query(
        instanceId,
        'SELECT count FROM entity_state WHERE id = ?',
        [entityId]
    );

    return { count: result.rows[0][0] };
}
```

---

## Key Techniques

### Safe reads

SELECT returns an empty `rows` array when no data exists. No try/catch needed.

```typescript
const result = await ctx.cubbies.store.query(instanceId, 'SELECT * FROM items WHERE id = ?', [itemId]);
const data = result.rows.length > 0 ? result.rows[0] : null;
```

### Append pattern

Insert new rows into a table instead of pushing to an array.

```typescript
await ctx.cubbies.store.exec(
    instanceId,
    'INSERT INTO utterances (match_id, text, sentiment, created_at) VALUES (?, ?, ?, ?)',
    [matchId, text, sentiment, new Date().toISOString()]
);
```

Query all items for an entity:

```typescript
const all = await ctx.cubbies.store.query(
    instanceId,
    'SELECT text, sentiment FROM utterances WHERE match_id = ? ORDER BY created_at',
    [matchId]
);
```

### Instance-scoped isolation

Use instanceId to isolate data per entity. Each instanceId gets its own SQLite database.

```typescript
// Production: per-player instance
const instanceId = playerId;
await ctx.cubbies.player_data.exec(instanceId, 'INSERT INTO scores ...', [...]);

// Testing: per-test-run instance
const instanceId = `test_${testRunId}`;
await ctx.cubbies.player_data.exec(instanceId, 'INSERT INTO scores ...', [...]);
```

### Deduplication

Prevent duplicate processing using SQL constraints.

```typescript
// Schema: CREATE TABLE processed (event_id TEXT PRIMARY KEY, processed_at TEXT)
const check = await ctx.cubbies.store.query('SELECT 1 FROM processed WHERE event_id = ?', [eventId]);
if (check.rows.length > 0) return { skipped: true, reason: 'duplicate' };

// ... process event ...

await ctx.cubbies.store.exec(
    'INSERT OR IGNORE INTO processed (event_id, processed_at) VALUES (?, ?)',
    [eventId, new Date().toISOString()]
);
```

### UPSERT for idempotent writes

```typescript
await ctx.cubbies.store.exec(
    `INSERT INTO entity_state (id, count, updated_at) VALUES (?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET count = count + 1, updated_at = ?`,
    [entityId, now, now]
);
```

### Buffered flush

Accumulate rows in a buffer table, flush when a time window expires.

```typescript
const FLUSH_WINDOW_MS = 120000;

// Insert into buffer
await ctx.cubbies.store.exec(
    instanceId,
    'INSERT INTO buffer (data, created_at) VALUES (?, ?)',
    [JSON.stringify(entry), Date.now()]
);

// Check oldest entry
const oldest = await ctx.cubbies.store.query(
    instanceId, 'SELECT MIN(created_at) FROM buffer'
);
if (oldest.rows[0][0] && Date.now() - oldest.rows[0][0] >= FLUSH_WINDOW_MS) {
    const buffered = await ctx.cubbies.store.query(
        instanceId, 'SELECT data FROM buffer ORDER BY created_at'
    );
    await processBuffer(buffered.rows.map(r => JSON.parse(r[0])));
    await ctx.cubbies.store.exec(instanceId, 'DELETE FROM buffer');
}
```

### Time-series queries with SQL

Use SQL WHERE clauses instead of key pattern matching.

```typescript
// Range query
const events = await ctx.cubbies.store.query(
    instanceId,
    'SELECT * FROM events WHERE ts BETWEEN ? AND ? ORDER BY ts',
    [startTime, endTime]
);

// Latest N
const recent = await ctx.cubbies.store.query(
    instanceId,
    'SELECT * FROM events ORDER BY ts DESC LIMIT ?',
    [10]
);

// Aggregation
const stats = await ctx.cubbies.store.query(
    instanceId,
    'SELECT COUNT(*) as total, AVG(score) as avg_score FROM events WHERE entity_id = ?',
    [entityId]
);
```

---

## Schema Design Tips

- Use `INTEGER PRIMARY KEY` for auto-incrementing IDs
- Add indexes on columns used in WHERE clauses and JOINs
- Store JSON blobs as TEXT columns; parse in application code
- Use `created_at TEXT DEFAULT (datetime('now'))` for automatic timestamps
- Design tables around query patterns; denormalize where it simplifies reads
