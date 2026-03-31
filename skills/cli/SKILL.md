---
name: cef-cli
description: Use when working with cef.config.yaml, deploying agent services, checking deployment status, cloning existing services, configuring workspaces/streams/deployments/rafts, or setting up environment variables. Covers the full config schema, all CLI commands and flags, deploy order, ID writeback, naming conventions, selector conditions, and JSON Schema format for parameters/returns.
---

# CEF Deploy CLI

The `cef-deploy` CLI (v0.1.3) reads `cef.config.yaml` and manages the full lifecycle of CEF agent services: create, deploy, update, status check, clone, and delete. Requires Node.js 18+.

## Installation

```bash
npm install -g @cef-ai/deploy-cli   # Global install
npx @cef-ai/deploy-cli --help       # Or run directly
```

## CLI Commands

### deploy (default)

Creates or updates all entities from config. IDs are written back after each entity type completes (crash recovery).

```bash
cef-deploy                                        # Deploy all (default command)
cef-deploy deploy --config ./app/cef.config.yaml  # Explicit config path
cef-deploy deploy --dry-run                       # Preview without calling API
cef-deploy deploy --only agent                    # Deploy single entity type
```

`--only` types: `engagement`, `agent`, `cubby`, `workspace`, `stream`, `deployment`, `raft`

**Stale ID detection:** If `agentServicePubKey` changes, the CLI prompts to clear existing IDs to avoid deploying to the wrong service.

### status

Compares local config against deployed state. Each entity shows: `up-to-date`, `outdated`, `not-deployed`, or `not-found`.

```bash
cef-deploy status -c cef.config.yaml
```

### services

Lists registered agent services from ROB with IDs, public keys, and creation dates.

```bash
cef-deploy services
```

### create-service

Creates a new agent service on ROB and orchestrator. Returns `agentServicePubKey` and `agentServiceId`.

```bash
cef-deploy create-service --name my-agent              # Default bucket
cef-deploy create-service --name my-agent --bucket-id 1505  # Specific DDC bucket
```

| Flag | Required | Description |
|-|-|-|
| `--name` | Yes | Service name |
| `--bucket-id` | No | DDC bucket ID (default: 0) |

### clone

Downloads an existing agent service into a local directory: config, engagement files, agent tasks, workspace/stream/deployment structure.

```bash
cef-deploy clone -c cef.config.yaml                   # From existing config
cef-deploy clone --pubkey 0x... --output-dir ./my-app  # From public key
cef-deploy clone --pubkey 0x... --force                # Overwrite existing files
```

| Flag | Required | Description |
|-|-|-|
| `--pubkey` | No | Agent service public key (alternative to config) |
| `--output-dir` | No | Output directory (default: config directory) |
| `--force` | No | Overwrite existing files |

`.env` is loaded from `--output-dir` (or from the directory of `--config`).

### delete

Deletes deployed entities in reverse dependency order: deployments -> rafts -> streams -> workspaces -> agents -> engagements. Removes IDs from config afterward.

```bash
cef-deploy delete -c cef.config.yaml          # Delete all (with confirmation)
cef-deploy delete -c cef.config.yaml --force  # Skip confirmation
cef-deploy delete --only deployment            # Delete single entity type
```

**Note:** Cubbies cannot be deleted via the CLI.

## Deploy Order

Engagements -> Agents -> Cubbies -> Workspaces -> Streams -> Deployments -> Rafts

IDs written back after creation: `engagementId`, `agentId`, `cubbyId`, `workspaceId`, `streamId`, `deploymentId`, `raftId`. On subsequent runs, existing IDs trigger updates instead of creates. Commit the updated config after deploy.

## cef.config.yaml Reference

### Root

```yaml
agentServicePubKey: "0x..."   # REQUIRED; hex public key from ROB or create-service
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

When `parameters` or `returns` are omitted, they default to `{ properties: {}, type: "object" }`.

### Cubbies

```yaml
cubbies:
  - alias: "syncMission"
    name: "Sync Mission"
    description: "Per-mission structured data"
    maxSizeBytes: 10737418240
    idleTimeout: "24h"
    migrations:
      - version: 1
        up: "CREATE TABLE activity (id INTEGER PRIMARY KEY, drone_id TEXT, action TEXT, ts TEXT)"
```

### Workspaces, Streams, Deployments, Rafts

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
        rafts:
          - name: "My Raft"
            file: ./rafts/my-raft.ts
```

Rafts are defined under streams. A raft file must export `onInit()`, `onData()`, `query()`, and `onCleanup()`.

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

Loaded from `.env` in the config file directory (or `--output-dir` for clone).

| Variable | Required | Description |
|-|-|-|
| `CEF_AUTH_TOKEN` | Yes (all API commands) | Bearer JWT (same as ROB UI) |
| `CEF_ORCHESTRATOR_URL` | Yes (deploy, status, clone, delete) | e.g. `https://compute-1.devnet.ddc-dragon.com/orchestrator` |
| `CEF_ROB_API_URL` | Yes (services, create-service, workspace/cubby ops) | e.g. `https://api.rob.dev.cere.io/rms-node-backend` |
| `CEF_ROB_ORIGIN` | No | Override Origin/Referer header; auto-detected if unset |

## All Flags Reference

| Flag | Commands | Description |
|-|-|-|
| `--config <path>` / `-c` | All | Config file path (default: `./cef.config.yaml`) |
| `--dry-run` | deploy | Show operations without calling API |
| `--only <type>` | deploy, delete | Act on single entity type |
| `--pubkey <key>` | clone | Agent service public key (0x...) |
| `--output-dir <dir>` | clone | Output directory |
| `--force` | clone, delete | Overwrite files / skip confirmation |
| `--name <name>` | create-service | Service name (required) |
| `--bucket-id <id>` | create-service | DDC bucket ID (default: 0) |

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
├── agents/
│   └── {agent-kebab}/
│       └── tasks/
│           └── {task}.ts    # One file per task (fully inline)
└── rafts/                   # Optional
    └── {name}.ts            # Raft handlers (onInit, onData, query, onCleanup)
```

Rules:
- All `file:` paths in config are **relative** to the config file
- Agent directories use **kebab-case** (e.g., `object-detection`)
- `alias` fields use **camelCase** (e.g., `objectDetection`)
- Every `.ts` handler file is fully self-contained; no imports

## Standard Workflow

1. `cef-deploy create-service --name my-agent` to provision
2. Set up `.env` and `cef.config.yaml`
3. `cef-deploy` to deploy
4. `cef-deploy status` to verify
5. Modify config/handlers and redeploy
6. `cef-deploy clone --pubkey 0x...` to share with team
7. `cef-deploy delete` to clean up

## Related Skills

- **coding**: Handler signature, runtime API, entity hierarchy, orchestration patterns, topology generation
- **inference**: ML model catalog and calling patterns
- **storage**: Storage API and state management
