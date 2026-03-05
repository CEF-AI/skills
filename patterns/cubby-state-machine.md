# Cubby State Machine Pattern

A cubby state machine reads existing state from cubby, processes new input, writes updated state back. This is the fundamental pattern for persistent state management in CEF agents.

**Extracted from:** `Gaming Demo Agents/gameDataAgent.ts`, `Gaming Demo Agents/topicAgent/*`, `Gaming Demo Agents/conciergeAgent.ts`

---

## When to Use

- Agent needs to maintain state across invocations (e.g., a topic tree, match history, violation buffer)
- State grows incrementally with each event
- Multiple agents read/write the same state (agent-to-agent sharing via cubby)
- You need pattern-based key queries or time-series data

---

## Structure

```
Event arrives
  → Read current state from cubby (with fallback for missing keys)
  → Process input against current state
  → Write updated state back to cubby
  → Return result
```

---

## Inline Template

```typescript
const CUBBY_NAME = 'my-domain';

interface EntityState {
    id: string;
    count: number;
    items: any[];
    updatedAt: string;
}

function createEmptyState(id: string): EntityState {
    return {
        id,
        count: 0,
        items: [],
        updatedAt: new Date().toISOString()
    };
}

async function getOrCreate(key: string, id: string, cubby: any): Promise<EntityState> {
    try {
        const existing = await cubby.json.get(key);
        if (existing) return existing;
    } catch (_) {}
    const empty = createEmptyState(id);
    await cubby.json.set(key, empty);
    return empty;
}

async function handle(event: any, context: any) {
    const { entityId, newItem } = event.payload;
    const cubby = context.cubby(CUBBY_NAME);

    // Read
    const key = `entity/${entityId}/state`;
    const state = await getOrCreate(key, entityId, cubby);

    // Process
    state.items.push({
        ...newItem,
        addedAt: new Date().toISOString()
    });
    state.count = state.items.length;
    state.updatedAt = new Date().toISOString();

    // Write
    await cubby.json.set(key, state);

    return { count: state.count };
}
```

---

## Key Techniques

### Safe reads with fallback

Cubby reads may fail if the key doesn't exist. Always wrap in try/catch or use `exists()`:

```typescript
// Pattern 1: try/catch
let data: any = null;
try { data = await cubby.json.get(key); } catch (_) {}
if (!data) data = defaultValue;

// Pattern 2: exists() check
const data = await cubby.json.exists(key) ? await cubby.json.get(key) : defaultValue;
```

### Append-to-array pattern

Most common state mutation — append new items to an existing array:

```typescript
const key = `player/${playerId}/match/${matchId}/utterances`;
const existing = await cubby.json.exists(key) ? await cubby.json.get(key) : [];
existing.push({
    id: `${matchId}-${Date.now()}`,
    text,
    sentiment,
    timestamp: new Date().toISOString()
});
await cubby.json.set(key, existing);
```

### Hierarchical key schema

Organize cubby keys in a hierarchy that enables pattern queries:

```
entity/{entityId}/state               ← primary state
entity/{entityId}/items/{timestamp}   ← time-series items
entity/{entityId}/summary             ← computed summary
```

Query with glob patterns:

```typescript
const allItemKeys = await cubby.json.keys(`entity/${entityId}/items/*`);
```

### CID-scoped state (test isolation)

Use a correlation ID (CID) in the key path to isolate test runs from production:

```typescript
// Test mode: CID-scoped
const key = mode === 'production'
    ? `player/${playerId}/tree`
    : `player/${playerId}/${cid}/tree`;
```

### Deduplication via cubby

Prevent duplicate processing of events:

```typescript
const dedupKey = `processed/${eventId}`;
const existing = await cubby.get(dedupKey).catch(() => null);
if (existing) return { skipped: true, reason: 'duplicate' };

// ... process event ...

await cubby.set(dedupKey, JSON.stringify({ processedAt: Date.now() }));
```

### Buffered flush pattern

Accumulate items in a buffer, then flush when a time window expires:

```typescript
const FLUSH_WINDOW_MS = 120000; // 2 minutes

const bufKey = `entity/${entityId}/buffer`;
let buf: any = null;
try { buf = await cubby.json.get(bufKey); } catch (_) {}
if (!buf || !Array.isArray(buf.entries)) {
    buf = { startedAt: Date.now(), entries: [] };
}

buf.entries.push(newEntry);
await cubby.json.set(bufKey, buf);

// Check if window expired
const elapsed = Date.now() - buf.startedAt;
if (elapsed >= FLUSH_WINDOW_MS && buf.entries.length > 0) {
    // Flush: deduplicate, aggregate, persist
    await processBuffer(buf.entries, cubby, context);
    await cubby.json.set(bufKey, { startedAt: Date.now(), entries: [] });
}
```

---

## Production Example: Topic Tree

The gaming demo maintains a per-player topic tree in cubby. Topics are created from clustered embeddings, matched by cosine similarity, and updated with new data on each utterance:

```
player/{playerId}/tree                    ← PlayerTree with topics map
player/{playerId}/match/{matchId}/utterances  ← Array of utterances with topicId backfill
player/{playerId}/match/{matchId}/patterns    ← Pattern analysis results
player/{playerId}/match/{matchId}/moments     ← Game event moments
```

State flow:
1. `getOrCreateTree()` — read or initialize empty tree
2. For each utterance: embed → match topic → update topic (or accumulate unassigned)
3. At match end: cluster unassigned → create new topics → backfill topicIds
4. `saveTree()` — write updated tree back with incremented matchCount
