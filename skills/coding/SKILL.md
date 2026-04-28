---
name: cef-coding
description: Use when writing CEF agent handler files, understanding the runtime API (CEFContext), learning the entity hierarchy and when to use each entity, coordinating multiple agents (concierge, fan-out, pipeline, stream processor), testing locally with cef dev, or generating a complete CEF project from a natural language goal. Covers handler signature, V8 isolate constraints, entity decision guide, orchestration patterns, local development, topology generation (5-step process), starter configs, and handler templates.
---

# CEF Agent Coding

CEF AI is a distributed AI infrastructure platform. Agent services run on DDC Compute Nodes as V8 isolates. This skill covers the runtime API, handler writing, multi-agent orchestration patterns, and full project generation.

## Critical Constraint

**All handler code must be fully inline.** The CEF Agent Runtime uses V8 isolates; `import` and `require` are NOT supported. Every `.ts` handler file must be entirely self-contained: all utility functions, constants, types, and helpers defined in the same file. The only external API is `context.*` injected at runtime.

## Entity Hierarchy

```
AgentService (identified by agentServicePubKey)
├── Workspace (logical grouping; site, region, or project)
│   ├── Stream (event channel within a workspace)
│   │   ├── Selector (filters which events enter the stream)
│   │   └── Deployment (activates an engagement on a stream)
│   │       └── Trigger (conditions that fire the engagement)
│   │           └── Engagement (handler code; runs when triggered)
│   └── Cubby (SQLite database; 1:1 with workspace)
│       └── Instance (lazily created per instanceId)
├── Agent (named service with one or more tasks)
│   └── Task (individual handler function with typed params/returns)
└── Engagement definitions (code referenced by deployments)
```

**How they wire together:** Events flow into Streams. Selectors filter them. Deployments bind streams to Engagements. Without the full workspace -> stream -> deployment chain, an engagement is dead code that never executes. Engagements orchestrate Agents. Agents execute Tasks. Tasks read/write Cubbies via SQL.

## When to Use What

| I need to... | Use this entity | Why |
|-|-|-|
| React to incoming events and coordinate work | Engagement (wired via deployment) | Entry point for event processing; orchestrates agents |
| Run inference, transform data, classify | Agent task | Discrete computation with typed I/O; reusable across engagements |
| Process continuous data (audio, sensor, video) | Stream subscription in an engagement | `context.streams.subscribe()` gives you `for await` |
| Store structured data per entity/session | Cubby (with instanceId) | SQLite gives you queries; instanceId gives you isolation |
| Group related streams by site/region/project | Workspace | Logical grouping; one cubby per workspace |
| Build a custom query engine over stream data | Raft | Stateful aggregator attached to a stream |
| Call an external API | Agent task with `context.fetch()` | Keep external calls in agent tasks, not engagements |

### Anti-Pattern: Engagement as Worker

WRONG; engagement doing computation directly:

```typescript
// engagements/handler.ts -- BAD
async function handle(event: any, context: any) {
    // Don't do inference or heavy computation in engagements
    const response = await context.fetch(INFERENCE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: { bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' }, input: { image: event.payload.image } })
    });
    const data = await response.json();
    return data;
}
```

RIGHT; engagement orchestrates, agent computes:

```typescript
// engagements/handler.ts -- GOOD
async function handle(event: any, context: any) {
    const result = await context.agents.detector.detect({ image: event.payload.image });
    await context.cubbies.siteData.exec(event.payload.entityId,
        'INSERT INTO detections (entity_id, data) VALUES (?, ?)',
        [event.payload.entityId, JSON.stringify(result)]);
    return result;
}

// agents/detector/tasks/detect.ts
const ENDPOINT = 'https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference';
async function handle(event: any, context: any) {
    const response = await context.fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: { bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' }, input: { image: event.payload.image } })
    });
    if (!response.ok) throw new Error(`Inference failed: ${response.status}`);
    const data = await response.json();
    return { detections: data.output.detections };
}
```

### Anti-Pattern: Cubbies as Data Transport

WRONG; using cubby to pass data between agents:

```typescript
// Agent A writes to cubby
await context.cubbies.store.exec(entityId, 'INSERT INTO temp (data) VALUES (?)', [JSON.stringify(result)]);
// Later, engagement reads from cubby to pass to Agent B
const rows = await context.cubbies.store.query(entityId, 'SELECT data FROM temp');
await context.agents.agentB.process(JSON.parse(rows.rows[0][0]));
```

