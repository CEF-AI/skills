---
name: cef-orchestration
description: Use when coordinating multiple CEF agents, processing event streams, dispatching work in parallel (fan-out), chaining agents in sequence (pipeline), or subscribing to streams. Covers the concierge orchestrator pattern, stream processor, fan-out aggregate (Promise.all), pipeline chain (A to B to C), agent-to-agent proxy calls, streams subscription API, windowed sync, and error isolation.
---

# CEF Orchestration

Patterns for wiring multiple agents together: coordinating, dispatching, streaming, and aggregating.

> **Reminder:** All handler code must be fully inline. No `import` or `require`. See the **cef-agent-basics** skill.

## Agent-to-Agent Calls

CEF provides a dynamic proxy for inter-agent communication:

```typescript
// Call by alias (configured at deploy time)
const result = await context.agents.embeddingAgent.embed({ texts: ['hello'] });
const topic = await context.agents.topicAgent.matchTopic({ embedding, threshold: 0.8 });
```

- Dot notation: `context.agents.<agentAlias>.<taskAlias>(payload)`
- Proxy triggers HTTP calls to the target agent's handler
- Target receives the call as a normal CEFEvent with args as payload

```typescript
// Error handling
try {
    const result = await context.agents.myAgent.doWork(payload);
} catch (err) {
    context.log(`Agent call failed: ${err}`);
}
```

## Streams API

```typescript
const stream = await context.streams.subscribe('my-stream-id');

for await (const packet of stream) {
    const text = bytesToString(packet.payload);
    const event = JSON.parse(text);
    // handle event based on event.event_type
}
```

Packets arrive as `Uint8Array`. Decode with this inline helper:

```typescript
function bytesToString(bytes: Uint8Array): string {
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return str;
}
```

---

## Pattern 1: Concierge Orchestrator

The central coordinator that receives events, dispatches to agents, aggregates results, and persists state.

```
Event -> Validate -> Dedup check -> Dispatch to agents -> Aggregate -> Persist -> Return
```

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

    if (!entityId) return { error: 'missing_entityId' };

    // Dedup
    const check = await context.cubbies.myDomain.query(
        entityId, 'SELECT 1 FROM processed WHERE entity_id = ?', [entityId]
    );
    if (check.rows.length > 0) return { skipped: true, reason: 'duplicate' };

    // Option A: Direct event processing
    const detectionResult = await context.agents.objectDetection.yolo({ image: event.payload.image });
    const analysisResult = await context.agents.violationDetector.detect({
        detections: detectionResult.detections,
        telemetry: event.payload.telemetry
    });
    await context.cubbies.myDomain.exec(
        entityId,
        'INSERT INTO results (entity_id, data, created_at) VALUES (?, ?, ?)',
        [entityId, JSON.stringify(analysisResult), new Date().toISOString()]
    );

    // Option B: Stream subscription (long-running)
    const stream = await context.streams.subscribe(streamId);
    for await (const packet of stream) {
        const data = JSON.parse(bytesToString(packet.payload));
        if (data.event_type === 'TYPE_A') {
            const result = await context.agents.agentA.process(data);
            await context.cubbies.myDomain.exec(
                entityId,
                'INSERT INTO events (entity_id, data, ts) VALUES (?, ?, ?)',
                [entityId, JSON.stringify(result), data.timestamp]
            );
        } else if (data.event_type === 'COMPLETE') {
            break;
        }
    }

    await context.cubbies.myDomain.exec(
        entityId,
        'INSERT OR IGNORE INTO processed (entity_id, processed_at) VALUES (?, ?)',
        [entityId, new Date().toISOString()]
    );
    return { ok: true, entityId };
}
```

---

## Pattern 2: Stream Processor

Long-running `for await` loop that processes packets by event type.

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
    if (!streamId) { context.log('Missing streamId'); return; }

    const stream = await context.streams.subscribe(streamId);

    for await (const packet of stream) {
        try {
            const data = JSON.parse(bytesToString(packet.payload));
            const entityId = data.entityId || 'unknown';
            const timestamp = typeof data.timestamp === 'string'
                ? new Date(data.timestamp).getTime() : data.timestamp || Date.now();

            if (data.event_type === 'DATA_TYPE_A') {
                await context.cubbies.myStore.exec(
                    entityId,
                    'INSERT INTO type_a (entity_id, data, ts, stored_at) VALUES (?, ?, ?, ?)',
                    [entityId, JSON.stringify(data), timestamp, Date.now()]
                );
            } else if (data.event_type === 'DATA_TYPE_B') {
                const result = await context.agents.processor.process(data);
                await context.cubbies.myStore.exec(
                    entityId,
                    'INSERT INTO type_b (entity_id, data, ts) VALUES (?, ?, ?)',
                    [entityId, JSON.stringify(result), timestamp]
                );
            } else if (data.event_type === 'COMPLETE') {
                break;
            }
        } catch (error) {
            context.log(`Failed to process packet: ${error.message}`);
        }
    }
}
```

### Time-Series Queries

With SQL, timestamp indexing is built into the table schema. No manual index arrays needed.

```typescript
// Query events in a time range
const events = await context.cubbies.myStore.query(
    entityId,
    'SELECT * FROM events WHERE ts BETWEEN ? AND ? ORDER BY ts',
    [startTime, endTime]
);
```

### Windowed Synchronization

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

---

## Pattern 3: Fan-Out Aggregate

Parallel agent calls with `Promise.all`, each wrapped in `.catch()` for error isolation.

