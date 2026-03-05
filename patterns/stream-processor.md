# Stream Processor Pattern

A stream processor subscribes to a CEF stream and processes packets in a long-running `for await` loop. Each packet is parsed, dispatched based on event type, and results are stored or forwarded.

**Extracted from:** `Nightingale Agents/engagement.ts`, `Gaming Demo Agents/conciergeAgent.ts`

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
    const cubby = context.cubby('my-store');
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
                const key = `entity/${entityId}/typeA/${timestamp}`;
                await cubby.json.set(key, { ...data, storedAt: Date.now() });
            } else if (eventType === 'DATA_TYPE_B') {
                const result = await context.agents.processor.process(data);
                const key = `entity/${entityId}/typeB/${timestamp}`;
                await cubby.json.set(key, { ...result, storedAt: Date.now() });
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

### Timestamp indexing

For time-series data, maintain a timestamp index alongside the data:

```typescript
async function appendTimestamp(entityId: string, streamType: string, timestamp: number, cubby: any) {
    const indexKey = `entity/${entityId}/${streamType}/_index`;
    let timestamps: number[] = [];
    try { timestamps = await cubby.json.get(indexKey); } catch (_) {}
    if (!Array.isArray(timestamps)) timestamps = [];
    timestamps.push(timestamp);
    await cubby.json.set(indexKey, timestamps);
}
```

### Windowed synchronization

Match events from different streams within a time window:

```typescript
const SYNC_WINDOW_MS = 3000;

async function findInWindow(entityId: string, streamType: string, targetTs: number, cubby: any): Promise<any[]> {
    const indexKey = `entity/${entityId}/${streamType}/_index`;
    let timestamps: number[] = [];
    try { timestamps = await cubby.json.get(indexKey); } catch (_) {}
    if (!Array.isArray(timestamps)) return [];

    const matching = timestamps.filter(ts => Math.abs(ts - targetTs) <= SYNC_WINDOW_MS);
    const keys = matching.map(ts => `entity/${entityId}/${streamType}/${ts}`);

    const results: any[] = [];
    for (const key of keys) {
        try {
            const data = await cubby.json.get(key);
            if (data) results.push(data);
        } catch (_) {}
    }
    return results;
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

## Production Example: Multi-Stream Drone Sync

The Nightingale engagement subscribes to one stream carrying four event types. Each type is stored separately, then a synchronization pass matches data from different streams within a 3-second window:

```
DRONE_TELEMETRY_DATA → store telemetry → attempt sync
VIDEO_STREAM_DATA    → store RGB + run YOLO → attempt sync from frame
THERMAL_STREAM_DATA  → store thermal → attempt sync from frame
VIDEO_KLV_DATA       → store KLV metadata → attempt sync from frame
```

The sync function finds the closest telemetry timestamp, gathers all frames within the window, assembles a composite "synced packet" with telemetry + RGB + thermal + KLV, and stores it in cubby. This pattern handles out-of-order arrival and partial data gracefully.
