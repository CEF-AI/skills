---
name: cef-cli
description: Use when working with cef.config.yaml, deploying agent services, checking deployment status, cloning existing services, configuring workspaces/streams/deployments/rafts, setting up environment variables, local development with cef dev, testing with playground, deleting entities, or understanding the full development lifecycle from idea to deployment to teardown. Covers config schema, all CLI commands and flags, deploy/delete order, entity decision guide, ID writeback, naming conventions, selector conditions, and JSON Schema format for parameters/returns.
---

# CEF CLI

The `cef` CLI reads `cef.config.yaml` and manages the full lifecycle of CEF agent services: create, develop locally, deploy, update, status check, test, clone, and delete. Requires Node.js 18+.

## Installation

```bash
npm install -g @cef-ai/cli   # Global install
npx @cef-ai/cli --help       # Or run directly
```

## CLI Commands

### deploy (default)

Creates or updates all entities from config. IDs are written back after each entity type completes (crash recovery).

```bash
cef deploy                                        # Deploy all (default command)
cef deploy --config ./app/cef.config.yaml         # Explicit config path
cef deploy --dry-run                              # Preview without calling API
cef deploy --only agent                           # Deploy single entity type
```

> **Prefer `--only` for iterative deploys.** A bare `cef deploy` validates all workspace IDs against the orchestrator. If a workspace was created outside the orchestrator API (e.g. via ROB UI), the CLI logs a warning but keeps the existing ID. For routine handler/agent updates, use `cef deploy --only engagement` or `cef deploy --only agent` to skip workspace validation entirely.

> **`--only engagement` side effect:** Every run creates an extra "Mock Workspace YYYY-MM-DD" workspace as a CLI test artifact. Clean these up after each deploy: `DELETE $CEF_ORCHESTRATOR_URL/api/v1/agent-services/$PUBKEY/workspaces/{id}` — the orphaned workspace ID appears in `GET .../workspaces`.

`--only` types: `engagement`, `agent`, `cubby`, `workspace`, `stream`, `deployment`, `raft`

**Stale ID detection:** If `agentServicePubKey` changes, the CLI prompts to clear existing IDs to avoid deploying to the wrong service.

### status

Compares local config against deployed state. Each entity shows: `up-to-date`, `outdated`, `not-deployed`, or `not-found`.

```bash
cef deploy status -c cef.config.yaml
```

### service list

Lists registered agent services from ROB with IDs, public keys, and creation dates.

```bash
cef service list
```

### service create

Creates a new agent service on ROB and orchestrator. Returns `agentServicePubKey` and `agentServiceId`.

```bash
cef service create --name my-agent              # Default bucket
cef service create --name my-agent --bucket-id 1505  # Specific DDC bucket
```

| Flag | Required | Description |
|-|-|-|
| `--name` | Yes | Service name |
| `--bucket-id` | No | DDC bucket ID (default: 0) |

### clone

Downloads an existing agent service into a local directory: config, engagement files, agent tasks, workspace/stream/deployment structure.

```bash
cef deploy clone -c cef.config.yaml                   # From existing config
cef deploy clone --pubkey 0x... --output-dir ./my-app  # From public key
cef deploy clone --pubkey 0x... --force                # Overwrite existing files
```

| Flag | Required | Description |
|-|-|-|
| `--pubkey` | No | Agent service public key (alternative to config) |
| `--output-dir` | No | Output directory (default: config directory) |
| `--force` | No | Overwrite existing files |

`.env` is loaded from `--output-dir` (or from the directory of `--config`).

### delete

Deletes deployed entities in reverse dependency order. Removes IDs from config after each deletion.

```bash
cef deploy delete                       # Delete all (with confirmation prompt)
cef deploy delete --force               # Skip confirmation
cef deploy delete --only stream         # Delete single entity type
cef deploy delete --only deployment     # Delete just deployments
```

**Delete order (mandatory, enforced by CLI):**

```
deployments -> rafts -> streams -> workspaces -> agents -> engagements
```

This is the reverse of deploy order. You must delete dependents first. For example, you cannot delete a stream while deployments still reference it.

**`--only` types:** `deployment`, `raft`, `stream`, `workspace`, `agent`, `engagement`

