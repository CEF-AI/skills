# Cubby API

Cubbies are SQLite databases managed by the Orchestrator that give agents persistent, queryable storage. Each cubby is defined at the Agent Service level with a schema (migrations) and can have multiple independent instances. Agents interact with cubbies through `ctx.cubbies.{alias}` in their handler code.

---

## Agent API

When an agent executes, the Agent Runtime fetches cubby definitions for the Agent Service and exposes them on `ctx.cubbies` keyed by alias.

### query() -- Read

```typescript
ctx.cubbies.{alias}.query(instanceId, sql, params?)  -> Promise<QueryResult>
```

```typescript
// Explicit instance
const result = await ctx.cubbies.mission_report.query(
    'mission_42',
    'SELECT drone_id, action FROM activity WHERE drone_id = ?',
    ['drone_7']
);
// result.columns = ['drone_id', 'action']
// result.rows = [['drone_7', 'takeoff'], ['drone_7', 'survey']]

// Default instance (instanceId = "default")
const count = await ctx.cubbies.mission_report.query('SELECT COUNT(*) as n FROM activity');
// count.rows = [[5]]
```

### exec() -- Write

```typescript
ctx.cubbies.{alias}.exec(instanceId, sql, params?)  -> Promise<ExecResult>
```

```typescript
// Explicit instance
const result = await ctx.cubbies.mission_report.exec(
    'mission_42',
    'INSERT INTO activity (drone_id, action, ts) VALUES (?, ?, ?)',
    ['drone_7', 'landing', '2026-03-24T12:00:00Z']
);
// result.rowsAffected = 1
// result.lastInsertId = 42

// Default instance
await ctx.cubbies.mission_report.exec(
    'INSERT INTO activity (drone_id, action) VALUES (?, ?)',
    ['drone_7', 'takeoff']
);
```

### Overloaded Signatures

The `instanceId` argument is optional. If the first string argument contains a space, it is treated as SQL and the instance defaults to `"default"`.

| Call Form | instanceId | sql | params |
|-|-|-|-|
| `query('SELECT ...')` | `"default"` | `SELECT ...` | `[]` |
| `query('SELECT ...', [1, 2])` | `"default"` | `SELECT ...` | `[1, 2]` |
| `query('inst_42', 'SELECT ...')` | `inst_42` | `SELECT ...` | `[]` |
| `query('inst_42', 'SELECT ...', [1])` | `inst_42` | `SELECT ...` | `[1]` |

The same overloading applies to `exec()`.

### Response Types

```typescript
interface QueryResult {
    columns: string[];
    rows: unknown[][];
    meta: { duration: number; rowsRead: number };
}

interface ExecResult {
    rowsAffected: number;
    lastInsertId: number;
    meta: { duration: number; rowsRead: number };
}
```

---

## Schema Migrations

Migrations define and evolve the database schema. Each migration has a version number and an `up` SQL script.

```json
{
  "migrations": [
    { "version": 1, "up": "CREATE TABLE notes (id INTEGER PRIMARY KEY, author TEXT, content TEXT)" },
    { "version": 2, "up": "ALTER TABLE notes ADD COLUMN created_at TEXT DEFAULT (datetime('now'))" }
  ]
}
```

### How Migrations Work

1. Every SQLite database contains a `schema_migrations` tracking table.
2. On each access, the Manager compares the highest applied version against the definition's max version.
3. Pending migrations run in version order, each in a transaction. If any fails, it rolls back.
4. Already-applied versions are skipped.

### Adding Migrations

Append new migrations with higher version numbers. Never modify or remove existing migrations.

```
Initial:  [v1: CREATE TABLE ...]
Updated:  [v1: CREATE TABLE ..., v2: ALTER TABLE ..., v3: CREATE INDEX ...]
```

---

## Cubby Instances

Instances are physical SQLite databases identified by a user-chosen `instanceId` string (e.g. `mission_42`, `user_123`, `default`).

Instances are created lazily on first access. When an agent queries an instance that doesn't exist yet, the Orchestrator creates the SQLite file, applies all migrations, and registers it.

Common patterns:
- **Per-entity isolation:** use a unique instanceId per entity (user, mission, session)
- **Shared state:** use `"default"` or omit instanceId for global data

---

## Vector Operations (sqlite-vec)

The SQLite engine includes the `sqlite-vec` extension for vector similarity search.

### Create a Vector Table

```typescript
await ctx.cubbies.embeddings.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_items
    USING vec0(embedding float[768], +id TEXT, +metadata TEXT)
`);
```

### Insert Embeddings

```typescript
await ctx.cubbies.embeddings.exec(
    'INSERT INTO vec_items (id, embedding, metadata) VALUES (?, ?, ?)',
    ['chunk_1', JSON.stringify(embeddingArray), JSON.stringify({ source: 'wiki' })]
);
```

### KNN Search

```typescript
const results = await ctx.cubbies.embeddings.query(
    `SELECT id, metadata, distance
     FROM vec_items
     WHERE embedding MATCH ?
     ORDER BY distance
     LIMIT ?`,
    [JSON.stringify(queryEmbedding), 5]
);
// results.rows = [['chunk_1', '{"source":"wiki"}', 0.05], ...]
```

### Cosine Distance

```typescript
const results = await ctx.cubbies.embeddings.query(
    `SELECT id, vec_distance_cosine(embedding, ?) as dist
     FROM vec_items
     ORDER BY dist
     LIMIT ?`,
    [JSON.stringify(queryEmbedding), 10]
);
```

---

## Config (cef.config.yaml)

```yaml
cubbies:
  - alias: "mission_report"
    name: "Mission Report"
    description: "Per-mission structured data"
    migrations:
      - version: 1
        up: "CREATE TABLE activity (id INTEGER PRIMARY KEY, drone_id TEXT, action TEXT, ts TEXT)"
      - version: 2
        up: "ALTER TABLE activity ADD COLUMN processed INTEGER DEFAULT 0"
    maxSizeBytes: 10737418240
    idleTimeout: "24h"
