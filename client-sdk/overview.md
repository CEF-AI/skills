# Client SDK — Connecting to Agent Services

Package: `@cef-ai/client-sdk` v0.0.9 (npm)

The client SDK is for **external applications** that connect to CEF agent services — sending events, subscribing to streams, managing agreements, and querying cubbies.

This is the **consumer side**. The handler code inside agents uses `CEFContext` (see `api-reference/`). The client SDK is what your frontend, CLI, or external service uses to talk to the agent service.

---

## Installation

```bash
npm install @cef-ai/client-sdk
```

---

## Quick Start

```typescript
import { ClientSdk, ClientContext } from '@cef-ai/client-sdk';

const sdk = new ClientSdk({
  url: 'https://your-cluster.cere.network',
  garUrl: 'https://your-gar-service.cere.network', // required for agreement operations
  context: {
    agent_service: 'your-agent-service-pub-key',
    workspace: 'your-workspace-id',
    stream: 'your-stream-id',
  },
  wallet: '//Alice', // URI signer, or JsonSigner, or EmbedWallet
});
```

---

## SDK Capabilities

| Feature | Method | Description |
|---------|--------|-------------|
| **Events** | `sdk.event.create()` | Send signed events to the event runtime |
| **Streams** | `sdk.stream.create()` | Create SIS data streams |
| | `sdk.stream.subscribe()` | Subscribe to stream packets |
| | `sdk.stream.publisher()` | Get a publisher for a stream |
| **Agreements** | `sdk.agreement.create()` | Create GAR agreement (required before using services) |
| | `sdk.agreement.update()` | Update agreement metadata/TTL |
| | `sdk.agreement.revoke()` | Revoke agreement |
| **Queries** | `sdk.query.fetch()` | Query cubby data via named queries |

---

## URL Configuration

```typescript
const sdk = new ClientSdk({
  url: 'https://cluster.cere.network',        // Base cluster URL
  garUrl: 'https://gar.cere.network',         // GAR service URL (required for agreements)
  eventRuntimeUrl: 'https://event.cere.net',   // Optional: override event runtime
  agentRuntimeUrl: 'https://agent.cere.net',   // Optional: override agent runtime
  sisUrl: 'https://sis.cere.net',              // Optional: override SIS
  webTransportUrl: 'https://cluster:4433',     // Optional: override WebTransport
  // ...
});
```

If not provided, URLs default to `{url}/event`, `{url}/agent`, `{url}/sis`, `{url}:4433`.

**`garUrl` is required for agreement operations.** Since v0.0.9, the SDK throws if you call `agreement.create/update/revoke` without setting `garUrl`. GAR is a separate service from the agent runtime — no nginx proxy workaround needed anymore.