RIGHT; pass data directly through the engagement:

```typescript
const resultA = await context.agents.agentA.analyze(event.payload);
const resultB = await context.agents.agentB.process(resultA);
// Only write to cubby for persistence, not for data transport
await context.cubbies.store.exec(entityId,
    'INSERT INTO results (entity_id, data) VALUES (?, ?)',
    [entityId, JSON.stringify(resultB)]);
```

### Anti-Pattern: Missing Wiring

An engagement alone does nothing. It must be connected via the deployment chain:

```yaml
# This engagement will NEVER execute without a deployment referencing it:
engagements:
  - name: "My Handler"
    file: ./engagements/handler.ts

# You MUST also create:
workspaces:
  - name: "Default"
    streams:
      - name: "Events"
        selectors:
          - name: "all"
            conditions: ["*"]
        deployments:
          - name: "Main"
            engagement: "My Handler"    # This is what activates it
            isActive: true
            triggers:
              - name: "all"
                conditions: ["*"]
```

## Handler Signature

Every handler defines a single `handle` function:

```typescript
async function handle(event: any, context: any) {
    const { field1, field2 } = event.payload;
    // handler logic using context.cubbies.*, context.agents.*, context.fetch(), context.log()
    return { result: 'done' };
}
```

**Do NOT use `export` on the handler.** `export async function handle(...)` compiles to `module.exports = ...`, and `module` is not defined in a V8 isolate. The error at runtime is `module is not defined`. Use a plain `async function handle(...)` with no export keyword.

- `event.payload` contains the input data
- `context` provides: `cubbies.<alias>.query/exec()`, `agents.<alias>.<task>(payload)`, `streams.subscribe(id)`, `fetch(url, opts)`, `log(msg)`

## CEFContext Shape

```typescript
interface CEFContext {
    log(...args: unknown[]): void;
    cubbies: { [alias: string]: { query(instanceId: string, sql: string, params?: unknown[]): Promise<any>; exec(instanceId: string, sql: string, params?: unknown[]): Promise<any> } };
    agents: { [agentAlias: string]: { [taskAlias: string]: (input: unknown) => Promise<unknown> } };
    streams: { subscribe(streamId: string): Promise<AsyncIterable<{ payload: Uint8Array }>> };
    fetch(url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;
}
```

## Project Directory Convention

```
my-project/
├── cef.config.yaml          # Manifest (references all handler files)
├── .env                     # Auth token + endpoint URLs
├── engagements/
│   └── {name}.ts            # One file per engagement (fully inline)
└── agents/
    └── {agent-kebab}/
        └── tasks/
            └── {task}.ts    # One file per task (fully inline)
```

Rules:
- All `file:` paths in config are **relative** to the config file
- Agent directories use **kebab-case** (e.g., `object-detection`)
- `alias` fields use **camelCase** (e.g., `objectDetection`); this is what `context.agents.<alias>.<task>()` uses
- `name` fields are human-readable title case
- Every `.ts` file is fully self-contained; no imports

## Local Development

Use `cef dev` (see **cli** skill for full command docs) to run handlers locally with full Context API emulation. No auth or environment variables needed.

```bash
cef dev                         # Start dev server at http://localhost:8787
cef dev --persist               # Keep .cef-dev/ data after shutdown (default: cleared)
```

All `context.*` APIs work identically to production. Cubbies are backed by real SQLite (sql.js), so your SQL queries run for real. File changes hot-reload automatically.

**Testing handlers locally:**

```bash
# Trigger an engagement
curl -X POST http://localhost:8787/api/trigger \
  -H 'Content-Type: application/json' \
  -d '{"engagement": "My Handler", "payload": {"entityId": "test-1"}}'

# Call an agent task directly
curl -X POST http://localhost:8787/api/agents/myAgent/myTask \
  -H 'Content-Type: application/json' \
  -d '{"input": "test"}'

# Push a stream packet
curl -X POST http://localhost:8787/api/streams/my-stream-id/push \
  -H 'Content-Type: application/json' \
  -d '{"event_type": "DATA_CHUNK", "value": 42}'

# Query a cubby
curl -X POST http://localhost:8787/api/cubbies/siteData/query \
  -H 'Content-Type: application/json' \
  -d '{"sql": "SELECT * FROM detections", "instanceId": "default"}'
```

