# CEF Entity Model

This document defines every entity in the CEF deployment hierarchy, how they relate, and the runtime constraints that govern them. This is the foundational reference for understanding what a CEF topology looks like.

---

## Entity Hierarchy

```
AgentService (identified by agentServicePubKey)
│
├── Workspace (logical grouping — e.g., a site, region, or project)
│   └── Stream (event channel within a workspace)
│       ├── Selector (filters which events enter the stream)
│       └── Deployment (binds a stream to an engagement)
│           └── Trigger (conditions that fire the engagement)
│
├── Engagement (event handler — the orchestrator/concierge)
│
├── Agent (named service with one or more tasks)
│   └── Task (individual handler function with typed params/returns)
│
└── Cubby (named key-value state store)
    └── Query (read handler exposing cubby data to external callers)
```

---

## Entity Definitions

### AgentService

The top-level container. Everything in a CEF deployment belongs to one agent service. Identified by a public key (`agentServicePubKey`).

| Field | Type | Description |
|-------|------|-------------|
| `agentServicePubKey` | `string` | Hex public key (e.g., `0x788b...`) identifying the agent service |
| `agentServiceId` | `string` | Numeric ROB ID, auto-resolved from pubKey |

### Workspace

A logical grouping within an agent service. Represents a site, region, project, or any organizational boundary.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Human-readable name (e.g., "Freemont") |
| `description` | `string` | Optional description |
| `workspaceId` | `string` | Assigned after creation |

Workspaces are created via a dual-endpoint flow: ROB Backend registers it, then the Orchestrator provisions it on the compute cluster.

### Stream

An event channel within a workspace. Events from external sources flow into streams.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Human-readable name (e.g., "DSC 142") |
| `description` | `string` | Optional description |
| `streamId` | `string` | Assigned after creation |
| `selectors` | `Selector[]` | Filters that control which events enter this stream |
| `deployments` | `Deployment[]` | Bindings that connect this stream to engagements |

### Selector

Filters events entering a stream based on user-defined conditions. Event types are arbitrary strings — there is no fixed set.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Selector name (e.g., "illegalParkingDetection") |
| `conditions` | `string[]` | Filter conditions (e.g., `["event_type:illegalParking"]` or `["*"]` for all) |

Condition format: `event_type:<your-custom-type>`. The event type string is whatever your data producer sends. Use `"*"` to accept all events.

### Deployment

Binds a stream to an engagement. When events match the deployment's triggers, the engagement handler is invoked.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Human-readable name |
| `description` | `string` | Optional description |
| `deploymentId` | `string` | Assigned after creation |
| `engagement` | `string` | Name reference to an engagement (resolved to ID at deploy time) |
| `isActive` | `boolean` | Whether this deployment is active |
| `triggers` | `Trigger[]` | Conditions that fire the engagement |

### Trigger

Conditions that determine when a deployment fires its engagement.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Trigger name (e.g., "all-events") |
| `conditions` | `string[]` | Trigger conditions (e.g., `["*"]` for all events) |

### Engagement

The main event handler — typically an orchestrator or "concierge" that receives events from streams and dispatches work to agents. Each engagement is a single TypeScript file.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Human-readable name |
| `description` | `string` | Optional description |
| `engagementId` | `string` | Assigned after creation |
| `file` | `string` | Relative path to the `.ts` handler file |
| `version` | `string` | Semantic version (e.g., "1.0.0") |

The engagement handler has full access to the CEF runtime: `context.cubby()`, `context.agents.*`, `context.streams.subscribe()`, `context.fetch()`, and `context.log()`.

Multiple engagements can exist in one agent service, each with their own agent graph. An engagement can also be standalone (no agents) for simple event processing.

### Agent

A named service containing one or more tasks. Agents are invoked by engagements (or other agents) via `context.agents.<alias>.<taskAlias>(payload)`.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Human-readable name (e.g., "Object Detection") |
| `alias` | `string` | camelCase code identifier (e.g., `objectDetection`) — used in `context.agents.<alias>` |
| `description` | `string` | Optional description |
| `agentId` | `string` | Assigned after creation |
| `version` | `string` | Semantic version |
| `tasks` | `Task[]` | The handler functions this agent exposes |

