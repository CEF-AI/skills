# Streams API

Streams are event channels for publishing and subscribing to typed events within an agent service.

---

## Subscribe

```typescript
interface CEFStreamPacket {
  payload: Uint8Array;  // use TextDecoder to decode
}

interface CEFStreamsClient {
  subscribe(streamId: string): Promise<AsyncIterable<CEFStreamPacket>>;
}
```

### Usage

```typescript
const stream = await context.streams.subscribe('my-stream-id');

for await (const packet of stream) {
  const text = new TextDecoder().decode(packet.payload);
  const event = JSON.parse(text);
  // handle event...
}
```

---

## Event Types (convention)

Events are JSON payloads published to streams. Use `event_type` to dispatch:

```typescript
interface StreamEvent {
  event_type: string;
  [key: string]: unknown;
}
```

### Common event types

| Event Type | Description | Triggered By |
|-----------|-------------|-------------|
| `PAGE_CHANGE` | Wiki page edited | External webhook / RAFT |
| `BATCH_EVAL` | Trigger batch re-evaluation | Manual / cron |
| `EVAL_COMPLETE` | Agent finished evaluating | Eval handler via `context.emit()` |
| `HUMAN_FEEDBACK` | Human scored an answer | Feedback UI |

### Event payload examples

```typescript
// PAGE_CHANGE
{
  event_type: 'PAGE_CHANGE',
  page_id: 'notion-page-abc',
  page_title: 'DDC Overview',
  content: '# DDC Overview\n...',
  edited_by: 'brent',
  source_timestamp: '2026-02-17T10:00:00Z',
}

// EVAL_COMPLETE
{
  event_type: 'EVAL_COMPLETE',
  agent_id: 'gemini',
  trigger: 'd_abc123',
  faqs_evaluated: 5,
  avg_quality: 0.82,
  duration_ms: 3400,
}
```

---

## Emit (Observability)

```typescript
// Only available if context.emit exists (not always in production)
if (context.emit) {
  context.emit('EVAL_COMPLETE', {
    event_type: 'EVAL_COMPLETE',
    agent_id: agentId,
    faqs_evaluated: results.length,
  });
}
```

**Note:** `context.emit()` is documented but not verified in production. Always guard with `if (context.emit)`.