The dev server also provides a browser UI with topology view, stream push (single/bulk/file upload), cubby SQL editor, and live execution flow tracing.

---

# Orchestration

Patterns for wiring multiple agents together: coordinating, dispatching, streaming, and aggregating.

## Agent-to-Agent Calls

> **Always `await` agent calls.** Fire-and-forget calls (no `await`) are silently killed when the handler returns. The V8 isolate terminates immediately, cancelling any pending promises. The agent may never execute or be killed mid-execution. Always use `await` or collect promises for `Promise.all()`.

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

### Agent Parameter Wrapping

When an engagement calls `context.agents.myAgent.myTask({ pageId })`, the agent receives the arguments wrapped in a `payload` property. Direct destructuring fails silently (variables are `undefined`, no error).

Use this defensive unwrap at the top of every agent task handler:

```typescript
async function handle(event: any, context: any) {
    const params = event.payload?.payload ?? event.payload;
    const { pageId, title } = params;
    // ... rest of handler
}
```

## Streams API

Subscribe to a data stream published by external code (via `@cef-ai/client-sdk` `client.stream.publisher().send()`). The handler must explicitly subscribe; stream data does NOT arrive in `event.payload`.

```typescript
const stream = await context.streams.subscribe('my-stream-id');

for await (const packet of stream) {
    const data = JSON.parse(bytesToString(packet.payload));
    if (data.type === 'DATA_CHUNK') {
        // process chunk
    }
    if (data.type === 'COMPLETE') {
        break;  // graceful termination
    }
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

### Events vs Streams: When to Use Which

Both deliver data to handlers, but they serve different roles:

| Transport | Client sends with | Handler receives via | Best for |
|-|-|-|-|
| Event Runtime | `client.event.create(type, payload)` | `event.payload` (already parsed) | Discrete triggers, lifecycle signals, small payloads |
| Streams | `client.stream.publisher().send({message})` | `context.streams.subscribe(id)` + `for await` | Continuous data: audio chunks, sensor feeds, game telemetry |

Events and streams work together. The typical pattern: client sends a trigger event containing the `streamId` (via Event Runtime), then publishes continuous data to that stream. The handler receives the event in `event.payload`, extracts `streamId`, subscribes, and processes packets until completion.

```typescript
async function handle(event: any, context: any) {
    const { streamId, entityId } = event.payload;

    // Subscribe to the stream the client created via client.stream.create()
    const stream = await context.streams.subscribe(streamId);

    for await (const packet of stream) {
        const data = JSON.parse(bytesToString(packet.payload));
        if (data.type === 'MY_DATA') {
            await context.agents.myAgent.process(data);
        }
        if (data.type === 'COMPLETE') break;
    }

    // Finalize after stream ends
    await context.cubbies.myStore.exec(entityId,
        'UPDATE sessions SET status = ? WHERE id = ?',
        ['completed', entityId]);
}
```

**Key rule:** if the client publishes continuous data via `publisher.send()`, the handler must use `context.streams.subscribe(streamId)` to receive it. That data does not appear in `event.payload`. Conversely, data sent via `client.event.create()` arrives in `event.payload` and is not visible to stream subscriptions. Match both sides.

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

---

# Topology Generation

Generate complete, deployable CEF projects from natural language goals. Follow the 5-step process below. Reference the **inference** and **storage** skills for detailed API docs.

## Hard Rules

1. Every `.ts` handler file must be fully self-contained. NO `import` or `require`.
2. All helpers, constants, types defined inline in each file. Duplicate across files if needed.
3. Only external API is `context.*` (cubbies, agents, streams, fetch, log).
4. Never use `context.models`; all inference via `context.fetch()`.
5. All `file:` paths in config are relative to the config file.
6. Generate fully working code, not stubs or TODOs.
7. Follow the directory convention: `engagements/`, `agents/{name-kebab}/tasks/`.
8. One cubby per workspace. Use multiple tables in migrations, not multiple cubbies.
9. Every engagement must be wired via workspace -> stream -> deployment to execute.

## Step 1: Decompose the Goal

| Capability | Maps To |
|-|-|
| Object detection (YOLO) | Agent with inference task |
| Speech transcription | Agent with Whisper task |
| Text embedding | Agent with embedding task |
| Sentiment/emotion analysis | Agent with classification task |
| LLM reasoning/classification | Agent with LLM inference task |
| State persistence | Cubby with SQL schema (1:1 with workspace) |
| Vector search / similarity | Cubby with sqlite-vec |
| Real-time stream processing | Engagement with stream subscription |
| Multi-model orchestration | Engagement (concierge) calling multiple agents |
| External API calls | Agent task using context.fetch() |

## Step 2: Select Patterns

| Pattern | When to Use |
|-|-|
| concierge-orchestrator | Multiple agents need coordinating |
| inference-worker | Single model inference |
| stream-processor | Long-running stream subscription |
| cubby-state-machine | Read-process-write state management |
| fan-out-aggregate | Parallel agent calls with result aggregation |
| pipeline-chain | Sequential processing (A -> B -> C) |

Most deployments combine multiple patterns. Typical: concierge-orchestrator + pipeline-chain or fan-out-aggregate + cubby-state-machine.

## Step 3: Select Models

All models: bucket `1338`, endpoint `https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference`.

| Capability | Model | Name / Version |
|-|-|-|
| Vision-language / chat | Qwen2-VL 7B | `qwen2-vl-7b-instruct` / `v1.0.0` |
| Text embeddings | Qwen3 Embedding 4B | `qwen3-embedding-4b` / `v1.0.0` |
| Speech-to-text | Whisper Large V3 | `whisper_large_v3` / `v1.0.4` |
| Emotion classification | Emotion DistilRoBERTa | `emotion-english-distilroberta-base` / `v1.0.2` |
| Sentiment polarity | Multilingual Sentiment | `multilingual-sentiment-analysis` / `v1.0.0` |
| Object detection | YOLO11x 1280 | `yolo11x_1280` / `v1.0.0` |
| License plate detection | YOLO Plate Detector | `yolo-plate-detector` / `v1.0.1` |
| Plate text recognition | Fast Plate OCR | `fast-plate-ocr` / `v1.0.0` |

See **inference** skill for full request/response formats.

## Step 4: Design the Entity Graph

1. **How many agents?** One per distinct capability
2. **How many tasks per agent?** Usually one; group related operations (e.g., createTopic, matchTopic, updateTopic)
3. **How many engagements?** One per distinct event flow
4. **How many cubbies?** One per workspace (1:1). Use multiple tables in migrations for different data needs.
5. **Workspace and stream?** One workspace per logical grouping, one stream per event source. Wire each engagement via deployment.

## Step 5: Generate the Project

Output:
1. `cef.config.yaml` with all entities and `file:` references
2. Engagement handler(s) in `engagements/`
3. Agent task handler(s) in `agents/{name-kebab}/tasks/`
4. `.env.example` with required variables

## Handler Templates

### Engagement (Orchestrator)

```typescript
function bytesToString(bytes: Uint8Array): string {
    let str = '';
    for (let i = 0; i < bytes.length; i++) { str += String.fromCharCode(bytes[i]); }
    return str;
}

