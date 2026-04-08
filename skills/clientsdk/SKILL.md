---
name: cef-client-sdk
description: Use when connecting external code (GitHub Actions, backends, scripts, demos) to CEF agent services via @cef-ai/client-sdk. Covers SDK setup, wallet/signer configuration, agreement creation, sending events, querying cubbies, subscribing to streams, and publishing data.
---

# CEF Client SDK

The `@cef-ai/client-sdk` connects external code to CEF agent services. Use it in GitHub Actions, backends, scripts, test harnesses, or demo UIs; anywhere outside the V8 isolate runtime. Standard imports are allowed here.

```bash
npm install @cef-ai/client-sdk
```

## Setup

Three things are needed: a `ClientContext` (where events go), a wallet/signer (authentication), and a `ClientSdk` instance.

```typescript
import { ClientContext, ClientSdk, JsonSigner } from "@cef-ai/client-sdk";

// 1. Context: maps to the CEF entity hierarchy
const context = new ClientContext({
    agentService: "0x...",       // Agent service public key (hex)
    workspace: "2456",           // Target workspace ID
    stream: "stream-f493c12e",   // Target stream ID
});

// 2. Wallet: JsonSigner from an exported Cere Wallet keystore
const signer = new JsonSigner(walletJson, { passphrase: "your-passphrase" });
await signer.isReady();

const wallet = {
    get publicKey() { return signer.publicKey; },
    sign: signer.sign.bind(signer),
    signRawBytes: (bytes) => signer.sign(bytes),
};

// 3. SDK instance
const client = new ClientSdk({
    url: "https://compute-1.devnet.ddc-dragon.com",
    garUrl: "https://gar.compute.dev.ddcdragon.com/",  // GAR endpoint for agreements
    context,
    wallet,
});
```

### Wallet Options

The SDK accepts several wallet types:

| Type | Use When |
|-|-|
| `JsonSigner` | You have an exported Cere Wallet JSON keystore (most common for scripts/actions) |
| `UriSigner` | You have a mnemonic string |
| `CereWalletSigner` | Browser-based Cere Wallet integration |
| Mnemonic string | Quick setup (passed directly as `wallet` config) |

**JsonSigner** requires wrapping with `signRawBytes` for agreement operations:

```typescript
const signer = new JsonSigner(walletJson, { passphrase: PASSPHRASE });
await signer.isReady();

const wallet = {
    get publicKey() { return signer.publicKey; },
    sign: signer.sign.bind(signer),
    signRawBytes: (bytes) => signer.sign(bytes),
};
```

**Mnemonic** (simpler, for quick scripts):

```typescript
const client = new ClientSdk({
    url: BASE_URL,
    context,
    wallet: "hybrid label reunion only dawn maze asset draft cousin height flock nation",
});
```

## Typical Flow: Agreement then Events

Most integrations follow this pattern: create an agreement (once), then send events. The agreement authorizes the wallet to interact with the agent service.

```typescript
const { ClientSdk, ClientContext, JsonSigner } = require("@cef-ai/client-sdk");

const AGENT_SERVICE = "0xc3d62ac...";
const BASE_URL = "https://compute-1.devnet.ddc-dragon.com";
const GAR_URL = "https://gar.compute.dev.ddcdragon.com/";
const STREAM_ID = "stream-f493c12e";
const WORKSPACE = "2456";

async function main() {
    const context = new ClientContext({
        agentService: AGENT_SERVICE,
        workspace: WORKSPACE,
        stream: STREAM_ID,
    });

    const signer = new JsonSigner(WALLET_JSON, { passphrase: WALLET_PASSPHRASE });
    await signer.isReady();

    const wallet = {
        get publicKey() { return signer.publicKey; },
        sign: signer.sign.bind(signer),
        signRawBytes: (bytes) => signer.sign(bytes),
    };

    const client = new ClientSdk({
        url: BASE_URL,
        garUrl: GAR_URL,
        context,
        wallet,
    });

    // Step 1: Create agreement (scoped to workspace + stream, 24h TTL)
    try {
        await client.agreement.create(AGENT_SERVICE, {
            metadata: {
                scopes: [{
                    context: {
                        workspace_id: WORKSPACE,
                        stream_id: STREAM_ID,
                    },
                }],
            },
        }, 86400);
        console.log("Agreement created (24h TTL)");
    } catch (err) {
        if (err.message && err.message.includes("409")) {
            console.log("Agreement already exists, continuing");
        } else {
            throw err;
        }
    }

    // Step 2: Send events
    for (let i = 0; i < 100; i++) {
        await client.event.create("event_11", { gameSession: gameData });
        await new Promise((r) => setTimeout(r, 200)); // throttle
    }
}
```