**Common deletion scenarios:**

| Goal | Command |
|-|-|
| Tear down everything | `cef deploy delete` |
| Redeploy stream routing only | `cef deploy delete --only deployment` then `cef deploy --only deployment` |
| Remove a workspace and its children | Delete in order: `--only deployment`, `--only raft`, `--only stream`, `--only workspace` |
| Clean slate (skip prompts) | `cef deploy delete --force` |

**Notes:**
- Cubbies cannot be deleted via the CLI
- 404 errors are handled gracefully (entity already gone)
- IDs are removed from `cef.config.yaml` after deletion; commit the updated config
- To remove a single stream while keeping others, remove it from config and redeploy

### dev

Starts a local development server with full runtime emulation. No auth or environment variables required.

```bash
# ⚠️ If `cef dev` from PATH produces no output and exits silently, use the full path:
node /path/to/global/node_modules/@cef-ai/cli/dist/cli.js dev --config cef.config.yaml

cef dev                             # Start at default port 8787
cef dev --config ./my-agent/cef.config.yaml  # Custom config
cef dev --port 3000                 # Custom port
cef dev --persist                   # Keep .cef-dev/ data after server stops
```

| Flag | Default | Description |
|-|-|-|
| `--config <path>` | `./cef.config.yaml` | Config file path |
| `--port <port>` | `8787` | Server port |
| `--host <host>` | `localhost` | Server host |
| `--persist` | `false` | Keep `.cef-dev/` data after server stops (default: cleared on shutdown) |

**What it provides:**
- Browser UI at `http://localhost:8787`: topology view, engagement/agent/cubby panels
- Hot reload on TypeScript file changes
- Stream push: single packet, bulk (JSON Lines), or file upload (.json/.jsonl)
- Cubby browser with table discovery and SQL editor
- Live logs and execution flow tracing (engagement -> agent -> cubby chain)
- WebSocket real-time updates
- Agents run in sandboxed VM with full Context API
- Cubbies backed by real SQLite (sql.js); your SQL queries run for real
- `.cef-dev/` data is cleared on shutdown by default; use `--persist` to keep it between restarts

**Dev server HTTP API:**

| Endpoint | Method | Description |
|-|-|-|
| `/` | GET | Dev UI |
| `/api/trigger` | POST | Start engagement. Body: `{ "engagement": "Name", "payload": {} }` |
| `/api/agents/:alias/:task` | POST | Call agent task directly. Body: payload object |
| `/api/streams/:id/push` | POST | Push stream packet. Body: packet data |
| `/api/cubbies/:alias/query` | POST | SQL read. Body: `{ "sql": "SELECT ...", "params": [], "instanceId": "default" }` |
| `/api/cubbies/:alias/exec` | POST | SQL write. Body: `{ "sql": "INSERT ...", "params": [], "instanceId": "default" }` |
| `/api/cubbies/:alias/instances` | GET | List cubby instances |
| `/api/topology` | GET | View topology JSON |
| `/api/executions` | GET | Get all execution logs |
| `/ws` | WS | Real-time logs and trace events |

**Note:** There is no `/api/executions/:id` endpoint to poll for a specific execution's result. After triggering via `/api/trigger`, check the cubby for expected state changes or watch the WebSocket (`/ws`) for completion events.

### playground test

Run handler tests against a deployed agent service via MCP.

```bash
cef playground test --agent "My Agent" --tool myTask --args '{"input": "test"}'  # Single test
cef playground test --test-file cef.tests.yaml                                    # Batch from file
cef playground test --agent "My Agent" --list-tools                               # List available tools
```

| Flag | Description |
|-|-|
| `--agent <name>` | Agent name, alias, or agentId |
| `--tool <alias>` | Task alias to invoke |
| `--args <json>` | JSON arguments for the tool |
| `--test-file <path>` | Path to `cef.tests.yaml` for batch testing |
| `--list-tools` | List available tools on the agent |

**Batch test file format (`cef.tests.yaml`):**

```yaml
tests:
  - agent: "My Agent"
    tool: "myTask"
    arguments: { input: "hello" }
    expect:
      success: true
  - agent: "My Agent"
    tool: "myTask"
    arguments: { input: "world" }
```