### Task

A single handler function within an agent. Each task is a TypeScript file with typed parameters and returns.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Human-readable name (e.g., "Yolo") |
| `alias` | `string` | camelCase code identifier (e.g., `yolo`) — used in `context.agents.<agentAlias>.<taskAlias>()` |
| `file` | `string` | Relative path to the `.ts` handler file |
| `parameters` | `JSON Schema` | Input schema (defaults to `{ properties: {}, type: "object" }`) |
| `returns` | `JSON Schema` | Output schema (defaults to `{ properties: {}, type: "object" }`) |

### Cubby

A named key-value state store with JSON, vector, and primitive sub-stores. Used for long-term memory and agent-to-agent state sharing.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Store name (e.g., "syncMission") |
| `description` | `string` | Optional description |
| `cubbyId` | `string` | UUID assigned after creation |
| `dataTypes` | `string[]` | Enabled data types (e.g., `["json", "search"]`) |
| `queries` | `CubbyQuery[]` | Read handlers for external access |

### CubbyQuery

A read handler that exposes cubby data to external callers (e.g., client apps via the SDK).

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Query name |
| `file` | `string` | Relative path to the `.ts` handler file |
| `parameters` | `JSON Schema` | Input schema |
| `returns` | `JSON Schema` | Output schema |

---

## Runtime Constraints

### No imports — all handler code must be fully inline

The CEF Agent Runtime executes handlers in V8 isolates. **`import` and `require` are not supported.** Every `.ts` handler file must be entirely self-contained:

- All utility functions, constants, type definitions, and helper logic must be defined inside the same file
- If two handlers need the same helper (e.g., `retry()`, `formatLog()`), each must define its own copy
- The only external access is through `context.*` APIs injected at runtime

### Handler signature

Every handler exports a single `handle` function:

```typescript
async function handle(event: { payload: Record<string, unknown> }, context: CEFContext): Promise<unknown> {
    // handler logic
}
```

- `event.payload` contains the input data (destructured by the handler)
- `context` provides cubby, agents, streams, fetch, and log APIs
- The return value is sent back to the caller (engagement or another agent)

### Storage: Cubby

| Store | API | Use For | Scope |
|-------|-----|---------|-------|
| **Cubby** | `context.cubby(name)` | Long-term persistent data, agent-to-agent sharing, query-accessible state | Named store, cross-invocation |

### Inference via context.fetch()

All model inference goes through `context.fetch()` to inference endpoints. See `models/inference-catalog.md`.

---

## How Entities Wire Together

A concrete example — "detect illegally parked cars from drone footage":

1. **Workspace**: "Freemont" (the geographic site)
2. **Stream**: "DSC 142" (the drone's data channel)
3. **Selector**: `event_type:illegalParking` (filters to parking-related events)
4. **Engagement**: "Illegal Parking Detection" (the orchestrator that processes multi-stream drone data)
5. **Agents**:
   - "Object Detection" with task "Yolo" (runs YOLO model on images)
   - "Parking Violation Detector" with task "Detect" (classifies violations from detections + telemetry)
6. **Cubby**: "syncMission" (stores synced drone packets, violation records)
7. **CubbyQuery**: "syncMission" (exposes mission data to the client UI)
8. **Deployment**: "Illegal Parking Detection" (binds stream → engagement, trigger: all events)

The engagement subscribes to the stream, receives drone events, calls the object detection agent, passes results to the violation detector, stores everything in cubby, and the client UI queries the cubby for results.

---

## Naming Conventions

| Entity | `name` | `alias` | Example |
|--------|--------|---------|---------|
| Agent | Human-readable, title case | camelCase | name: "Object Detection", alias: `objectDetection` |
| Task | Human-readable | camelCase | name: "Yolo", alias: `yolo` |
| Cubby | kebab-case or camelCase | Same as name | name: "syncMission" |
| Engagement | Human-readable | N/A | name: "Illegal Parking Detection" |

The `alias` is what appears in code: `context.agents.objectDetection.yolo(payload)`.