## Pattern: Send an Event

Trigger a job on the CEF stack. The event flows into the configured stream, hits selectors, and fires the bound engagement.

```typescript
await client.event.create("VIDEO_STREAM_DATA", {
    entityId: "drone_7",
    streamId: "stream_abc",
    image: base64ImageData,
});
```

The first argument is the event type string (matches selector conditions in the config). The second is the payload; any JSON-serializable object.

**Note:** A successful response means the event was accepted by the platform, not that the handler executed successfully. Handler errors are only visible in ROB Activity Logs. If you need to confirm handler execution, query the cubby for expected state changes after sending events.

## Agreement Management (GAR)

Agreements authorize a wallet to interact with an agent service. **Required before sending events or querying cubbies.** Agreements are scoped to specific workspaces and streams.

### Create (with scoped metadata)

```typescript
await client.agreement.create(AGENT_SERVICE_PUB_KEY, {
    metadata: {
        scopes: [{
            context: {
                workspace_id: "2456",
                stream_id: "stream-f493c12e",
            },
        }],
    },
}, 86400); // TTL in seconds (86400 = 24 hours)
```

### Handle Existing Agreements

Agreement creation returns 409 if one already exists. Handle it:

```typescript
try {
    await client.agreement.create(AGENT_SERVICE, { metadata: { scopes: [...] } }, 86400);
} catch (err) {
    if (err.message?.includes("409")) {
        // Already exists, safe to continue
    } else {
        throw err;
    }
}
```

### Agreement Expiry (24h TTL)

Agreements expire after their TTL (default 24 hours). Long-running ingest jobs that span multiple hours will fail when the agreement expires. The error message is `"No agreement exists between user and agent service"` but it may not surface clearly if errors are being swallowed.

**Reset pattern for long-running ingests:**

```typescript
let clientReady = false;

async function ensureAgreement(client: ClientSdk) {
    if (clientReady) return;
    try {
        await client.agreement.create(AGENT_SERVICE, {
            metadata: {
                scopes: [{
                    context: { workspace_id: WORKSPACE, stream_id: STREAM_ID },
                }],
            },
        }, 86400);
    } catch (err) {
        if (!err.message?.includes("409")) throw err;
    }
    clientReady = true;
}

async function sendEvent(client: ClientSdk, eventType: string, payload: unknown) {
    try {
        await client.event.create(eventType, payload);
    } catch (err) {
        if (err.message?.includes("No agreement exists")) {
            clientReady = false;
            await ensureAgreement(client);
            await client.event.create(eventType, payload);
        } else {
            throw err;
        }
    }
}
```

### Update and Revoke

```typescript
await client.agreement.update(AGENT_SERVICE, { metadata: { scopes: [...] } });
await client.agreement.revoke(AGENT_SERVICE);
```

## Pattern: Query a Cubby

Read data from a cubby using named queries or raw SQL.

```typescript
// Named query (defined in cubby config)
const result = await client.query.fetch("detections", "getLatest", { limit: 10 });

// Raw SQL
const result = await client.query.sql(
    "SELECT * FROM activity WHERE drone_id = ? ORDER BY ts DESC LIMIT ?",
    ["drone_7", 10]
);
```

Optional timeout (default varies by cluster):

```typescript
const result = await client.query.fetch("detections", "getAll", {}, 30000);
```

## Pattern: Subscribe to a Stream

Receive real-time data from a CEF stream via WebTransport.

```typescript
const controller = client.stream.subscribe("stream_id", (data, error) => {
    if (error) {
        console.error("Stream error:", error);
        return;
    }
    console.log("Received:", data);
});

// Later: stop listening
controller.abort();
```

## Pattern: Publish to a Stream

Push data into a CEF stream from external code. The backend handler subscribes to this stream via `context.streams.subscribe(streamId)` and iterates packets with `for await`.

```typescript
// 1. Create stream
const stream = await client.stream.create();

// 2. Get publisher
const publisher = await client.stream.publisher(stream.id);

// 3. Send data packets
await publisher.send({ message: { type: "SENSOR_DATA", temperature: 22.5 } });

// 4. Signal completion
await publisher.send({ message: { type: "COMPLETE" } });

// 5. Close publisher
await publisher.close();
```