async function handle(event: any, context: any) {
    const { field1, field2 } = event.payload;

    // Direct processing
    const result = await context.agents.myAgent.myTask({ ...event.payload });
    await context.cubbies.myStore.exec('default',
        'INSERT INTO results (id, data, created_at) VALUES (?, ?, ?)',
        [field1, JSON.stringify(result), new Date().toISOString()]
    );

    // OR stream subscription
    const stream = await context.streams.subscribe(event.payload.streamId);
    for await (const packet of stream) {
        const data = JSON.parse(bytesToString(packet.payload));
        if (data.event_type === 'MY_EVENT') {
            const r = await context.agents.myAgent.myTask(data);
            await context.cubbies.myStore.exec('default',
                'INSERT INTO results (id, data, created_at) VALUES (?, ?, ?)',
                [data.id, JSON.stringify(r), new Date().toISOString()]
            );
        }
    }
}
```

### Engagement (Direct Event Processing)

The most common pattern for discrete ingest jobs. Event arrives, handler processes, writes to cubby, returns. No stream subscription needed.

```typescript
async function handle(event: any, context: any) {
    const { entityId, data } = event.payload;
    if (!entityId) return { error: 'missing entityId' };

    // Process via agent
    const result = await context.agents.myAgent.analyze({ data });

    // Persist result
    await context.cubbies.myStore.exec('default',
        'INSERT INTO results (entity_id, data, processed_at) VALUES (?, ?, ?) ON CONFLICT(entity_id) DO UPDATE SET data = excluded.data, processed_at = excluded.processed_at',
        [entityId, JSON.stringify(result), new Date().toISOString()]
    );

    return { ok: true, entityId };
}
```

Use this when each event is self-contained. For continuous data (audio, sensor feeds), use stream subscription instead.

### Agent Task (Inference Worker)

```typescript
const ENDPOINT = 'https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference';

