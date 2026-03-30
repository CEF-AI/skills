---
name: cef-agent-basics
description: Use when creating a new CEF agent service, writing handler files, setting up cef.config.yaml, or understanding the CEF entity hierarchy (workspace, stream, engagement, agent, task, cubby). Covers project structure, handler signature, V8 isolate constraints, config schema, deploy commands, and naming conventions.
---

# CEF Agent Basics

CEF AI is a distributed AI infrastructure platform. Agent services run on DDC Compute Nodes as V8 isolates. This skill covers everything you need to start building.

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

## CEFEvent Shape

```typescript
interface CEFEvent {
    payload: Record<string, unknown>;
    id?: string;
    event_type?: string;
    app_id?: string;
    timestamp?: string; // ISO 8601
    context_path?: { agent_service: string; workspace: string; stream?: string };
}
```

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

## cef.config.yaml Reference

### Root

```yaml
agentServicePubKey: "0x..."   # REQUIRED; hex public key
agentServiceId: "2620"        # Auto-resolved, written back after deploy

workspaces: [...]             # Optional
engagements: [...]            # Optional
agents: [...]                 # Optional
cubbies: [...]                # Optional
```

### Engagements

```yaml
engagements:
  - name: "My Handler"
    file: ./engagements/handler.ts
    version: "1.0.0"
```

### Agents

```yaml
agents:
  - name: "Object Detection"
    alias: "objectDetection"      # context.agents.objectDetection.*
    version: "1.0.0"
    tasks:
      - name: "Yolo"
        alias: "yolo"             # context.agents.objectDetection.yolo()
        file: ./agents/object-detection/tasks/yolo.ts
        parameters:
          properties:
            image: { type: string }
          type: object
        returns:
          properties:
            detections: { type: array }
          type: object
```

### Cubbies

```yaml
cubbies:
  - alias: "syncMission"
    name: "Sync Mission"
    description: "Per-mission structured data"
    migrations:
      - version: 1
        up: "CREATE TABLE activity (id INTEGER PRIMARY KEY, drone_id TEXT, action TEXT, ts TEXT)"
```

### Workspaces, Streams, Deployments

```yaml
workspaces:
  - name: "Default"
    streams:
      - name: "Events"
        selectors:
          - name: "all"
            conditions: ["*"]
        deployments:
          - name: "Main"
            engagement: "My Handler"   # Name reference to engagement
            isActive: true
            triggers:
              - name: "all"
                conditions: ["*"]
```

## Minimal Config Example

Simplest possible deployment; a single engagement with no agents:

```yaml
agentServicePubKey: "0x..."

engagements:
  - name: "My Handler"
    file: ./engagements/handler.ts
    version: "1.0.0"

workspaces:
  - name: "Default"
    streams:
      - name: "Events"
        selectors:
          - name: "all"
            conditions: ["*"]
        deployments:
          - name: "Main"
            engagement: "My Handler"
            isActive: true
            triggers:
              - name: "all"
                conditions: ["*"]
```

## Environment Variables

```
CEF_AUTH_TOKEN=eyJ...                                          # Required; JWT
CEF_ORCHESTRATOR_URL=https://compute-1.devnet.ddc-dragon.com/orchestrator  # Required
CEF_ROB_API_URL=https://api.rob.dev.cere.io/rms-node-backend  # Required
CEF_DDC_URL=https://compute-1.devnet.ddc-dragon.com/agent     # Optional
```

## Deploy Commands

```bash
npx tsx src/cli.ts services     # List available agent services
npx tsx src/cli.ts              # Deploy everything
npx tsx src/cli.ts --dry-run    # Validate config only
npx tsx src/cli.ts --only agents  # Deploy one entity type
```

Deploy order: Engagements -> Agents -> Cubbies -> Workspaces -> Streams -> Deployments.

IDs are written back into `cef.config.yaml` automatically after creation. On subsequent runs, existing IDs trigger updates instead of creates.

## Naming Conventions

| Entity | `name` | `alias` | Directory |
|-|-|-|-|
| Agent | Title Case | camelCase | kebab-case |
| Task | Title Case | camelCase | N/A |
| Cubby | Title Case | camelCase | N/A |
| Engagement | Title Case | N/A | N/A |

Example: Agent "Object Detection" -> alias `objectDetection` -> directory `object-detection`

## Selector Conditions

Format: `event_type:<your-custom-type>`. Event types are arbitrary strings matching what data producers send. Use `"*"` for catch-all.

```yaml
selectors:
  - name: "videoEvents"
    conditions:
      - "event_type:VIDEO_STREAM_DATA"
      - "event_type:THERMAL_STREAM_DATA"
```

## JSON Schema for Parameters/Returns

Use simple JSON Schema. Types are lowercase: `string`, `number`, `boolean`, `array`, `object`.

```yaml
parameters:
  properties:
    text: { type: string }
    count: { type: number }
  required: [text]
  type: object
returns:
  properties:
    result: { type: object }
  type: object
```

## Related Skills

- **cef-inference**: Calling ML models via context.fetch()
- **cef-cubby-state**: Cubby API and state management patterns
- **cef-orchestration**: Multi-agent coordination, streams, pipelines
- **cef-generate-topology**: Generate a full project from a natural language goal
