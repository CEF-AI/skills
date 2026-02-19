# CEF Hierarchy

The resource hierarchy for a CEF agent service.

---

## Structure

```
Agent Service: {name}                    ← top-level container (identified by pubkey)
└── Workspace: {workspace-name}          ← logical grouping
    └── Stream: {stream-name}            ← event channel
        ├── Raft: {raft-name}            ← data preprocessor (match: metadata.type)
        └── Deployment: {deployment-name} ← agent code deployment
            └── Engagement: {engagement-name} → Concierge
                ├── Child Agent: {agent-1}
                └── Child Agent: {agent-2}
```

---

## Components

### Agent Service
- Top-level container, identified by a public key
- Contains workspaces, cubbies, and agent deployments
- Created via SDK or UI

### Workspace
- Logical grouping within an agent service
- Organizes streams, deployments, and resources
- Has members with roles

### Stream
- Event channel for publishing/subscribing to typed events
- Events are JSON payloads with `event_type` discriminator
- Streams can have child streams

### Raft
- Data preprocessor attached to a stream
- Filters, classifies, and pre-indexes data
- No compute cost — filter/map/reduce only
- Matches events by `metadata.type`

### Deployment
- Agent code deployed to the runtime (V8 isolate)
- Each deployment runs a handler (`handle(event, context)`)
- Multiple deployments can run the same handler with different config (e.g., different model IDs)

### Engagement
- Trigger rules that connect streams to deployments
- Defines when and how an agent is invoked
- Can route to a concierge (orchestrator) that manages child agents

### Cubby
- Named key-value store (not in the hierarchy tree, but attached to agent service)
- Separate from the workspace hierarchy
- Accessed via `context.cubby(name)` in handlers

---

## Naming Conventions

| Resource | Convention | Example |
|----------|-----------|---------|
| Agent Service | Descriptive name | `sot-knowledge-evaluator` |
| Workspace | Domain-scoped | `wiki-evaluation` |
| Stream | Event-type based | `notion-changes`, `eval-results` |
| Deployment | Handler + model | `eval-gemini`, `eval-claude` |
| Engagement | Trigger description | `on-page-change`, `on-batch-eval` |
| Cubby | `{domain}-{concern}` | `sot-evals`, `sot-deltas` |