async function retry(action: () => Promise<any>, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try { return await action(); }
        catch (error) { if (i === retries - 1) throw error; }
    }
}

async function handle(event: any, context: any) {
    const { inputField } = event.payload;
    const data = await retry(async () => {
        const response = await context.fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: { bucket: 1338, name: 'MODEL_NAME', version: 'v1.0.0' },
                input: { text: inputField }
            })
        });
        if (!response.ok) throw new Error(`Inference failed: ${response.status}`);
        return response.json();
    });
    return { result: data.output };
}
```

## Config Generation Rules

- **Naming:** Agent/Task `name` Title Case, `alias` camelCase, directory kebab-case. Example: "Parking Violation Detector" -> alias `parkingViolationDetector` -> directory `parking-violation-detector`
- **JSON Schema:** Types lowercase (`string`, `number`, `boolean`, `array`, `object`). Use `properties`, `required`, `type: object`. See **cli** for full reference.
- **Selectors:** Format `event_type:<your-event-type>`. Use `"*"` for catch-all.
- **Cubbies:** One per workspace. All tables in one cubby via migrations.

## Starter Configs

### Object Detection

```yaml
agentServicePubKey: "<64-char hex>"
engagements:
  - name: "Detection Orchestrator"
    file: ./engagements/orchestrator.ts
    version: "1.0.0"
agents:
  - name: "Object Detection"
    alias: "objectDetection"
    version: "1.0.0"
    tasks:
      - name: "Detect"
        alias: "detect"
        file: ./agents/object-detection/tasks/detect.ts
        parameters:
          properties: { image: { type: string } }
          required: [image]
          type: object
cubbies:
  - alias: "siteData"
    name: "Site Data"
    migrations:
      - version: 1
        up: |
          CREATE TABLE detections (id INTEGER PRIMARY KEY, entity_id TEXT, data TEXT, created_at TEXT);
          CREATE TABLE processed (entity_id TEXT PRIMARY KEY, processed_at TEXT)
workspaces:
  - name: "Detection Site"
    streams:
      - name: "Image Stream"
        selectors: [{ name: "images", conditions: ["event_type:IMAGE_DATA"] }]
        deployments:
          - name: "Detection Pipeline"
            engagement: "Detection Orchestrator"
            isActive: true
            triggers: [{ name: "all", conditions: ["*"] }]
```

### NLP Pipeline

```yaml
agentServicePubKey: "<64-char hex>"
engagements:
  - name: "NLP Orchestrator"
    file: ./engagements/orchestrator.ts
    version: "1.0.0"
agents:
  - name: "Speech To Text"
    alias: "speechToText"
    version: "1.0.0"
    tasks:
      - name: "Transcribe"
        alias: "transcribe"
        file: ./agents/speech-to-text/tasks/transcribe.ts
  - name: "Text Analyzer"
    alias: "textAnalyzer"
    version: "1.0.0"
    tasks:
      - name: "Analyze"
        alias: "analyze"
        file: ./agents/text-analyzer/tasks/analyze.ts
  - name: "Embedding"
    alias: "embeddingAgent"
    version: "1.0.0"
    tasks:
      - name: "Embed"
        alias: "embed"
        file: ./agents/embedding/tasks/embed.ts
cubbies:
  - alias: "nlpData"
    name: "NLP Data"
    migrations:
      - version: 1
        up: |
          CREATE TABLE results (id INTEGER PRIMARY KEY, entity_id TEXT, text TEXT, sentiment REAL, created_at TEXT);
          CREATE TABLE processed (entity_id TEXT PRIMARY KEY, processed_at TEXT)
