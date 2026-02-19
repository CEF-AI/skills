# Streams — SIS (Stream Ingestion Service)

The SIS provides real-time data streaming via WebTransport (QUIC). Create streams, publish packets, subscribe to live data.

---

## Create a Stream

```typescript
const stream = await sdk.stream.create();
// Returns: { id: 'stream-id' }
```

Creates a stream linked to the SDK's `context_path` (agent service + workspace + stream).

Options (passed to SIS):
- `metadata` — custom key-value pairs
- `ttlSeconds` — time-to-live (default: 24h = 86400)

---

## Subscribe to a Stream

```typescript
const abortController = sdk.stream.subscribe(
  'stream-id',
  (data, error) => {
    if (error) {
      console.error('Stream error:', error);
      return;
    }
    console.log('Headers:', data.headers);
    console.log('Data:', data.data);  // auto-parsed (JSON or text)
  },
);

// Later: stop subscribing
abortController.abort();
```

### Packet parsing
- `application/json` or `application/octet-stream` → auto-parsed as JSON
- `text/*` → decoded as UTF-8 string
- Other → raw `Uint8Array`

---

## Publish to a Stream

```typescript
const publisher = await sdk.stream.publisher('stream-id');
// Use publisher to send packets (WebTransport bidirectional stream)
```

### Handshake authentication
Publishing requires a signed handshake:
- Signs: `Blake2b-256(stream_id + type + version)`
- Sends: `pub_key` + `signature` in handshake request

---

## Unsubscribe

```typescript
// Single stream
sdk.stream.unsubscribe('stream-id');

// All streams
sdk.stream.unsubscribeAll();
```

---

## Stream Metadata

```typescript
const stream = await sdk.stream.get('stream-id');
// Returns DataStream: id, context_path, publisher_address, status, sequence_number, etc.
```

---

## SIS Protocol Details

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_PACKET_SIZE` | 10 MB | Maximum packet payload |
| `MAX_HEADERS_SIZE` | 64 KB | Maximum header size |
| `MAX_STREAM_ID_LENGTH` | 256 bytes | Maximum stream ID length |
| `HANDSHAKE_VERSION` | 1 | Current protocol version |

### Subscription options

```typescript
{
  offset?: number;              // Start from offset (undefined = live)
  autoReconnect?: boolean;      // Default: true
  maxReconnectAttempts?: number; // 0 = unlimited
  reconnectBaseDelay?: number;  // Default: 100ms
  reconnectMaxDelay?: number;   // Default: 30000ms
  onError?: (error) => boolean; // Return false to stop reconnecting
  onReconnect?: (attempt, lastOffset) => void;
}
```