### Local Automated Tests

Write Vitest tests against the local `cef dev` server to verify agent responses and cubby state programmatically. Start `cef dev` in a separate terminal first.

**Setup:**

```bash
npm install -D vitest
```

Add to `package.json`:

```json
{ "scripts": { "test": "vitest run", "test:watch": "vitest" } }
```

**Test helpers (`tests/helpers.ts`):**

```ts
const BASE = process.env.CEF_DEV_URL ?? "http://localhost:8787";

export const post = async (path: string, body: Record<string, unknown> = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};

/** SQL read against a local cubby */
export const query = async (cubbyAlias: string, sql: string, params: unknown[] = []) =>
  post(`/api/cubbies/${cubbyAlias}/query`, { sql, params, instanceId: "default" });

/** SQL write against a local cubby */
export const exec = async (cubbyAlias: string, sql: string, params: unknown[] = []) =>
  post(`/api/cubbies/${cubbyAlias}/exec`, { sql, params, instanceId: "default" });
```

**Example: test agent task response (`tests/agents.test.ts`):**

```ts
import { describe, it, expect } from "vitest";
import { post } from "./helpers";

describe("agent tasks", () => {
  it("returns expected result from myTask", async () => {
    const { status, data } = await post("/api/agents/myAgent/myTask", {
      input: "test",
    });
    expect(status).toBe(200);
    expect(data).toHaveProperty("result");
  });
});
```

**Example: trigger engagement and verify cubby state (`tests/engagement.test.ts`):**

```ts
import { describe, it, expect } from "vitest";
import { post, query } from "./helpers";

describe("engagement flow", () => {
  it("stores data in cubby after trigger", async () => {
    const { status } = await post("/api/trigger", {
      engagement: "My Handler",
      payload: { event: "test-event" },
    });
    expect(status).toBe(200);

    // Verify the agent wrote to the cubby
    const { data } = await query(
      "missionData",
      "SELECT * FROM activity ORDER BY id DESC LIMIT 1"
    );
    expect(data.rows.length).toBeGreaterThan(0);
    expect(data.rows[0].action).toBe("test-event");
  });
});
```

**Example: seed and verify cubby SQL (`tests/cubby.test.ts`):**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { query, exec } from "./helpers";

describe("cubby state", () => {
  beforeAll(async () => {
    await exec("missionData", "INSERT INTO activity (drone_id, action, ts) VALUES (?, ?, ?)", [
      "drone-test", "seed", new Date().toISOString(),
    ]);
  });

  it("reads back seeded data", async () => {
    const { data } = await query(
      "missionData",
      "SELECT COUNT(*) as cnt FROM activity WHERE drone_id = ?",
      ["drone-test"]
    );
    expect(data.rows[0].cnt).toBeGreaterThanOrEqual(1);
  });
});
```

**Local dev endpoints for tests:**

| Helper | Endpoint | Use |
|-|-|-|
| `post("/api/agents/:alias/:task", body)` | Agent task | Call a task, assert on response |
| `post("/api/trigger", { engagement, payload })` | Engagement | Fire engagement, then verify side effects in cubbies |
| `query(alias, sql, params)` | Cubby read | `SELECT` to verify stored state |
| `exec(alias, sql, params)` | Cubby write | `INSERT`/`DELETE` for setup and teardown |

**Tips:**

- `cef dev` clears local state on shutdown by default; use `--persist` if you need data to survive restarts
- Use `beforeAll`/`afterAll` with `exec()` to seed and clean up cubby data
- For engagement tests that trigger async agent chains, poll the cubby until expected rows appear
- Run `npm test` alongside `cef dev` as part of your dev loop

## Deploy Order

Engagements -> Agents -> Cubbies -> Workspaces -> Streams -> Deployments -> Rafts

IDs written back after creation: `engagementId`, `agentId`, `cubbyId`, `workspaceId`, `streamId`, `deploymentId`, `raftId`. On subsequent runs, existing IDs trigger updates instead of creates. Commit the updated config after deploy.

## Entity Decision Guide

### How events reach your handler code

```
Workspace -> Stream -> Selector (filters events) -> Deployment -> Engagement (handler code)
                                                       └-> Trigger (firing conditions)
