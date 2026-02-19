# Client SDK — Connecting to Agent Services

Package: `@cef-ai/client-sdk` (npm)

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
  eventRuntimeUrl: 'https://event.cere.net',   // Optional: override event runtime
  agentRuntimeUrl: 'https://agent.cere.net',   // Optional: override agent runtime
  sisUrl: 'https://sis.cere.net',              // Optional: override SIS
  webTransportUrl: 'https://cluster:4433',     // Optional: override WebTransport
  // ...
});
```

If not provided, all URLs default to `{url}/event`, `{url}/agent`, `{url}/sis`, `{url}:4433`.

**Note (v0.0.6):** There's no `garUrl` in the published SDK. If GAR runs on a different URL than the agent runtime, use an nginx proxy to split `/api/v1/agreements` → GAR and everything else → agent runtime.
