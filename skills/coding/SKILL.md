---
name: cef-coding
description: Use when writing CEF agent handler files, understanding the runtime API (CEFContext), learning the entity hierarchy, coordinating multiple agents (concierge, fan-out, pipeline, stream processor), or generating a complete CEF project from a natural language goal. Covers handler signature, V8 isolate constraints, orchestration patterns, topology generation (5-step process), starter configs, and handler templates.
---

# CEF Agent Coding

CEF AI is a distributed AI infrastructure platform. Agent services run on DDC Compute Nodes as V8 isolates. This skill covers the runtime API, handler writing, multi-agent orchestration patterns, and full project generation.

## Critical Constraint

**All handler code must be fully inline.** The CEF Agent Runtime uses V8 isolates; `import` and `require` are NOT supported. Every `.ts` handler file must be entirely self-contained: all utility functions, constants, types, and helpers defined in the same file. The only external API is `context.*` injected at runtime.

## Entity Hierarchy

```
AgentService (identified by agentServicePubKey)
├── Workspace (logical grouping; site, region, or project)
│   └── Stream (event channel within a workspace)
│       ├── Selector (filters which events enter the stream)
│       └── Deployment (binds a stream to an engagement)
│           └── Trigger (conditions that fire the engagement)
├── Engagement (event handler; the orchestrator/concierge)
├── Agent (named service with one or more tasks)
│   └── Task (individual handler function with typed params/returns)
└── Cubby (SQLite database with migration schema)
    └── Instance (lazily created per instanceId)
```

**How they wire together:** Events flow into Streams, Selectors filter them, Deployments bind streams to Engagements, Engagements orchestrate Agents, Agents execute Tasks, Tasks read/write Cubbies via SQL.

## Handler Signature

Every handler exports a single `handle` function:

```typescript
async function handle(event: any, context: any) {
    const { field1, field2 } = event.payload;
    // handler logic using context.cubbies.*, context.agents.*, context.fetch(), context.log()
    return { result: 'done' };
}
```

- `event.payload` contains the input data
- `context` provides: `cubbies.<alias>.query/exec()`, `agents.<alias>.<task>(payload)`, `streams.subscribe(id)`, `fetch(url, opts)`, `log(msg)`

## CEFContext Shape

```typescript
interface CEFContext {
    log(...args: unknown[]): void;
    cubbies: { [alias: string]: { query(instanceId?: string, sql: string, params?: unknown[]): Promise<any>; exec(instanceId?: string, sql: string, params?: unknown[]): Promise<any> } };
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

---

# Orchestration

Patterns for wiring multiple agents together: coordinating, dispatching, streaming, and aggregating.

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

## Step 1: Decompose the Goal

| Capability | Maps To |
|-|-|
| Object detection (YOLO) | Agent with inference task |
| Speech transcription | Agent with Whisper task |
| Text embedding | Agent with embedding task |
| Sentiment/emotion analysis | Agent with classification task |
| LLM reasoning/classification | Agent with LLM inference task |
| State persistence | Cubby with SQL schema |
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
4. **How many cubbies?** One per data concern; separate by schema or access patterns
5. **Workspace and stream?** One workspace per logical grouping, one stream per event source

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
    await context.cubbies.myStore.exec(
        'INSERT INTO results (id, data, created_at) VALUES (?, ?, ?)',
        [field1, JSON.stringify(result), new Date().toISOString()]
    );

    // OR stream subscription
    const stream = await context.streams.subscribe(event.payload.streamId);
    for await (const packet of stream) {
        const data = JSON.parse(bytesToString(packet.payload));
        if (data.event_type === 'MY_EVENT') {
            const r = await context.agents.myAgent.myTask(data);
            await context.cubbies.myStore.exec(
                'INSERT INTO results (id, data, created_at) VALUES (?, ?, ?)',
                [data.id, JSON.stringify(r), new Date().toISOString()]
            );
        }
    }
}
```

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

## Starter Configs

### Object Detection

```yaml
agentServicePubKey: "0x..."
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
  - alias: "detections"
    name: "Detections"
    migrations:
      - version: 1
        up: "CREATE TABLE detections (id INTEGER PRIMARY KEY, entity_id TEXT, data TEXT, created_at TEXT)"
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
agentServicePubKey: "0x..."
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
  - alias: "nlpResults"
    name: "NLP Results"
    migrations:
      - version: 1
        up: "CREATE TABLE results (id INTEGER PRIMARY KEY, entity_id TEXT, text TEXT, sentiment REAL, created_at TEXT)"
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
agentServicePubKey: "0x..."
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
  - alias: "syncState"
    name: "Sync State"
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
agentServicePubKey: "0x..."
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
  - alias: "analytics"
    name: "Analytics"
    migrations:
      - version: 1
        up: "CREATE TABLE events (id INTEGER PRIMARY KEY, entity_id TEXT, category TEXT, data TEXT, ts INTEGER)"
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

---

## Related Skills

- **cli**: Config schema, deploy commands, naming conventions, environment setup
- **inference**: Model catalog, request/response formats, calling patterns
- **storage**: Cubby API, state machine pattern, SQL patterns
- **clientsdk**: Sending events from external code into CEF streams