```

Engagements live under deployments. A deployment activates an engagement on a stream. Without the full workspace -> stream -> deployment chain, an engagement is dead code that never executes.

### Entity roles

| Entity | What it is | When to create |
|-|-|-|
| Agent Service | Root container; identified by pubkey | Once per project (`cef service create`) |
| Workspace | Logical grouping (site, region, project) | One per logical boundary |
| Stream | Event channel within a workspace | One per event source |
| Selector | Filters which events enter the stream | One per event type filter (or `"*"` for all) |
| Deployment | Activates an engagement on a stream | One per engagement you want receiving events from that stream |
| Trigger | Conditions that fire the engagement | Usually one `"*"` catch-all per deployment |
| Engagement | Handler code under a deployment; orchestrates agents | One per distinct event processing flow |
| Agent | Reusable service with typed tasks (independent of streams) | One per distinct capability |
| Task | Individual handler on an agent | One per operation (inference, transform, etc.) |
| Cubby | Persistent SQLite database; 1:1 with workspace | One per workspace. Use multiple tables via migrations, not multiple cubbies |

### Anti-patterns

- **Engagement as worker:** Do not put inference or computation directly in the engagement. Extract it into agent tasks. Engagements orchestrate; agents compute.
- **Cubbies as data transport:** Do not have Agent A write to a cubby so the engagement can read it and pass to Agent B. Pass A's return value directly to B through the engagement.
- **Missing wiring:** Creating an engagement without the workspace -> stream -> deployment chain means it never executes.
- **One workspace per stream:** Workspaces group related streams. Put related streams under one workspace.
- **Multiple cubbies per workspace:** Do not create separate cubbies for `detections`, `results`, `state`. Use one cubby per workspace with multiple tables via migrations.

## cef.config.yaml Reference

### Root

```yaml
agentServicePubKey: "<64-char hex>"   # REQUIRED; 64-char hex pubkey from ROB or create-service, no 0x prefix
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

Cubbies are 1:1 with workspaces. Define one cubby per workspace with all tables in migrations.

```yaml
cubbies:
  - alias: "missionData"
    name: "Mission Data"
    description: "All tables for this workspace"
    maxSizeBytes: 10737418240
    idleTimeout: "24h"
    migrations:
      - version: 1
        up: |
          CREATE TABLE activity (id INTEGER PRIMARY KEY, drone_id TEXT, action TEXT, ts TEXT);
          CREATE TABLE detections (id INTEGER PRIMARY KEY, entity_id TEXT, data TEXT, created_at TEXT);
          CREATE TABLE processed (event_id TEXT PRIMARY KEY, processed_at TEXT)
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
agentServicePubKey: "<64-char hex>"

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
| `CEF_AUTH_TOKEN` | Yes (all API commands) | Bearer JWT from ROB UI DevTools → Network → `verify` request → Response. JWT `aud` field identifies the environment. |
| `CEF_ORCHESTRATOR_URL` | Yes (deploy, status, clone, delete) | `https://orchestrator.compute.test.ddcdragon.com` |
| `CEF_ROB_API_URL` | Yes (services, create-service, workspace/cubby ops) | `https://rob.compute.test.ddcdragon.com/rms-node-backend` |
| `CEF_ROB_ORIGIN` | No | Override Origin/Referer header; auto-detected if unset |

**Note:** `cef dev` does not require any environment variables.

### Environment URL Reference

All test net services. Inference is currently on devnet, not test net.

| Service | URL |
|-|-|
| Orchestrator | `https://orchestrator.compute.test.ddcdragon.com` |
| ROB UI | `https://rob.compute.test.ddcdragon.com/` |
| ROB API | `https://rob.compute.test.ddcdragon.com/rms-node-backend` |
| GAR | `https://gar.compute.test.ddcdragon.com/` |
| Agent Runtime | `https://agent.compute.test.ddcdragon.com` |
| Events | `https://events.compute.test.ddcdragon.com` |
| Resource Manager | `https://resources.compute.test.ddcdragon.com` |
| SIS | `https://sis.compute.test.ddcdragon.com` |
| WebTransport | `https://sis-0.compute.test.ddcdragon.com:4433` |
| Inference (devnet) | `https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference` |

