---
name: cef-cli
description: Use when working with cef.config.yaml, deploying agent services, checking deployment status, cloning existing services, configuring workspaces/streams/deployments, or setting up environment variables. Covers the full config schema, all CLI commands, deploy order, ID writeback, naming conventions, selector conditions, and JSON Schema format for parameters/returns.
---

# CEF Deploy CLI

The `cef-deploy` CLI reads `cef.config.yaml` and manages the full lifecycle of CEF agent services: create, deploy, update, status check, clone, and delete.

## CLI Commands

```bash
npx @cef-ai/deploy-cli deploy -c cef.config.yaml    # Deploy all entities (default)
npx @cef-ai/deploy-cli deploy --dry-run              # Validate config only
npx @cef-ai/deploy-cli deploy --only agents          # Deploy one entity type
npx @cef-ai/deploy-cli status -c cef.config.yaml     # Compare local vs deployed state
npx @cef-ai/deploy-cli services                      # List agent services from ROB
npx @cef-ai/deploy-cli create-service                # Create new agent service
npx @cef-ai/deploy-cli clone -c cef.config.yaml      # Download existing service into directory
npx @cef-ai/deploy-cli delete -c cef.config.yaml     # Delete entities (reverse dependency order)
```

### Deploy Order

Engagements -> Agents -> Cubbies -> Workspaces -> Streams -> Deployments -> Rafts

IDs are written back into `cef.config.yaml` after creation (e.g., `engagementId`, `agentId`, `cubbyId`). On subsequent runs, existing IDs trigger updates instead of creates.

### Status Output

`status` compares local config against deployed state. Each entity shows one of: `up-to-date`, `outdated`, `not-deployed`, `not-found`.

## cef.config.yaml Reference

### Root

```yaml
agentServicePubKey: "0x..."   # REQUIRED; hex public key from ROB
agentServiceId: "2620"        # Auto-resolved, written back after deploy
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
- `alias` fields use **camelCase** (e.g., `objectDetection`)
- Every `.ts` file is fully self-contained; no imports

## Related Skills

- **cef-agent-basics**: Handler signature, runtime API, entity hierarchy
- **cef-inference**: ML model catalog and calling patterns
- **cef-cubby-state**: Storage API and state management
- **cef-orchestration**: Multi-agent coordination patterns
- **cef-generate-topology**: Generate a full project from a natural language goal
