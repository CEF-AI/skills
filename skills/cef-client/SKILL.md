---
name: cef-client
description: Use when writing the browser-side code for a CEF vault agent — wallet connect, vault initialization, publishing events to an agent, reading results from a cubby. Triggers include "how do I connect the Cere wallet", "vault.cubbies.query returns 404", "JWK 503 on wallet connect", "what does `target` look like in vault.events.publish", "how does my web app know when the agent is done", "do I need to claim the vault from the browser", "signRawBytes is not a function". Use alongside the `cef-agent` skill.
---

# Browser Companion for a CEF Vault Agent

The browser companion is the part of a CEF app that has the user. It does five things, in order:

1. Connect a Cere wallet (the user's identity + signer).
2. Initialize the Vault SDK.
3. Get the user's vault and ensure a scope exists.
4. Publish events targeted at the agent.
5. Poll the agent's cubby for results.

This skill is the recipe for those five. The agent itself is covered in the `cef-agent` skill.

## The two packages

| Package | What it does |
|-|-|
| `@cere/embed-wallet` | The user-facing wallet (iframe modal, OAuth-style connect, signing). Provides the `EmbedWallet` class. |
| `@cef-ai/client-sdk` | The Vault SDK. Provides `Vault`, `CereWalletSigner`, `VaultRecord`, `VaultRequestError`. |

You also need `vite` (or any bundler) and TypeScript.

## The `walletAppId` gotcha

`walletAppId` must be **pre-registered with Cere**. An unregistered ID produces a **JWK 503** on first connect and the wallet modal never appears. Known-good IDs in the codebase: `cef-conv-recorder`, `date-coach`. To use your own ID, get it registered with the platform team before shipping.

If the modal silently refuses to open and the network tab shows a 503 on a `.well-known/jwks.json` request: this is the cause.

## Env vars

```bash
VITE_WALLET_ENV=dev                       # dev | stage | prod (drives wallet host + vault URL)
VITE_WALLET_APP_ID=date-coach             # pre-registered ID — see above
VITE_AGENT_SERVICE_PUBKEY=<from ROB>      # the agent service pubkey, 64 hex chars
VITE_AGENT_ID=<pubkey>:my-agent           # full target string: <pubkey>:<config.id>
VITE_CUBBY_ALIAS=my_cubby                 # matches agent's cef.config.ts `cubbies[].alias`
VITE_SCOPE_NAME=default                   # usually 'default'
```

You do **not** need a separate vault URL or RPC URL env var. The vault URL is derived from `VITE_WALLET_ENV`:

```ts
const VAULT_URLS = {
  dev:   'https://vault-api.compute.dev.ddcdragon.com',
  stage: 'https://vault-api.compute.stage.ddcdragon.com',
  prod:  'https://vault-api.compute.ddcdragon.com',
} as const;
const vaultUrl = VAULT_URLS[CONFIG.walletEnv];
```

## The whole connect flow

This is the single most failure-prone block in any CEF browser app. Copy it as-is and adjust:

```ts
import { EmbedWallet } from '@cere/embed-wallet';
import { Vault, CereWalletSigner, type VaultRecord, VaultRequestError } from '@cef-ai/client-sdk';

const PERMISSIONS = {
  ed25519_signRaw: {
    title: 'Sign API request',
    description: 'Allow this app to publish events to your vault.',
  },
} as const;

const embedWallet = new EmbedWallet({
  appId: CONFIG.walletAppId,
  env: CONFIG.walletEnv,
});
await embedWallet.init({
  popupMode: 'modal',
  connectOptions: { permissions: PERMISSIONS },
});
await embedWallet.connect();

// User can deny permissions — check and re-request.
const granted = await embedWallet.getPermissions().catch(() => []);
const hasPermission = granted.some((p) => p.parentCapability === 'ed25519_signRaw');
if (!hasPermission) await embedWallet.requestPermissions(PERMISSIONS);

const signer = new CereWalletSigner(embedWallet);
await signer.isReady();

// CRITICAL: the SDK calls signRawBytes(Uint8Array) but CereWalletSigner.sign()
// takes a string. Without this shim every vault write fails.
const walletWithRawBytes = Object.assign(signer, {
  signRawBytes: async (bytes: Uint8Array) =>
    signer.sign(new TextDecoder().decode(bytes)),
});

const vault = new Vault({ url: vaultUrl, wallet: walletWithRawBytes as any });

// User must have claimed a vault — happens automatically when they connect
// the agent in the marketplace. If 404, tell them to claim it there first.
let record: VaultRecord;
try {
  record = await vault.current();
} catch (e) {
  if (e instanceof VaultRequestError && e.status === 404) {
    showError('No vault found. Claim one by connecting an agent in the marketplace first.');
    return;
  }
  throw e;
}

// Create the scope — idempotent. 409 (exists) or 400 (already created) is fine.
try {
  await vault.scopes.create(record.vaultId, { name: CONFIG.scopeName });
} catch (e) {
  if (!(e instanceof VaultRequestError && (e.status === 409 || e.status === 400))) throw e;
}
```

Things people skip and regret:

- **The `signRawBytes` shim.** Without it, `vault.events.publish` and `vault.scopes.create` both fail. The error is opaque ("signRawBytes is not a function"). Add the shim.
- **`signer.isReady()`.** If you construct `Vault` before the signer is ready, the first request races and may sign with an undefined key.
- **Catching scope-create 409/400.** First user works fine. Second-time-same-user crashes. Make it idempotent.
- **Handling `vault.current()` 404.** A user who has never connected the agent in the marketplace has no vault. Don't crash; tell them what to do.

## Publishing an event

```ts
await vault.events.publish(record.vaultId, CONFIG.scopeName, [{
  type: 'image_uploaded',
  role: 'user',
  scope: CONFIG.scopeName,
  context: conversationId ?? 'default',     // routing/correlation key
  target: CONFIG.agentId,                   // '<pubkey>:my-agent' — full string
  payload: { conversationId, image_url },
  timestamp: new Date().toISOString(),
}]);
```

Notes:

- `vault.events.publish(vaultId, scopeName, eventArray)` — three positional args. The events are always an array, even for a single event.
- `target` is the single string `<servicePubkey>:<agent.config.id>` — not a structured object. The pubkey is the *agent service* pubkey from ROB, not the user's wallet address.
- `role` is always `'user'` from the browser. (Agents publishing events use `'system'`.)
- `context` is your correlation key. The agent reads it as `event.context` and is the standard way to isolate per-conversation/session data within an agent.

## Reading the cubby — the raw-HTTP workaround

The SDK exposes `vault.cubbies.query()` but **it returns 404 on devnet** (unimplemented or routed wrong). The working path is raw HTTP through the Vault's internal HTTP client:

```ts
const path = `/api/v1/vaults/${record.vaultId}/scopes/${CONFIG.scopeName}/agents/${CONFIG.agentId}/cubbies/${CONFIG.cubbyAlias}/query`;

const json = await (vault as any).http.request('POST', path, {
  body: {
    sql: 'SELECT result FROM rows WHERE id = ? LIMIT 1',
    params: [conversationId],
  },
}) as { columns: string[]; rows: unknown[][] };

if (json.rows.length > 0) {
  const value = json.rows[0][0];   // first column of first row
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  // use parsed
}
```

The `(vault as any).http` cast is unfortunate but necessary — `http` is internal. Drop it the day `vault.cubbies.query()` works.

## Polling, not subscribing

There is no `vault.cubbies.subscribe()` or websocket. Polling is the model.

```ts
async function pollResults(convId: string, attempt = 0): Promise<void> {
  if (attempt > 60) { showError('Timed out.'); return; }
  try {
    const result = await queryCubby(convId);
    if (result?.status === 'complete') { render(result); return; }
  } catch { /* keep polling */ }
  setTimeout(() => pollResults(convId, attempt + 1), 3000);
}
```

`setTimeout` works fine here — this is browser code, not the V8 isolate. Every 2-3 seconds, hard stop at 1-3 minutes total, surface a timeout message if you hit it.

If the agent does async upstream work (transcription, batch inference), the agent may not write the cubby row until well after the client publishes the event. The standard pattern is:

1. Client publishes per-chunk events as they arrive.
2. Client stops, waits ~25 seconds for in-flight work to land, then publishes a final `*.complete` event.
3. Client starts polling. Agent's `*.complete` handler reads what landed, finalizes, writes the result.
4. Client's poll sees `status: 'complete'` and renders.

The 25-second wait is sized to upstream provider latency; cef-voice-example's value is a good starting point.

## Binary upload — never from the agent

The agent runs in a V8 isolate and **cannot send binary HTTP request bodies** (no multipart, no `Blob`). If your event involves bytes (audio, images), the browser must upload first:

```ts
// Upload to a binary-friendly endpoint (e.g. AssemblyAI's /v2/upload).
const res = await fetch('https://api.assemblyai.com/v2/upload', {
  method: 'POST',
  headers: { Authorization: CONFIG.assemblyAiKey, 'Content-Type': 'application/octet-stream' },
  body: blob,
});
const { upload_url } = await res.json();

// Publish only the URL — the agent will ctx.fetch() it.
await publishEvent('audio_chunk', { conversationId, segmentIndex, audio_url: upload_url });
```

The agent then does `await ctx.fetch(upload_url)` to read the bytes — that works because it's a GET with no body. Any binary destination you control is fine; AssemblyAI's upload endpoint is a convenient temporary store but not required.

## Reference clients

- `cef-voice-example/src/main.ts` — the canonical template. Wallet, vault, recording, AssemblyAI upload, vault publish, cubby polling, render.
- `date-coach/src/main.ts` — same template + a pre-record context form and a 7-section report renderer.
- `chat-agent/ui/src/chat-client.ts` — minimal headless transport; useful if you want to separate the SDK plumbing from your UI framework.

When in doubt, copy from these.

## Common mistakes

| Symptom | Cause | Fix |
|-|-|-|
| JWK 503 on `embedWallet.init()` | `walletAppId` not registered with Cere | Use a known-good ID (`cef-conv-recorder`, `date-coach`) or get yours registered |
| `signRawBytes is not a function` | Missing the `Object.assign` shim | Add the shim before `new Vault({...})` |
| `vault.events.publish` 401 / silently no-op | User denied `ed25519_signRaw` | Check `getPermissions()`, `requestPermissions()` if missing |
| `vault.current()` throws 404 | User hasn't connected the agent in marketplace | Show: "Claim your vault by connecting an agent in the marketplace first" |
| `vault.scopes.create()` throws 409/400 every time | Not catching idempotent failures | Wrap in try/catch, swallow 409 and 400 |
| `vault.cubbies.query()` returns 404 | SDK method broken on devnet | Use `vault.http.request('POST', path, { body })` directly |
| Agent never receives the event | Wrong `target` format | Must be `<servicePubkey>:<agent.config.id>` — single string, full pubkey |
| Polling never finds the row | Agent wrote to a different cubby alias or used `event.context` and you didn't | Match `cubbyAlias` to agent's `cef.config.ts`; filter by the same key the agent uses |
| Upload works in browser but agent fails to fetch | Forgot to add the upload host to agent's `fetch.allow` | Add the host (e.g. `https://cdn.assemblyai.com`) to `fetch.allow` |
| Wallet modal flashes and closes immediately | User denied connect or popup blocker | Catch, re-enable the connect button, show a retry message |