workspaces:
  - name: "NLP Workspace"
    streams:
      - name: "Text Stream"
        selectors: [{ name: "text", conditions: ["event_type:TEXT_INPUT"] }]
        deployments:
          - name: "NLP Pipeline"
            engagement: "NLP Orchestrator"
            isActive: true
            triggers: [{ name: "all", conditions: ["*"] }]
```

### Data Sync

```yaml
agentServicePubKey: "<64-char hex>"
engagements:
  - name: "Sync Orchestrator"
    file: ./engagements/orchestrator.ts
    version: "1.0.0"
agents:
  - name: "Analyzer"
    alias: "analyzer"
    version: "1.0.0"
    tasks:
      - name: "Analyze"
        alias: "analyze"
        file: ./agents/analyzer/tasks/analyze.ts
  - name: "Writer"
    alias: "writer"
    version: "1.0.0"
    tasks:
      - name: "Write"
        alias: "write"
        file: ./agents/writer/tasks/write.ts
cubbies:
  - alias: "syncData"
    name: "Sync Data"
    migrations:
      - version: 1
        up: "CREATE TABLE processed (event_id TEXT PRIMARY KEY, processed_at TEXT)"
workspaces:
  - name: "Sync Workspace"
    streams:
      - name: "Events"
        selectors: [{ name: "all", conditions: ["*"] }]
        deployments:
          - name: "Sync Pipeline"
            engagement: "Sync Orchestrator"
            isActive: true
            triggers: [{ name: "all", conditions: ["*"] }]
```

### Real-Time Analytics

```yaml
agentServicePubKey: "<64-char hex>"
engagements:
  - name: "Analytics Orchestrator"
    file: ./engagements/orchestrator.ts
    version: "1.0.0"
agents:
  - name: "Feature Extractor"
    alias: "featureExtractor"
    version: "1.0.0"
    tasks:
      - name: "Extract"
        alias: "extract"
        file: ./agents/feature-extractor/tasks/extract.ts
  - name: "Classifier"
    alias: "classifier"
    version: "1.0.0"
    tasks:
      - name: "Classify"
        alias: "classify"
        file: ./agents/classifier/tasks/classify.ts
cubbies:
  - alias: "analyticsData"
    name: "Analytics Data"
    migrations:
      - version: 1
        up: |
          CREATE TABLE events (id INTEGER PRIMARY KEY, entity_id TEXT, category TEXT, data TEXT, ts INTEGER);
          CREATE TABLE aggregates (entity_id TEXT PRIMARY KEY, event_count INTEGER, last_updated TEXT)
workspaces:
  - name: "Analytics Site"
    streams:
      - name: "Sensor Stream"
        selectors: [{ name: "sensors", conditions: ["event_type:SENSOR_DATA"] }]
        deployments:
          - name: "Analytics Pipeline"
            engagement: "Analytics Orchestrator"
            isActive: true
            triggers: [{ name: "all", conditions: ["*"] }]
```

## Pre-Output Checklist

Before presenting generated output, verify:

- [ ] `cef.config.yaml` has `agentServicePubKey` placeholder
- [ ] Every `file:` path matches an actual file in the directory tree
- [ ] Every `.ts` file has zero `import`/`require` statements
- [ ] Every `.ts` file defines a `handle(event, context)` function
- [ ] Agent aliases in config match `context.agents.<alias>.<task>()` usage in code
- [ ] Cubby aliases in config match `context.cubbies.<alias>` usage in handlers
- [ ] All inference calls use `context.fetch()`, never `context.models`
- [ ] JSON Schema types are lowercase: `string`, `number`, `boolean`, `array`, `object`
- [ ] `.env.example` lists all required environment variables
- [ ] One cubby per workspace; all tables in migrations
- [ ] Every engagement is wired via workspace -> stream -> deployment
- [ ] Every `.query()` and `.exec()` call passes an explicit instanceId (`'default'` or entity-specific)
- [ ] Every `context.agents.*.*()` call is `await`-ed (no fire-and-forget)

---

## Related Skills

- **cli**: Config schema, deploy commands, local dev server, naming conventions, environment setup
- **inference**: Model catalog, request/response formats, calling patterns
- **storage**: Cubby API, state machine pattern, SQL patterns
- **clientsdk**: Sending events from external code into CEF streams
