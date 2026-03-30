# Concierge Orchestrator Pattern

The concierge is the central coordinator in a CEF topology. It receives events (directly or via stream subscription), dispatches work to specialized agents, aggregates results, and persists state. Most non-trivial deployments have one.

**Derived from:** Production agent deployments (multi-agent orchestration, stream processing, linear pipelines)

---

## When to Use

- Multiple agents need coordinating for a single event flow
- Events arrive from one or more streams and need dispatching to different agents based on type
- Results from multiple agents need to be aggregated before storage
- The workflow has conditional logic (skip, retry, branch)

---

## Structure

```
Event arrives
  → Engagement handler (concierge)
    → Validate input
    -> Dedup check (cubby SQL)
    -> Dispatch to Agent A
    -> Dispatch to Agent B (possibly in parallel)
    -> Aggregate results
    -> Persist to cubby (SQL INSERT)
    → Return result
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
    const { entityId, streamId } = event.payload;

    // --- Validate ---
    if (!entityId) {
        context.log('Missing entityId');
        return { error: 'missing_entityId' };
    }

    // --- Dedup (optional) ---
    const check = await context.cubbies.myDomain.query(
        entityId, 'SELECT 1 FROM processed WHERE entity_id = ?', [entityId]
    );
    if (check.rows.length > 0) {
        context.log(`Duplicate event ${entityId} -- skipping`);
        return { skipped: true, reason: 'duplicate' };
    }

    // --- Option A: Direct event processing ---
    const detectionResult = await context.agents.objectDetection.yolo({
        image: event.payload.image
    });

    const analysisResult = await context.agents.violationDetector.detect({
        detections: detectionResult.detections,
        telemetry: event.payload.telemetry
    });

    // Persist
    await context.cubbies.myDomain.exec(
        entityId,
        'INSERT INTO results (entity_id, data, created_at) VALUES (?, ?, ?)',
        [entityId, JSON.stringify(analysisResult), new Date().toISOString()]
    );

    // --- Option B: Stream subscription (long-running) ---
    const stream = await context.streams.subscribe(streamId);
    for await (const packet of stream) {
        const data = JSON.parse(bytesToString(packet.payload));
        const eventType = data.event_type;

        if (eventType === 'TYPE_A') {
            const result = await context.agents.agentA.process(data);
            await context.cubbies.myDomain.exec(
                entityId,
                'INSERT INTO events (entity_id, data, ts) VALUES (?, ?, ?)',
                [entityId, JSON.stringify(result), data.timestamp]
            );
        } else if (eventType === 'TYPE_B') {
            const result = await context.agents.agentB.analyze(data);
            await context.cubbies.myDomain.exec(
                entityId,
                'INSERT INTO analysis (entity_id, data, ts) VALUES (?, ?, ?)',
                [entityId, JSON.stringify(result), data.timestamp]
            );
        } else if (eventType === 'COMPLETE') {
            break;
        }
    }

    // Mark as processed
    await context.cubbies.myDomain.exec(
        entityId,
        'INSERT OR IGNORE INTO processed (entity_id, processed_at) VALUES (?, ?)',
        [entityId, new Date().toISOString()]
    );

    return { ok: true, entityId };
}
```

---

## Common Variants

### Multi-stream synchronization

The engagement subscribes to a stream carrying multiple event types (e.g. telemetry, video frames, sensor data). It dispatches each to appropriate SQL tables, calls detection/analysis agents, and assembles composite results.

Key patterns:
- Stream subscription with `for await` loop
- Event type dispatch based on `data.event_type`
- Agent calls: `context.agents.objectDetection.detect()`, etc.
- SQL INSERT per event type into separate tables
- Windowed synchronization via SQL queries

### Parallel stream processing

The concierge receives multiple stream IDs, processes them in parallel via `Promise.all`, then runs post-processing. Each stream has its own pipeline.

Key patterns:
- `Promise.all([processStreamA(...), processStreamB(...)])`
- Sequential pipeline within each stream
- Instance-scoped cubby isolation per entity

### Linear orchestration with dedup

Validates input, calls analysis agent, maps result, writes to external service. Dedup via SQL (SELECT before processing, INSERT OR IGNORE after).

Key patterns:
- Input validation with early return
- SQL-based deduplication
- Linear agent pipeline: analyze -> map -> write