### Parallel Agent Calls

```typescript
async function handle(event: any, context: any) {
    const { inputData } = event.payload;

    const [detectionResult, classificationResult, embeddingResult] = await Promise.all([
        context.agents.objectDetection.yolo({ image: inputData.image })
            .catch((err: any) => ({ error: err.message, detections: [] })),
        context.agents.classifier.classify({ text: inputData.text })
            .catch((err: any) => ({ error: err.message, label: 'unknown' })),
        context.agents.embeddingAgent.embed({ texts: [inputData.text] })
            .catch((err: any) => ({ error: err.message, embeddings: [[]] }))
    ]);

    return {
        detections: detectionResult.detections,
        classification: classificationResult.label,
        embedding: embeddingResult.embeddings[0],
        hasErrors: !!(detectionResult.error || classificationResult.error || embeddingResult.error)
    };
}
```

### Parallel Stream Processing

```typescript
async function handle(event: any, context: any) {
    const { audioStreamId, gameDataStreamId, entityId } = event.payload;
    const results: any = { audio: null, game: null };

    await Promise.all([
        processAudioStream(audioStreamId, entityId, context)
            .then(r => { results.audio = r; })
            .catch(err => { context.log(`Audio error: ${err.message}`); }),
        processGameStream(gameDataStreamId, entityId, context)
            .then(r => { results.game = r; })
            .catch(err => { context.log(`Game error: ${err.message}`); })
    ]);

    await runPostProcessing(entityId, results, context);
    return { ok: true };
}
```

### Parallel SQL Queries

```typescript
const [rgbFrames, thermalFrames, klvPackets] = await Promise.all([
    findInWindow(entityId, 'rgb', targetTimestamp, context),
    findInWindow(entityId, 'thermal', targetTimestamp, context),
    findInWindow(entityId, 'klv', targetTimestamp, context)
]);
```

---

## Pattern 4: Pipeline Chain

Sequential processing: A -> B -> C -> result.

```typescript
async function handle(event: any, context: any) {
    const { entityId, rawInput } = event.payload;

    // Stage 1: Transcription
    const transcription = await context.agents.speechToText.transcribe({
        audio: rawInput.audio, audioFormat: 'wav'
    });
    if (!transcription.fullText?.trim()) return { skipped: true };

    // Stage 2: Sentiment
    const sentiment = await context.agents.sentimentAgent.analyze({
        text: transcription.fullText
    });

    // Stage 3: Embedding
    const embeddingResult = await context.agents.embeddingAgent.embed({
        texts: [transcription.fullText]
    });
    const embedding = embeddingResult.embeddings[0];
    if (!embedding?.length) {
        return { text: transcription.fullText, sentiment: sentiment.sentiment };
    }

    // Stage 4: Topic matching
    const matchResult = await context.agents.topicAgent.matchTopic({
        embedding, entityId, threshold: 0.75
    });

    // Persist enriched record
    const now = new Date().toISOString();
    await context.cubbies.myDomain.exec(
        entityId,
        `INSERT INTO processed (entity_id, text, sentiment, emotion, topic_id, processed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [entityId, transcription.fullText, sentiment.sentiment, sentiment.emotion, matchResult.topicId || null, now]
    );

    return {
        text: transcription.fullText,
        sentiment: sentiment.sentiment,
        topicId: matchResult.topicId || null
    };
}
```

### Early Exit on Empty Results

```typescript
const transcription = await context.agents.stt.transcribe({ audio });
if (!transcription.fullText?.trim()) return { skipped: true };
```

### Error Isolation Per Stage

```typescript
let sentiment = { sentiment: 0, emotion: 'neutral', confidence: 0 };
try {
    sentiment = await context.agents.sentimentAgent.analyze({ text });
} catch (error) {
    context.log(`Sentiment failed: ${error.message}; using defaults`);
}
```

### Pipeline with Accumulation

```typescript
const unassigned: Array<{ embedding: number[]; text: string }> = [];

for (const chunk of chunks) {
    const text = await context.agents.stt.transcribe({ audio: chunk.audio });
    const embedding = await context.agents.embedding.embed({ texts: [text.fullText] });
    const match = await context.agents.topic.matchTopic({ embedding: embedding.embeddings[0] });

    if (match.topicId) {
        await context.agents.topic.updateTopic({ topicId: match.topicId, embedding: embedding.embeddings[0] });
    } else {
        unassigned.push({ embedding: embedding.embeddings[0], text: text.fullText });
    }
}

// Batch-process unassigned
if (unassigned.length >= 3) {
    const clusters = await context.agents.clustering.cluster({
        embeddings: unassigned.map(u => u.embedding),
        config: { minClusterSize: 3, minSamples: 2 }
    });
}
```

---

## Key Techniques Summary

| Technique | When |
|-|-|
| `.catch()` on every parallel branch | Fan-out; prevent one failure from aborting all |
| Early exit on empty results | Pipeline; skip downstream stages when data is empty |
| `bytesToString()` inline helper | Stream processing; decode Uint8Array packets |
| `break` on COMPLETE event | Stream processor; graceful termination |
| SQL timestamp columns + indexes | Stream processor; enable windowed sync queries |
| Instance-scoped isolation | Testing; use test-specific instanceId to isolate data |

## Related Skills

- **cef-agent-basics**: Handler signature, config schema
- **cef-inference**: Model calls within pipelines
- **cef-cubby-state**: Persisting results, state machine pattern
