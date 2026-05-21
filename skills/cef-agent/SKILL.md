---
name: cef-agent
description: Use when designing, writing, or debugging a CEF agent built on @cef-ai/agent-sdk that reacts to user vault events. Triggers include questions like "how do I structure the handler", "why does setTimeout fail in my agent", "where do I put my API key", "why is my republish ignored", "how do I send binary to the agent", "what's the difference between cubby per-user vs per-conversation", or starting a new project from cef-voice-example, chat-agent, or date-coach.
---

# CEF Vault Agent — Anatomy

A CEF vault agent is **code that runs in a V8 isolate on Cere's network, listens for events published to a user's vault, and reads/writes a per-agent SQLite cubby**. A browser companion (or any external client) publishes events and polls the cubby for results.

If you understand the seven mechanics below, every other CEF question is a detail.

## 1. The runtime: V8 isolate

The agent runs in a sandbox that exposes **only** `ctx.*` and standard ES (Promises, JSON, regex, async/await, basic globals). It does NOT have:

- `setTimeout` / `setInterval` — there is no sleep primitive at all
- Binary HTTP request bodies — `ctx.fetch` can send JSON, not multipart or `Blob`. If you need to upload bytes, do it **browser-side**, pass the resulting URL to the agent via the event payload, and have the agent `ctx.fetch(url)` to read it
- `FormData`, `AbortController`, `URL.createObjectURL`, `Buffer`, Node APIs
- Network access to anything outside `fetch.allow` in `cef.config.ts`

Imports in your `.ts` source are fine — the SDK builder bundles them. But never assume a runtime global; if it's not on `ctx`, it doesn't exist.

### Async without sleep — three legitimate patterns

Because there's no `setTimeout`, every "wait" pattern collapses into one of these. **Do not** busy-wait (`while (Date.now() < t) {}`) — it blocks the isolate and burns your execution budget. **Do not** use `ctx.fetch` to a noop endpoint as a sleep primitive — it's a hack that breaks the fetch allowlist contract.

**A. Polling an upstream job** (transcription, batch inference, anything that says "submit then poll"). The poll itself rate-limits. Each `ctx.fetch` round-trip is ~100-500ms; 40 iterations is naturally 4-20s. No explicit delay needed — the upstream's own latency is your spacer:

```ts
const id = (await submit()).id;
for (let i = 0; i < 40; i++) {
  const r = await ctx.fetch(`https://api.example.com/jobs/${id}`);
  const body = await r.json();
  if (body.status === "done") return body.result;
  if (body.status === "error") throw new Error(body.message);
}
throw new Error("timed out");
```

**B. Retrying on transient failure of a single endpoint.** Don't try to back off. Either: retry immediately up to N times (the remote will 429 you if it really matters), or fail the handler and rely on the *client* to republish the event. The agent runtime does not retry handlers for you — that's the client's job:

```ts
let lastErr;
for (let i = 0; i < 3; i++) {
  try { return await ctx.fetch(url, opts).then(r => r.json()); }
  catch (e) { lastErr = e; }    // immediate retry, no delay
}
throw lastErr;                   // surface; let the publisher re-fire
```

**C. Waiting for prior events to finish writing.** Don't try to delay the handler. Have the *client* delay before sending the "done" event (e.g. cef-voice-example waits 25s after Stop before sending `audio.complete`). The handler then reads whatever has actually landed in the cubby and proceeds. Partial results are better than a hung handler.

If you find yourself wanting a `sleep(2000)` inside an agent, the answer is almost always "move that delay to the client."

## 2. The shape of an agent

```ts
// agent/cef.config.ts
import { defineAgent } from "@cef-ai/agent-sdk/config";
export default defineAgent({
  id: "my-agent",
  version: "1.0.0",                       // bump every republish; ROB 409s on duplicates
  engagements: [{ id: "main", entry: "./src/handler.ts" }],
  cubbies:     [{ alias: "store", migrations: "./migrations/store" }],
  settings: [
    { key: "apiKey", type: "string", label: "External API key", required: true },
  ],
  fetch: { allow: ["https://api.example.com"] },
});
```

```ts
// agent/src/handler.ts
import { Engagement, OnEvent } from "@cef-ai/agent-sdk";
import type { Context, VaultEvent } from "@cef-ai/agent-sdk";