## All Flags Reference

| Flag | Commands | Description |
|-|-|-|
| `--config <path>` / `-c` | All | Config file path (default: `./cef.config.yaml`) |
| `--dry-run` | deploy | Show operations without calling API |
| `--only <type>` | deploy, delete | Act on single entity type |
| `--pubkey <key>` | clone | Agent service public key (0x...) |
| `--output-dir <dir>` | clone | Output directory |
| `--force` | clone, delete | Overwrite files / skip confirmation |
| `--name <name>` | service create | Service name (required) |
| `--bucket-id <id>` | service create | DDC bucket ID (default: 0) |
| `--port <port>` | dev | Server port (default: 8787) |
| `--host <host>` | dev | Server host (default: localhost) |
| `--persist` | dev | Keep `.cef-dev/` data after shutdown (default: cleared) |
| `--agent <name>` | playground test | Agent name, alias, or agentId |
| `--tool <alias>` | playground test | Task alias to invoke |
| `--args <json>` | playground test | JSON arguments |
| `--test-file <path>` | playground test | Batch test file path |
| `--list-tools` | playground test | List available tools |

## Naming Conventions

| Entity | `name` | `alias` | Directory |
|-|-|-|-|
| Agent | Title Case | camelCase | kebab-case |
| Task | Title Case | camelCase | N/A |
| Cubby | Title Case | camelCase | N/A |
| Engagement | Title Case | N/A | N/A |

Example: Agent "Object Detection" -> alias `objectDetection` -> directory `object-detection`

> **`alias` must be a valid JavaScript identifier.** Hyphens are rejected at deploy time with `INVALID_ALIAS`. `my-agent` → invalid; `myAgent` → valid. This applies to both agent aliases and task aliases, since they map to `ctx.agents.myAgent.myTask()` in handler code.

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

## Full Development Lifecycle

### 1. Create the agent service

```bash
cef service create --name my-agent
# Returns agentServicePubKey and agentServiceId
```

### 2. Set up project structure

```bash
mkdir my-agent && cd my-agent
```

Create `cef.config.yaml` with the returned `agentServicePubKey`. Create `.env` with `CEF_AUTH_TOKEN`, `CEF_ORCHESTRATOR_URL`, `CEF_ROB_API_URL`. Create `engagements/` and `agents/` directories per the directory convention above.

### 3. Develop locally

```bash
cef dev
# Open http://localhost:8787
# Use the UI to trigger engagements, call agents, push stream data, browse cubbies
# Code changes hot-reload automatically
```

### 4. Test handlers

```bash
# Call an agent task directly via dev server
curl -X POST http://localhost:8787/api/agents/myAgent/myTask \
  -H 'Content-Type: application/json' \
  -d '{"input": "test"}'

# Or test against a deployed service
cef playground test --agent "My Agent" --tool myTask --args '{"input": "test"}'

# Or write automated tests against the local dev server (see "Local Automated Tests" above)
npm test
```

### 5. Deploy

```bash
cef deploy --dry-run          # Preview what will happen
cef deploy                    # Deploy all entities
cef deploy status             # Verify everything is up-to-date
```

### 6. Iterate

Modify handlers or config. Use `cef dev` for local testing. Run `cef deploy` to push changes (existing IDs trigger updates, not creates). Run `cef deploy status` to verify.

### 7. Debug deployed service

```bash
cef deploy status                                              # Check entity states
cef playground test --agent "My Agent" --list-tools            # Verify tools exist
cef playground test --agent "My Agent" --tool task --args '{}' # Test specific task
```

### 8. Share with team

```bash
cef deploy clone --pubkey 0x... --output-dir ./cloned-service
```

### 9. Tear down

```bash
cef deploy delete              # Delete all in reverse dependency order
# Or selective cleanup:
cef deploy delete --only deployment
cef deploy delete --only stream
```

## Related Skills

- **coding**: Handler signature, runtime API, entity hierarchy, orchestration patterns, topology generation
- **inference**: ML model catalog and calling patterns
- **storage**: Storage API and state management
