# Events — Sending Events to Agent Services

Events are signed messages sent to the Event Runtime, which routes them to the appropriate agent handler.

---

## Sending an Event

```typescript
const result = await sdk.event.create('PAGE_CHANGE', {
  page_id: 'notion-abc',
  page_title: 'DDC Overview',
  content: '# DDC Overview\n...',
  edited_by: 'brent',
  source_timestamp: new Date().toISOString(),
});
```

### What happens under the hood

1. SDK builds a payload with `event_type`, `context_path`, and your data
2. Creates a unique event ID (UUID v4)
3. Signs a canonical message: `Blake2b-256(id + event_type + timestamp)` using your wallet
4. POSTs to `{eventRuntimeUrl}/api/v1/events`

### Request body (sent to Event Runtime)

```json
{
  "id": "uuid-v4",
  "timestamp": "2026-02-17T10:00:00.000Z",
  "event_type": "PAGE_CHANGE",
  "context_path": {
    "agent_service": "pub-key",
    "workspace": "workspace-id",
    "stream": "stream-id"
  },
  "payload": { ... },
  "account_id": "user-pub-key",
  "app_id": "agent-service-pub-key",
  "signature": "0x..."
}
```

### Event Types

Use descriptive `UPPER_SNAKE_CASE` names:
- `PAGE_CHANGE` — content was edited
- `BATCH_EVAL` — trigger batch processing
- `HUMAN_FEEDBACK` — human reviewed something
- Custom: any string your handlers expect

---

## Signature Verification

The Event Runtime verifies the Blake2b-256 signature against the sender's public key. Events with invalid signatures are rejected.

Supported wallet types:
- `UriSigner` — from a URI string (e.g. `'//Alice'`)
- `JsonSigner` — from a JSON key file
- `CereWalletSigner` — from `@cere/embed-wallet`
