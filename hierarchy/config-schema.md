# Config Schema & Project Structure

This document defines the `cef.config.yaml` format and the required directory layout for a CEF deployment project. The `cef-deploy` CLI reads this config to create/update all entities on the CEF infrastructure.

---

## Project Directory Convention

Every CEF deployment project follows this structure:

```
my-project/
├── cef.config.yaml                              ← manifest (references all handler files)
├── .env                                         ← auth token + endpoint URLs
├── engagements/
│   └── {engagement-name}.ts                     ← one file per engagement (fully inline, no imports)
├── agents/
│   └── {agent-name-kebab}/
│       └── tasks/
│           └── {task-name}.ts                   ← one file per task (fully inline, no imports)
└── queries/
    └── {query-name}.ts                          ← one file per cubby query (fully inline, no imports)
```

### Rules

- All `file:` paths in `cef.config.yaml` are **relative** to the config file (e.g., `./agents/object-detection/tasks/yolo.ts`)
- Agent directories use **kebab-case** (e.g., `object-detection`, `parking-violation-detector`)
- `alias` fields use **camelCase** (e.g., `objectDetection`) — this is what `context.agents.<alias>.<taskAlias>()` uses at runtime
- `name` fields are human-readable (e.g., "Object Detection")
- Every `.ts` file must be **fully self-contained** — no `import` or `require` statements
- `parameters` and `returns` use JSON Schema format; defaults to `{ properties: {}, type: "object" }` when omitted

---

## Environment Variables (.env)

| Variable | Required | Used For |
|----------|----------|----------|
| `CEF_AUTH_TOKEN` | Yes | All API calls (JWT) |
| `CEF_ORCHESTRATOR_URL` | Yes | Engagements, agents, workspaces, streams, deployments |
| `CEF_ROB_API_URL` | Yes | Workspace creation, `services` command |
| `CEF_DDC_URL` | Only for cubbies | Cubby and cubby query creation |

Example `.env`:

```
CEF_AUTH_TOKEN=eyJ...
CEF_ORCHESTRATOR_URL=https://compute-1.devnet.ddc-dragon.com/orchestrator
CEF_DDC_URL=https://compute-1.devnet.ddc-dragon.com/agent
CEF_ROB_API_URL=https://api.rob.dev.cere.io/rms-node-backend
```

---

## Full cef.config.yaml Reference

### Root

```yaml
agentServicePubKey: "0x..."   # REQUIRED — hex public key (run `cef-deploy services` to find)
agentServiceId: "2620"        # Auto-resolved from pubKey, written back after first deploy

workspaces: [...]             # Optional — workspace hierarchy
engagements: [...]            # Optional — event handlers
agents: [...]                 # Optional — agent services with tasks
cubbies: [...]                # Optional — state stores with queries
```

Only `agentServicePubKey` is required. All other sections are optional — include only what your topology needs.

### Workspaces

```yaml
workspaces:
  - name: "Freemont"                        # Human-readable name
    description: "Freemont site"            # Optional
    workspaceId: "2198"                     # Written back after creation
    streams:
      - name: "DSC 142"                    # Stream name
        description: "DSC 142"             # Optional
        streamId: "stream-f5213550"        # Written back after creation
        selectors:
          - name: "illegalParkingDetection"
            conditions:
              - "event_type:illegalParking" # User-defined event type filter
        deployments:
          - name: "Illegal Parking Detection"
            description: "Illegal Parking Detection"
            engagement: "Illegal Parking detection"  # Name reference to engagement
            isActive: true
            triggers:
              - name: "all-events"
                conditions:
                  - "*"                    # Wildcard — fire on all events
            engagementRules: []            # Optional rules
            deploymentId: "dep-21e72017"   # Written back after creation
```

### Engagements

```yaml
engagements:
  - name: "Illegal Parking detection"       # Human-readable name
    description: "Illegal Parking Detection" # Optional
    file: ./engagements/engagement.ts        # RELATIVE path to handler file
    version: "1.0.0"                         # Semantic version
    engagementId: "eng-2f8b9517"            # Written back after creation
```

### Agents

```yaml
agents:
  - name: "Object Detection"                # Human-readable name
    alias: "objectDetection"                 # camelCase — context.agents.objectDetection.*
    description: "Object Detection Agent"    # Optional
    version: "1.0.0"                         # Semantic version
    agentId: "agent-628677bd"               # Written back after creation
    tasks:
      - name: "Yolo"                        # Human-readable task name
        alias: "yolo"                       # camelCase — context.agents.objectDetection.yolo()
        file: ./agents/object-detection/tasks/yolo.ts  # RELATIVE path
        parameters:                          # JSON Schema for input
          properties:
            image:
              type: string
          required: []
          type: object
        returns:                             # JSON Schema for output
          properties:
            totalDetections:
              type: number
            detections:
              type: array
            processingTime:
              type: number
          type: object
```

### Cubbies

```yaml
cubbies:
  - name: "syncMission"                     # Store name
    description: "Synchronized drone mission data"  # Optional
    cubbyId: "53d8630e-..."                 # UUID written back after creation
    dataTypes:                               # Enabled data types
      - json
      - search
    queries:
      - name: "syncMission"                # Query name
        file: ./queries/syncMission.ts      # RELATIVE path to query handler
        parameters:                          # JSON Schema for input
          properties:
            missionId:
              type: string
            mode:
              type: string
          required:
            - missionId
          type: object
        returns:                             # JSON Schema for output
          properties:
            success:
              type: boolean
            data:
              type: object
          type: object
```

---

## ID Writeback

When `cef-deploy` creates a new entity, it writes the returned ID back into `cef.config.yaml` automatically. On subsequent runs, the CLI detects existing IDs and issues updates instead of creates.

Written-back fields:
- `engagementId` on engagements
- `agentId` on agents
- `cubbyId` on cubbies
- `workspaceId` on workspaces
- `streamId` on streams
- `deploymentId` on deployments
- `agentServiceId` at root level

Cubby queries are identified by name and do not get an ID — the CLI creates or updates based on name match.

---

## Deploy Commands

```bash
# List available agent services (no config needed — just .env)
npx tsx src/cli.ts services

# Deploy everything
npx tsx src/cli.ts

# Validate config — no API calls
npx tsx src/cli.ts --dry-run

# Deploy only one entity type
npx tsx src/cli.ts --only engagements
npx tsx src/cli.ts --only agents
npx tsx src/cli.ts --only cubbies
npx tsx src/cli.ts --only workspaces
npx tsx src/cli.ts --only streams
npx tsx src/cli.ts --only deployments

# Custom config path
npx tsx src/cli.ts --config ./other.yaml
```

---

## Deploy Order

The CLI deploys entities in this order:

1. **Engagements** — must exist before deployments reference them
2. **Agents** — independent, can be deployed in any order
3. **Cubbies** — independent, cubby queries are created/updated alongside
4. **Workspaces** → **Streams** → **Deployments** — hierarchical, parent must exist first

---

## Minimal Config Example

The simplest possible deployment — a single engagement with no agents:

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
