# Wallets — Authentication & Signing

All SDK operations require a signed wallet. The SDK supports three wallet types.

---

## Wallet Types

### 1. URI Signer (dev/testing)

```typescript
import { ClientSdk } from '@cef-ai/client-sdk';

const sdk = new ClientSdk({
  url: 'https://cluster.cere.network',
  context: { agent_service: '...', workspace: '...', stream: '...' },
  wallet: '//Alice',  // or '//Bob', '//Charlie', etc.
});
```

Uses `@cere-activity-sdk/signers` `UriSigner`. Good for local dev and tests.

### 2. JSON Signer (programmatic)

```typescript
import { JsonSigner } from '@cere-activity-sdk/signers';

const signer = new JsonSigner({
  publicKey: '0x...',
  sign: async (message) => { /* return hex signature */ },
  signRawBytes: async (bytes) => { /* return hex signature */ },
});

const sdk = new ClientSdk({
  // ...
  wallet: signer,
});
```

### 3. Embed Wallet (browser)

```typescript
import { EmbedWallet } from '@cere/embed-wallet';

const embedWallet = new EmbedWallet({ /* config */ });
await embedWallet.connect();

const sdk = new ClientSdk({
  // ...
  wallet: embedWallet,
});
```

Uses `CereWalletSigner` internally.

---

## Signing Methods

| Operation | Signing Method | What's Signed |
|-----------|---------------|---------------|
| Events | `wallet.sign(hex)` | `0x` + Blake2b-256(id + event_type + timestamp) |
| Agreements | `wallet.signRawBytes(bytes)` | Raw JSON payload bytes (Ed25519) |
| Stream handshake | `wallet.sign(hex)` | Blake2b-256(stream_id + type + version) |

**Important:** GAR agreements require `signRawBytes()`. If your wallet only has `sign()`, you need an adapter or a different signer for agreement operations.
