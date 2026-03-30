# Stream Processor Pattern

A stream processor subscribes to a CEF stream and processes packets in a long-running `for await` loop. Each packet is parsed, dispatched based on event type, and results are stored or forwarded.

**Derived from:** Production agent deployments (multi-stream sync, continuous event processing)

---

## When to Use

- Events arrive continuously from a data source (sensors, streams, webhooks)
- Different event types in the same stream need different handling
- The handler must run as long as the stream is active
- Events need timestamp-based synchronization or windowing

---

## Structure

```
Stream subscription
  → for await (packet of stream)
    → Decode packet (bytesToString → JSON.parse)
    → Extract event_type
    → Dispatch to appropriate handler
    → Persist results
    → Check for termination signal
```

---

## Inline Template

```typescript
function bytesToString(bytes: Uint8Array): string {
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return str;
}

async function handle(event: any, context: any) {
    const streamId = event.payload.streamId;

    if (!streamId) {
        context.log('Missing streamId');
        return;
    }

    const stream = await context.streams.subscribe(streamId);
    context.log('Subscribed to stream');

    for await (const packet of stream) {
        try {
            const payloadStr = bytesToString(packet.payload);
            const data = JSON.parse(payloadStr);
            const eventType = data.event_type;
            const entityId = data.entityId || 'unknown';
            const timestamp = typeof data.timestamp === 'string'
                ? new Date(data.timestamp).getTime()
                : data.timestamp || Date.now();

            if (eventType === 'DATA_TYPE_A') {
                await context.cubbies.myStore.exec(
                    entityId,
                    'INSERT INTO type_a (entity_id, data, ts, stored_at) VALUES (?, ?, ?, ?)',
                    [entityId, JSON.stringify(data), timestamp, Date.now()]
                );
            } else if (eventType === 'DATA_TYPE_B') {
                const result = await context.agents.processor.process(data);
                await context.cubbies.myStore.exec(
                    entityId,
                    'INSERT INTO type_b (entity_id, data, ts) VALUES (?, ?, ?)',
                    [entityId, JSON.stringify(result), timestamp]
                );
            } else if (eventType === 'COMPLETE') {
                context.log('Stream complete');
                break;
            }
        } catch (error) {
            context.log(`Failed to process packet: ${error.message}`);
        }
    }
}
```

---

## Key Techniques

### Packet decoding

Stream packets arrive as `Uint8Array`. Always decode with the inline `bytesToString` function:

```typescript
function bytesToString(bytes: Uint8Array): string {
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return str;
}

const data = JSON.parse(bytesToString(packet.payload));
```

### Time-series queries

With SQL, timestamp indexing is built into the table schema. Create an index on the `ts` column for efficient range queries.

```typescript
// Range query
const events = await context.cubbies.myStore.query(
    entityId,
    'SELECT * FROM events WHERE stream_type = ? AND ts BETWEEN ? AND ? ORDER BY ts',
    [streamType, startTime, endTime]
);
```

### Windowed synchronization

Match events from different streams within a time window using SQL:

```typescript
const SYNC_WINDOW_MS = 3000;

async function findInWindow(entityId: string, streamType: string, targetTs: number, ctx: any): Promise<any[]> {
    const result = await ctx.cubbies.myStore.query(
        entityId,
        `SELECT data FROM events
         WHERE stream_type = ? AND ABS(ts - ?) <= ?
         ORDER BY ts`,
        [streamType, targetTs, SYNC_WINDOW_MS]
    );
    return result.rows.map((r: any[]) => JSON.parse(r[0]));
}
```

### Graceful termination

Check for completion signals to break the loop:

```typescript
if (data.type === 'COMPLETE' || data.type === 'STREAM_END') {
    context.log('Received completion signal');
    break;
}
```

---

## Example: Multi-Stream Sensor Sync

A stream processor subscribing to one stream with multiple event types. Each type is stored in its own SQL table, then a synchronization pass matches data within a time window:

```
TELEMETRY_DATA  -> INSERT into telemetry table -> attempt sync
VIDEO_DATA      -> INSERT into video table + run detection agent -> attempt sync
THERMAL_DATA    -> INSERT into thermal table -> attempt sync
METADATA        -> INSERT into metadata table -> attempt sync
```

The sync function queries each table for rows within a time window of the target timestamp, assembles a composite record, and inserts into a `synced` table. SQL makes this straightforward with WHERE clauses on indexed timestamp columns.
