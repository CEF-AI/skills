# Concierge Orchestrator Pattern

The concierge is the central coordinator in a CEF topology. It receives events (directly or via stream subscription), dispatches work to specialized agents, aggregates results, and persists state. Most non-trivial deployments have one.

**Extracted from:** `Gaming Demo Agents/conciergeAgent.ts`, `Nightingale Agents/engagement.ts`, `Project-Tazz/concierge.ts`

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
    → Dedup check (Cubby)
    → Dispatch to Agent A
    → Dispatch to Agent B (possibly in parallel)
    → Aggregate results
    → Persist to Cubby
    → Return result
```

---

## Inline Template

```typescript
const CUBBY_NAME = 'my-domain';

const uuid = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function bytesToString(bytes: Uint8Array): string {
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return str;
}

async function handle(event: any, context: any) {
    const cubby = context.cubby(CUBBY_NAME);
    const { entityId, streamId } = event.payload;
    const cid = uuid();

    // --- Validate ---
    if (!entityId) {
        context.log('Missing entityId');
        return { error: 'missing_entityId' };
    }

    // --- Dedup (optional) ---
    const dedupKey = `processed/${cid}`;
    const existing = await cubby.json.get(dedupKey).catch(() => null);
    if (existing) {
        context.log(`Duplicate event ${cid} — skipping`);
        return { skipped: true, reason: 'duplicate' };
    }

    // --- Option A: Direct event processing ---
    // Dispatch to agents
    const detectionResult = await context.agents.objectDetection.yolo({
        image: event.payload.image
    });

    const analysisResult = await context.agents.violationDetector.detect({
        detections: detectionResult.detections,
        telemetry: event.payload.telemetry
    });

    // Persist
    await cubby.json.set(`entity/${entityId}/result`, analysisResult);

    // --- Option B: Stream subscription (long-running) ---
    const stream = await context.streams.subscribe(streamId);
    for await (const packet of stream) {
        const data = JSON.parse(bytesToString(packet.payload));
        const eventType = data.event_type;

        if (eventType === 'TYPE_A') {
            const result = await context.agents.agentA.process(data);
            await cubby.json.set(`entity/${entityId}/${data.timestamp}`, result);
        } else if (eventType === 'TYPE_B') {
            const result = await context.agents.agentB.analyze(data);
            await cubby.json.set(`entity/${entityId}/analysis/${data.timestamp}`, result);
        } else if (eventType === 'COMPLETE') {
            break;
        }
    }

    // Mark as processed
    await cubby.json.set(dedupKey, { processedAt: Date.now() });

    return { ok: true, entityId };
}
```

---

## Production Examples

### Nightingale — Multi-stream drone synchronization

The engagement subscribes to a single stream carrying multiple event types (telemetry, RGB frames, thermal, KLV). It dispatches each to appropriate storage, calls YOLO for object detection on RGB frames, and calls the violation detector on detected objects. Results are synced into composite packets stored in cubby.

Key patterns:
- Stream subscription with `for await` loop
- Event type dispatch (`DRONE_TELEMETRY_DATA`, `VIDEO_STREAM_DATA`, etc.)
- Agent calls: `context.agents.objectDetection.yolo()`, `context.agents.parkingViolationDetector.detect()`
- Composite state assembly in cubby (`mission/{id}/synced/{timestamp}`)

### Gaming Demo — Parallel stream processing

The concierge receives audio and game data stream IDs, processes both in parallel via `Promise.all`, then runs post-match analysis. Audio stream goes through STT → sentiment → embedding → topic matching. Game stream stores moments and accumulates key events. After both complete, clustering and pattern analysis run.

Key patterns:
- `Promise.all([processAudioStream(...), processGameDataStream(...)])`
- Sequential pipeline within each stream (STT → sentiment → embedding → topic)
- Unassigned item accumulation for batch clustering at match end
- CID-scoped state for test isolation

### Project Tazz — Linear orchestration

Validates PR event → calls prAnalysisAgent for LLM analysis → maps result to generic ActivityRecord → calls notionAgent to write entry. Simple linear flow with dedup via cubby primitive (`cubby.set(dedupKey, ...)`).

Key patterns:
- Input validation with early return
- Cubby-based deduplication
- Linear agent pipeline: analyze → map → write
- Source-agnostic mapping layer (GitHub PR → generic ActivityRecord)
