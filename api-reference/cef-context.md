# CEF Context & Event API

Source: Production validation against Game-Demo-Agent-Service (14 agents)

---

## Handler Signature

Every CEF agent exports a single `handle` function:

```typescript
export type CEFHandlerFn<TResult = unknown> = (
  event: CEFEvent,
  context: CEFContext,
) => Promise<TResult>;
```

The Agent Runtime (A9) injects `context` into V8 isolates at execution time.

---

## CEFEvent

```typescript
interface CEFEvent {
  payload: Record<string, unknown>;   // agent destructures this
  id?: string;
  event_type?: string;
  app_id?: string;                    // agent service pub key
  account_id?: string;
  timestamp?: string;                 // ISO 8601
  signature?: string;
  context_path?: {
    agent_service: string;
    workspace: string;
    stream?: string;
  };
}
```

---

## CEFContext

```typescript
interface CEFContext {
  log(...args: unknown[]): void;
  cubby(name: string): CEFCubbyInstance;
  kv: CEFKVClient;                    // RAFT KV (Redis-style)
  agents: CEFAgentClient;             // dynamic proxy for agent-to-agent calls
  streams: CEFStreamsClient;
  fetch(url: string, options?: CEFFetchOptions): Promise<CEFFetchResponse>;
  emit?(eventType: string, payload: Record<string, unknown>, targetId?: string): void;
  models?: CEFModelClient;            // NOT in production — use fetch() instead
  storage?: CEFStorageClient;         // NOT in production
  path?: { agentServicePubKey: string; workspaceId: string };
}
```

### Production Status

| Method | Status | Notes |
|--------|--------|-------|
| `context.log(msg)` | ✅ Verified | Single string arg |
| `context.cubby(name)` | ✅ Verified | Factory → instance |
| `context.kv.*` | ✅ Verified | Redis-style operations |
| `context.agents.<name>.<method>` | ✅ Verified | Dynamic proxy |
| `context.fetch(url, opts)` | ✅ Verified | Standard Response |
| `context.streams.subscribe()` | ✅ Verified | Async iterable |
| `context.emit()` | ⚠️ Documented only | Not observed in prod |
| `context.models.infer()` | ⚠️ Documented only | Agents use fetch() |
| `context.storage.*` | ⚠️ Documented only | Not observed in prod |

---

## Fetch API

```typescript
interface CEFFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface CEFFetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
  headers?: Record<string, string>;
}
```

### Inference via fetch (production pattern)

```typescript
const response = await context.fetch(INFERENCE_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 4096,
  }),
});
if (!response.ok) throw new Error(`Inference failed: ${response.status}`);
const result = await response.json();
```

**Why not `context.models`?** It's documented but not available in production. All production agents use `context.fetch()` to call inference endpoints directly.

---

## RAFT KV (Redis-style)

```typescript
interface CEFKVClient {
  hset(key: string, fields: Record<string, string>): Promise<void>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  rpush(key: string, value: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  incr(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
```

Use for RAFT indexer data (category indices, delta lists). For structured domain data, prefer Cubby JSON store.
