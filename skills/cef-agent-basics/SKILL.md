---
name: cef-agent-basics
description: Use when writing CEF agent handler files, understanding the runtime API (CEFEvent, CEFContext), or learning the CEF entity hierarchy (workspace, stream, engagement, agent, task, cubby). Covers handler signature, V8 isolate constraints, event/context shapes, and project directory conventions.
---

# CEF Agent Basics

CEF AI is a distributed AI infrastructure platform. Agent services run on DDC Compute Nodes as V8 isolates. This skill covers the runtime API and handler writing.

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

## Related Skills

- **cef-cli**: Config schema, deploy commands, environment setup, naming conventions
- **cef-inference**: Calling ML models via context.fetch()
- **cef-cubby-state**: Cubby API and state management patterns
- **cef-orchestration**: Multi-agent coordination, streams, pipelines
- **cef-generate-topology**: Generate a full project from a natural language goal