```

**Alias rules:** must be a valid JavaScript identifier (letters, digits, underscores; cannot start with a digit). Must be unique within the Agent Service.

---

## Management API

Base URL: `/api/v1/agent-services/:asPubKey/cubbies`

### Create Cubby

`POST /api/v1/agent-services/:asPubKey/cubbies`

```json
{
  "alias": "mission_report",
  "name": "Mission Report",
  "description": "Per-mission structured data",
  "migrations": [
    { "version": 1, "up": "CREATE TABLE activity (id INTEGER PRIMARY KEY, drone_id TEXT, action TEXT, ts TEXT)" }
  ],
  "maxSizeBytes": 10737418240,
  "idleTimeout": "24h"
}
```

Required fields: `alias`

Response (201):
```json
{
  "cubbyId": "cubby-a1b2c3d4",
  "agentServicePubKey": "0x1234abcd",
  "alias": "mission_report",
  "name": "Mission Report",
  "migrations": [...],
  "createdAt": "2026-03-24T10:00:00Z",
  "updatedAt": "2026-03-24T10:00:00Z"
}
```

### List / Get / Update / Delete

| Method | Path | Notes |
|-|-|-|
| `GET` | `.../cubbies` | List all cubby definitions |
| `GET` | `.../cubbies/:cubbyId` | Get one definition |
| `PUT` | `.../cubbies/:cubbyId` | Update; include full migrations array (existing + new) |
| `DELETE` | `.../cubbies/:cubbyId` | Delete definition; instance cleanup is separate |

---

## Data API

Base URL: `/api/v1/agent-services/:asPubKey/cubbies/:cubbyId`

### Query (Read)

`POST .../instances/:instanceId/query`

```json
{ "sql": "SELECT drone_id, action FROM activity WHERE drone_id = ?", "params": ["drone_7"] }
```

### Exec (Write)

`POST .../instances/:instanceId/exec`

```json
{ "sql": "INSERT INTO activity (drone_id, action) VALUES (?, ?)", "params": ["drone_7", "landing"] }
```

### Import (Upload SQLite File)

`POST .../instances/:instanceId/import` -- multipart/form-data with `file` field.

### Instance Management

| Method | Path | Description |
|-|-|-|
| `GET` | `.../instances` | List all instances |
| `GET` | `.../instances/:instanceId` | Get instance metadata |
| `DELETE` | `.../instances/:instanceId` | Delete instance |
| `GET` | `.../stats` | Aggregate stats across instances |

---

## Architecture

| Aspect | Detail |
|-|-|
| Storage engine | SQLite (WAL mode) with `sqlite-vec` extension |
| Connection pool | LRU with configurable max size |
| Write serialization | Per-instance mutex; writes serialized, reads concurrent |
| Quota enforcement | Per-definition `maxSizeBytes` override or global default |
| Instance registry | Redis-backed; tracks nodeId, schemaVersion, sizeBytes |
| Multi-node routing | Instance owned by creating node; requests proxied to owner |
| File path | `{dataDir}/{agentServicePubKey}/{cubbyId}/{instanceId}.db` |
| SQLite PRAGMAs | `journal_mode=WAL`, `cache_size=-64000`, `temp_store=MEMORY`, `busy_timeout=5000`, `synchronous=NORMAL` |

---

## Configuration (Orchestrator Environment)

| Variable | Default | Description |
|-|-|-|
| `CUBBY_DATA_DIR` | `/data/cubbies` | Root directory for SQLite files |
| `CUBBY_MAX_POOL_SIZE` | `5000` | Maximum open database connections |
| `CUBBY_MAX_INSTANCE_SIZE` | `10737418240` (10 GB) | Maximum size per instance |
| `CUBBY_HEARTBEAT_TTL` | `30s` | Node heartbeat expiration |
| `CUBBY_HEARTBEAT_INTERVAL` | `10s` | Heartbeat refresh interval |
| `CUBBY_DEFINITION_CACHE_TTL` | `30s` | How long definitions are cached |
| `CUBBY_REGISTRY_SYNC_INTERVAL` | `5s` | Registry sync frequency |
| `CUBBY_PROXY_TIMEOUT` | `30s` | Cross-node proxy timeout |

---

## Error Handling

| HTTP Status | Code | When |
|-|-|-|
| 400 | `INVALID_REQUEST` | Malformed request body |
| 400 | `VALIDATION_ERROR` | Missing `sql` field |
| 400 | `INVALID_ALIAS` | Alias is not a valid JS identifier |
| 404 | `RESOURCE_NOT_FOUND` | Cubby or instance not found |
| 409 | `ALIAS_CONFLICT` | Alias already exists in Agent Service |
| 413 | `QUOTA_EXCEEDED` | Write would exceed size limit |
| 500 | `QUERY_ERROR` / `EXEC_ERROR` | SQL execution failed |
| 500 | `ROUTING_ERROR` | Owner node unavailable |
| 502 | `PROXY_ERROR` | Cross-node proxy failed |