@Engagement({ id: "main", goal: "Process incoming images" })
export default class Main {
  @OnEvent("image_uploaded")
  async onImage(event: VaultEvent, ctx: Context) {
    // Wire shape is unpredictable; always unwrap defensively.
    const raw = event.payload?.payload ?? event.payload;
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    const { conversationId, image_url } = p;

    const apiKey = (ctx.settings as any)?.apiKey;
    if (!apiKey) { ctx.log.error("apiKey missing"); return { ok: true, skipped: true }; }

    const res = await (ctx as any).fetch("https://api.example.com/classify", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url }),
    });
    const data = await res.json() as any;

    const db = ctx.cubby("store");
    await db.exec(
      `INSERT INTO results (id, conv, labels, created_at) VALUES (?, ?, ?, ?)`,
      [`r:${conversationId}`, conversationId, JSON.stringify(data.labels), new Date().toISOString()],
    );
    return { ok: true };
  }
}
```

**Three things people get wrong on this signature:**

- Forgetting the **double unwrap** of `event.payload?.payload ?? event.payload`. Some publishers wrap the payload one extra level; without this you get `undefined` and no error.
- Trying to destructure `ctx.cubby` like an object (it's a function: `ctx.cubby('alias')` returns the DB).
- Reading settings from `process.env`. Settings are injected into `ctx.settings` from the marketplace UI — never bundled.

## 3. The cubby: SQLite, per-agent

A cubby is **one SQLite database per `(vault, agent)` pair**, not per user, not per conversation. Schema is declared via SQL files in `./migrations/<alias>/NNN-name.sql` (ordered numerically) and applied on first use.

```sql
-- migrations/store/001-init.sql
CREATE TABLE IF NOT EXISTS results (
  id         TEXT PRIMARY KEY,
  conv       TEXT NOT NULL,
  labels     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv ON results(conv);
```

`ctx.cubby(alias)` is the handle. Two methods:

| Method | Use |
|-|-|
| `await db.query(sql, params)` | Reads. Returns `row[]`. |
| `await db.exec(sql, params)` | Writes. |

**Per-conversation isolation is your job.** Filter every query by `conversationId` (or `event.context`), or you'll cross-contaminate. The cubby itself does not isolate by user, scope, or context.

## 4. The event flow

```
Browser (or any client)
  └─ vault.events.publish(vaultId, scope, [{ type, target: agentId, payload, ...}])
     └─ Agent runtime matches type against @OnEvent('type') decorators
        └─ Handler runs in isolate; reads ctx.settings; writes ctx.cubby
           └─ Browser polls cubby for the result
```

Events you'll publish: whatever you declare. `audio_chunk`, `image_uploaded`, `user_message` — your contract.

The handler returning a value is purely a log/debug aid. The browser does not receive return values — it reads what you wrote to the cubby.

## 5. Two ways to call a model

| Path | When |
|-|-|
| `ctx.models.<alias>.infer(...)` | Cere-hosted model. Today: bucket 1338 auto-injected. Future: declare `models: { alias: "https://models.cere.ai/..." }` in `cef.config.ts` and use `cef typegen` for types. |
| `ctx.fetch(url, opts)` | External provider (Gemini, AssemblyAI, Hume, etc.). Host must be in `fetch.allow`. JSON bodies only. |

If you're calling Gemini or AssemblyAI, use `ctx.fetch`. If you're calling Whisper or Qwen on Cere's network, use `ctx.models`.

## 6. The companion browser client

Required if a human is involved. Lives in a sibling package using `@cef-ai/client-sdk` + `@cere/embed-wallet`.

The wallet signs vault writes. After connecting:

```ts
await vault.events.publish(vaultId, scope, [{
  type: "image_uploaded",
  role: "user",
  scope,
  context: conversationId,
  target: `${agentServicePubkey}:my-agent`,   // <pubkey>:<agent.id>
  payload: { conversationId, image_url },
  timestamp: new Date().toISOString(),
}]);
```

**Cubby query from the browser uses a raw HTTP path.** The SDK method (`vault.cubbies.query()`) returns 404 on devnet — use:

```ts
const path = `/api/v1/vaults/${vaultId}/scopes/${scope}/agents/${agentId}/cubbies/<alias>/query`;
const json = await (vault as any).http.request("POST", path, {
  body: { sql: "SELECT ... WHERE id = ?", params: [...] },
});
```

Poll every 2–5s until your row appears.

## 7. The ship loop

```
cd agent
npm run build            # npx cef build → dist/<id>/bundle.js + manifest.json
npm run prepare-manifest # strips internal fields → manifest-publish.json at repo root
# Upload manifest-publish.json to ROB → Publish
# In marketplace: DISCONNECT previous version, set API keys, CONNECT new version
```

Things people miss:

- **Bump `version` in `cef.config.ts` every republish.** ROB 409s on a duplicate version string and the failure message is unhelpful.
- **The marketplace does not auto-swap.** Publishing v2 to ROB does not replace v1 on connected users. You must disconnect, then connect.
- **Settings live in the marketplace, not in code.** Each connected user enters their own API keys — they're injected into `ctx.settings` at runtime.

## Reference agents (canonical)

- `cef-voice-example` — minimal audio + transcribe + LLM. The base template most agents clone.
- `chat-agent` — minimal one-handler example. Best for understanding the SDK shape.
- `date-coach` — parallel external providers (`Promise.allSettled`) + cubby aggregation.

When in doubt, copy from these — not from older `cef.config.yaml` / engagement-as-function / `cubby.put/get` patterns that don't apply to vault agents.

## Common mistakes

| Symptom | Cause | Fix |
|-|-|-|
| `setTimeout is not defined` | Library code using setTimeout in agent | Tight-loop polls; fetch latency rate-limits |
| Handler runs but `payload` is undefined | Single-unwrap | Use `event.payload?.payload ?? event.payload` |
| `ctx.fetch` returns "not allowed" | Host missing | Add to `fetch.allow` in `cef.config.ts` |
| 409 on publish | Same `version` as before | Bump `version` |
| Republished but old behavior persists | Marketplace still on old version | Disconnect + reconnect |
| Cross-talk between users' data | Querying cubby without filter | Filter every query by `event.context` or a payload field |
| Browser cubby query → 404 | Used `vault.cubbies.query()` SDK method | Use raw HTTP via `vault.http.request()` |
| "File does not appear to contain audio" / multipart errors | Sending binary body from agent | Upload browser-side → publish URL → agent fetches URL |
| Agent doesn't fire at all | Wrong wallet, agent service in playground (not ROB), or `target` agentId mismatch | Use ROB; `target` must be `<servicePubkey>:<config.id>` |
