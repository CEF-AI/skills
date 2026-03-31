---
name: cef-generate-topology
description: Use when generating a complete CEF agent service project from a natural language goal or requirement. Provides the 5-step generation process (decompose goal, select patterns, select models, design entity graph, generate project), handler templates, config generation rules, YAML starter configs for common use cases (object detection, NLP pipeline, data sync, real-time analytics), and a pre-output checklist.
---

# CEF Topology Generation

Generate complete, deployable CEF projects from natural language goals. Follow the 5-step process below. Reference the **coding/handlers**, **inference**, **storage**, and **coding/orchestration** skills for detailed API docs.

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

## Related Skills

- **coding/handlers**: Handler signature, runtime API, entity hierarchy
- **cli**: Config schema, deploy commands, naming conventions, environment setup
- **inference**: Model catalog, request/response formats
- **storage**: Storage API, state patterns
- **coding/orchestration**: Multi-agent coordination patterns