Or publish to an existing stream:

```typescript
const publisher = await client.stream.publisher("existing_stream_id");
await publisher.send({ message: { type: "IMAGE_DATA", image: base64Data } });
await publisher.close();
```

### When to Use Events vs Streams

Both `client.event.create()` and `client.stream.publisher().send()` deliver data to backend handlers, but they serve different purposes:

- **Events** (`client.event.create()`): for discrete, one-shot signals. Data arrives in `event.payload` on the handler. Good for triggers, lifecycle signals, small payloads.
- **Streams** (`client.stream.publisher().send()`): for continuous data after a trigger. Data arrives as raw packets; the handler must call `context.streams.subscribe(streamId)` and iterate with `for await`. Good for audio chunks, sensor feeds, game telemetry, or any high-frequency data.

Use events alone when the payload is self-contained. Use events + streams when you need to trigger processing and then continuously feed data.

### Full-Stack Pattern: Event Trigger + Stream Data

This is the proven pattern from the gaming demo and conversation agent. The client sends a trigger event containing the `streamId`, then publishes continuous data to that stream. The handler receives the event, subscribes to the stream, and processes packets until completion.

```typescript
// Client side: create stream, trigger handler, then publish data
const stream = await client.stream.create();
const publisher = await client.stream.publisher(stream.id);

// Trigger event tells the handler which stream to subscribe to
await client.event.create("start_processing", {
    streamId: stream.id,
    entityId: "user-123",
});

// Continuous data goes through the stream
for (const chunk of dataChunks) {
    await publisher.send({ message: { type: "DATA_CHUNK", data: chunk } });
}
await publisher.send({ message: { type: "COMPLETE" } });
await publisher.close();
```

```typescript
// Handler side: receive trigger event, subscribe to stream, process packets
async function handle(event: any, context: any) {
    const { streamId, entityId } = event.payload;

    const stream = await context.streams.subscribe(streamId);
    for await (const packet of stream) {
        const data = JSON.parse(bytesToString(packet.payload));
        if (data.type === 'DATA_CHUNK') {
            // process data.data
        }
        if (data.type === 'COMPLETE') break;
    }
    // finalize after stream ends
}
```

**Common mistake:** putting continuous data (audio chunks, frames) into repeated `client.event.create()` calls instead of using a stream. Events work for this technically, but streams are designed for it: they use WebTransport/QUIC, handle backpressure, and the handler can process packets as they arrive in a `for await` loop. Conversely, if the handler expects stream packets via `context.streams.subscribe()`, sending that data via `client.event.create()` will not reach the subscription loop.

## Error Handling

The SDK throws typed errors:

| Error | When |
|-|-|
| `EventRequestError` | Event creation fails |
| `CubbyRequestError` | Cubby query fails |
| `CubbyTimeoutError` | Cubby query exceeds timeout |
| `AgreementAlreadyExistsError` | Creating a duplicate agreement (409) |
| `AgreementNotFoundError` | Updating/revoking a missing agreement (404) |
| `AgreementConflictError` | Stale timestamp replay (409) |
| `GarSignerRequiredError` | Wallet missing `signRawBytes` |
| `GarInvalidTtlError` | Invalid TTL value |

```typescript
import { CubbyTimeoutError } from "@cef-ai/client-sdk";

try {
    const result = await client.query.sql("SELECT * FROM large_table");
} catch (err) {
    if (err instanceof CubbyTimeoutError) {
        const result = await client.query.sql("SELECT * FROM large_table", [], 60000);
    }
}
```

## Key Types

```typescript
interface ClientConfig {
    url: string;                    // Cluster URL
    garUrl?: string;                // GAR endpoint (required for agreements)
    context: ClientContext;         // Agent service + workspace + stream
    wallet: SignedWallet | EmbedWallet;
    webTransport?: { ... };        // Optional WebTransport config
}

interface ContextInput {
    agentService: string;           // Hex public key
    workspace: string;              // Workspace ID
    stream: string;                 // Stream ID
}

type ActivityEventPayload = Record<string, unknown>;
type SignedWallet = JsonSigner | UriSigner | CereWalletSigner;
```

## Related Skills

- **coding**: Handler signature, CEFContext, orchestration patterns, topology generation. **See Streams API section for how handlers subscribe to streams published from client SDK.**
- **cli**: Config schema, deploy commands
- **storage**: Cubby schema and migration config (queried from client SDK)
