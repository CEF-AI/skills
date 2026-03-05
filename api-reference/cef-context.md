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
  agents: CEFAgentClient;             // dynamic proxy for agent-to-agent calls
  streams: CEFStreamsClient;
  fetch(url: string, options?: CEFFetchOptions): Promise<CEFFetchResponse>;
  path?: { agentServicePubKey: string; workspaceId: string };
}
```

### Production Status

| Method | Status | Notes |
|--------|--------|-------|
| `context.log(msg)` | ✅ Verified | Single string arg |
| `context.cubby(name)` | ✅ Verified | Factory → instance |
| `context.agents.<name>.<method>` | ✅ Verified | Dot notation only (see agent-to-agent.md) |
| `context.fetch(url, opts)` | ✅ Verified | Standard Response |
| `context.streams.subscribe()` | ✅ Verified | Async iterable |

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
