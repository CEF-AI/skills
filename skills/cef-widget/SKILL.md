---
name: sandbox-widget-creation
description: Use when building, debugging, or fixing an HTML widget folder for the Cere Sandbox — covers the window.WidgetSandbox / window.WidgetRuntime contract, parent-bridged wallet signing (postMessage), the current Vault SDK query path (vault.agents.get(agentId).cubby(alias).query), manifest shape with required sdk.agentId, named (:name) URL-param placeholders, the publish/archive flows that auto-bump the workspace manifest, and a troubleshooting checklist for runtime-not-available and agent-not-connected errors
---

# Sandbox Widget Creation

## What this skill is for

You are authoring a **folder of plain static files** (HTML + JS + CSS + assets) that the Sandbox UI uploads, snapshots locally, previews via blob URLs, and publishes to a public S3 bucket. The result runs cross-origin inside an iframe whose parent (`SandboxPage` in ROB) owns the user's wallet and answers `postMessage` sign requests on the widget's behalf.

The sanctioned interfaces for everything the widget needs at runtime — manifest, SQL execution against the user's cubby, identity — are `window.WidgetSandbox` and `window.WidgetRuntime`. Both are set by `<head>`-injected scripts before any plain `<body>` `<script>` runs (details below). The widget never sees a mnemonic and never talks to the chain directly.

Default path: rely on the pre-bundled runtime via `window.WidgetRuntime.query(window.WidgetSandbox.manifestUrl)` (or `WidgetRuntime.mount(...)` for the built-in table). The SDK behind that runtime is **[`@cef-ai/vault-sdk`](https://www.npmjs.com/package/@cef-ai/vault-sdk)** (pinned to `^0.5.1` in `frontend/package.json` — confirm against the lockfile if it matters). It is compiled into `widget-runtime.js` along with the parent-bridged wallet adapter, so you do **not** need to add it to a widget's own `package.json`. If you have a reason to instantiate `VaultSDK` yourself — e.g. a multi-cubby widget — you can ship it in your own bundle, but you'll have to re-implement the postMessage wallet bridge (see `widget/widgetRuntime.ts` for the reference adapter) and you forgo the synchronous availability guarantee the platform gives `window.WidgetRuntime`.

## Overview

A Cere Sandbox widget is a **folder of static files** (HTML + JS + CSS + assets) uploaded via the Sandbox UI. `index.html` is required at the root of the folder (or nested once — the platform picks the shallowest `index.html`).

At preview and publish time the platform:
1. Rewrites `src` / `href` / `poster` / `srcset` in your HTML to blob (preview) or public S3 URLs (publish).
2. Injects a `<script>` into `<head>` that sets `window.WidgetSandbox` (with the fully parsed manifest inlined).
3. Injects `<script src=".../widget-runtime.js">` into `<head>` **if** your HTML doesn't already reference `widget-runtime.js` or call `WidgetRuntime.mount`. That script sets `window.WidgetRuntime`.
4. Appends an auto-mount `<script>` to the end of `<body>` **if** your HTML has all three of `#widget-root`, `#widget-title`, `#widget-meta` AND doesn't already call `WidgetRuntime.mount`.

Both injected scripts land in `<head>` and are synchronous (parser-blocking), so `window.WidgetSandbox` and `window.WidgetRuntime` are **guaranteed to exist before any plain `<body>` `<script>` runs**. No polling or `DOMContentLoaded` gating is needed for runtime availability. Caveats: this guarantee does **not** apply to `<script async>` (races the runtime) or to scripts placed in `<head>` *before* the bridge's appended scripts.

**Bucket visibility:** the publish flow sets bucket ACL to `public-read` and uses `getPublicObjectUrl` for the embed URL — no signed URLs, no 24-h expiry.

**Size:** no enforced platform ceiling on the uploaded folder, but the Sandbox UI snapshots uploads in the browser's IndexedDB and, as a fallback when IndexedDB is unavailable (e.g. private-mode), in `localStorage` with a ~1.5 MB JSON-serialized ceiling (`MAX_STORED_WIDGET_BYTES` in `localStorage.ts`).

---

## The Exact Contract

### `window.WidgetSandbox`

```js
window.WidgetSandbox = {
  manifestUrl: "blob:... | https://<bucket>.s3.amazonaws.com/.../manifest.json",
  runtimeUrl:  "blob:... | https://<bucket>.s3.amazonaws.com/.../widget-runtime.js",
  manifest:    { /* full parsed SandboxWidgetManifest — no fetch needed */ }
};
```

There is no `dataUrl` and no `sandbox.data` — the platform never pre-fetches rows. Always execute the query live via `WidgetRuntime.query()`.

### `window.WidgetRuntime`

```js
window.WidgetRuntime = {
  // Table renderer — used by Approach B. Mutates #widget-root/#widget-title/#widget-meta.
  mount(options: { rootId, titleId, metaId, manifestUrl }): Promise<void>;

  // Custom renderer — fetch + parse manifest, execute Vault SDK query, return rows.
  query(manifestUrl: string): Promise<{
    manifest: SandboxWidgetManifest;
    columns:  string[];
    rows:     unknown[][];
    meta:     { duration: number; rowsRead: number };
  }>;
};
```

`query()` internally:
- Fetches and validates the manifest (schemaVersion must be `1`; `sdk.agentId`, `sdk.vaultBaseUrl`, `sdk.urls`, `sqliteCubby.alias`, and `query.sql` must all be present).
- Substitutes SQLite `:name` placeholders in `query.sql` with values from `window.location.search` (or `#?...` for blob preview URLs that strip the query string).
- Builds a `VaultSDK` pointed at the manifest's `sdk.vaultBaseUrl` / `sdk.marketplaceUrl` / `sdk.urls.garUrl` / `sdk.rpcEndpoint`, with a **parent-bridged wallet** (see next section).
- Calls `vault.current()` (NOT `ensure()` — onboarding happens in the parent), then `vault.agents.get(manifest.sdk.agentId).cubby(manifest.sqliteCubby.alias).query(sql, params)`.
- Normalises the result into `{ columns, rows, meta }`.

---

## Parent-Bridged Wallet (postMessage)

The widget iframe **never sees the user's seed**. Every `sign(bytes)` / `pubkey()` call is forwarded up to `window.parent` over postMessage; the parent app routes the request to the user's connected wallet adapter and returns the signature.

Protocol message types (defined in `frontend/src/pages/sandbox/widget/widgetSignBridge.ts`):

```ts
// child → parent
{ type: 'cef-widget:identity-request', requestId }
{ type: 'cef-widget:sign-request',     requestId, bytes: number[] }

// parent → child
{ type: 'cef-widget:identity-response', requestId, pubkey, sigType: 'ed25519' | 'sr25519', error? }
{ type: 'cef-widget:sign-response',     requestId, signature: number[] | null,            error? }
```

For this to work, **the parent app must mount `useWidgetSignBridge(wallet)`** on the page that hosts the iframe (`SandboxPage` already does this in ROB). If you embed a widget in a host that doesn't run that hook, every Vault SDK call will time out after 30 s with `Widget sign bridge timed out`.

Implication for widget authors: there's no wallet config to ship — your widget just calls `WidgetRuntime.query()` and trusts the parent to provide identity + signatures.

---

## Two Rendering Approaches

### Approach A — Custom rendering (full control)

```html
<!-- index.html -->
<body>
  <div id="app"></div>
  <script src="./main.js"></script>
</body>
```

```js
// main.js — runs after <head> has already set WidgetSandbox + WidgetRuntime
async function boot() {
  const sb = window.WidgetSandbox;
  if (!sb?.manifestUrl) {
    // Only happens when opened outside the Sandbox (no bridge). See "Local testing".
    throw new Error('window.WidgetSandbox is not available. Preview via the Cere Sandbox.');
  }

  const { columns, rows, meta, manifest } = await window.WidgetRuntime.query(sb.manifestUrl);

  const app = document.getElementById('app');
  const head = columns.map(c => `<th>${c}</th>`).join('');
  const body = rows.map(row =>
    `<tr>${row.map(v => `<td>${v ?? ''}</td>`).join('')}</tr>`
  ).join('');
  app.innerHTML = `<table><tr>${head}</tr>${body}</table>`;
}

void boot();
```

No `DOMContentLoaded` needed — head-injected scripts have already run. If you reference DOM elements created later in `<body>`, place your `<script>` after them (classic pattern) or wrap with `DOMContentLoaded`.

### Approach B — Built-in table renderer (zero code)

```html
<body>
  <main>
    <h1 id="widget-title">Loading...</h1>
    <p  id="widget-meta"></p>
    <div id="widget-root">Loading data...</div>
  </main>
  <!-- No <script> needed — platform injects widget-runtime.js into <head>
       and appends an auto-mount call at the end of <body>. -->
</body>
```

All three IDs are required (`#widget-root`, `#widget-title`, `#widget-meta`). If any is missing, auto-mount is skipped silently.

### Opting out of auto-injection

If you want explicit control, include a runtime script tag yourself:

```html
<script src="./widget-runtime.js"></script>
<script>
  window.WidgetRuntime.mount({
    rootId: 'widget-root',
    titleId: 'widget-title',
    metaId: 'widget-meta',
    manifestUrl: window.WidgetSandbox.manifestUrl,
  });
</script>
```

The platform rewrites `./widget-runtime.js` to the real URL at preview/publish time, and because your HTML already references it (or calls `WidgetRuntime.mount`), no duplicate injection happens.

---

## Manifest

`manifest.json` is **optional** at the root of your folder. If absent, the platform builds one at preview/publish time from the workspace's stored agent manifest. If present, its `schemaVersion` must be `1`.

Full shape (see `frontend/src/pages/sandbox/widget/manifest.ts`):

```ts
{
  schemaVersion: 1;
  widgetId: string;
  name: string;
  generatedAt: string;                   // ISO 8601
  runtime: {
    kind: 'html';
    sdkScript: './widget-runtime.js';
    devWalletMode: true;
  };
  sdk: {
    agentServicePubKey: string;
    /**
     * REQUIRED. Canonical `<asPubKey>:<agentAlias>` from the workspace's
     * stored agent manifest. The runtime passes this verbatim to
     * `vault.agents.get(agentId)`. A mismatch causes the vault to 404 with
     * "agent not connected".
     */
    agentId: string;
    workspaceId: string;
    streamId: string;
    vaultBaseUrl: string;
    marketplaceUrl: string;
    rpcEndpoint: string;
    urls: {
      ddcComputeUrl: string;
      webTransportUrl: string;
      eventRuntimeUrl: string;
      agentRuntimeUrl: string;
      sisApiUrl: string;
      garUrl: string;
    };
    agreement: {
      ttlSeconds: number;
      scopes: Array<{ workspaceId: string; streamId: string }>;
    };
  };
  sqliteCubby: {
    cubbyId: string;
    /**
     * REQUIRED. Must be one of the aliases declared in the workspace's
     * stored agent manifest `cubbies[]`. The runtime calls
     * `agent.cubby(alias)` and the vault rejects unknown aliases with
     * `agent ... has no cubby "<alias>". Declared aliases: ...`.
     */
    alias: string;
    instanceId: 'default';
  };
  query: {
    id: string;
    label: string;
    /**
     * SQL with SQLite `:name` placeholders. The runtime resolves each
     * placeholder against `window.location.search` (or `#?...` for blob
     * preview URLs).
     */
    sql: string;
    timeoutMs: number;
    execution: 'client.query.sql';
    refresh: { enabled: boolean; intervalMs?: number };
  };
  render: { mode: 'table' };
}
```

### URL Params — runtime query overrides

There is **no separate `urlParams` declaration**. The runtime parses every `:name` placeholder in `query.sql` and binds each one to `window.location.search.get(name)` (missing names bind to `null`). Repeated placeholders bind to the same value.

```json
"query": {
  "sql": "SELECT * FROM messages WHERE user_id = :userId AND created_at > :since LIMIT :limit"
}
```

```html
<iframe src="https://<bucket>.s3.../index.html?userId=42&since=2026-01-01&limit=20"></iframe>
```

Blob: preview URLs strip query strings; use the `#?` fragment form (`index.html#?userId=42&...`) when testing previews directly.

---

## Multi-file / ES Module Builds

At **preview** time, `resolveEsModuleImportUrls()` walks every `.js` file in your folder, rewrites relative static and dynamic imports to blob URLs, and creates a new blob URL per file. Circular deps fall back to best-effort rewriting.

At **publish** time, JS files are uploaded as-is to S3. Because the bucket is `public-read`, the browser can resolve `./utils.js` against the index URL without any signature — multi-file ES modules work in publish too.

There's still a good case for shipping a single-file IIFE bundle (`esbuild --format=iife`) at publish time: one fewer round-trip per asset, simpler asset rewriting, and protection against any future tightening of bucket ACLs.

---

## Local Testing

### Option 1 — Minimal injector (no network)

```js
// sandbox-injector.js
window.WidgetSandbox = {
  manifestUrl: './manifest.json',
  runtimeUrl:  './widget-runtime.js',
  manifest:    null,
};

// Stub the runtime — returns static rows so you can develop without the Vault SDK.
window.WidgetRuntime = {
  async query() {
    const r = await fetch('./data.json');
    const data = await r.json();
    return {
      manifest: null,
      columns: data.columns,
      rows:    data.rows,
      meta:    data.meta ?? { duration: 0, rowsRead: data.rows.length },
    };
  },
  async mount() { /* no-op */ },
};
```

```html
<!-- index.html — load injector FIRST, before any widget script -->
<head>
  <script src="./sandbox-injector.js"></script>
</head>
<body>
  <div id="app"></div>
  <script src="./main.js"></script>
</body>
```

Drop a `data.json` next to `index.html`:

```json
{ "columns": ["id", "name"], "rows": [[1, "alice"], [2, "bob"]], "meta": { "duration": 0, "rowsRead": 2 } }
```

```bash
npx serve .
# open http://localhost:3000
```

### Option 2 — Live connection (real published data)

After publishing, copy the **public** `manifest.json` and `widget-runtime.js` URLs from the embed page and pin them in `sandbox-injector.js`:

```js
// sandbox-injector.js — load BEFORE any widget script
window.WidgetSandbox = {
  manifestUrl: 'https://<bucket>.s3.amazonaws.com/.../manifest.json',
  runtimeUrl:  'https://<bucket>.s3.amazonaws.com/.../widget-runtime.js',
  manifest:    null,
};
// window.WidgetRuntime is provided by widget-runtime.js
```

```html
<script src="./sandbox-injector.js"></script>
<script src="https://<bucket>.s3.amazonaws.com/.../widget-runtime.js"></script>
<script src="./main.js"></script>
```

Caveat: when serving locally like this, your local origin acts as the parent for the widget's postMessage bridge — so **your local harness needs to answer `cef-widget:identity-request` / `cef-widget:sign-request`** with a real wallet, or stub `WidgetRuntime.query` (Option 1) instead. The simplest path is to keep custom-renderer development on Option 1 and reserve Option 2 for verifying the published bundle.

**Important:** `sandbox-injector.js` must never be present in the folder you upload. Remove it (or exclude it) before uploading to Sandbox — the real bridge will set the globals for you.

---

## Upload → Preview → Publish → Archive

1. **Upload** — Sandbox UI → Upload → folder or files. The shallowest `index.html` is taken as the entry. The widget is stored in localStorage (keyed by `asPubKey + workspaceId`) and mirrored fire-and-forget to the developer's bucket at `agent-service/widgets/index.json` + `agent-service/widgets/<id>/files.json`.
2. **Attach query (optional)** — Edit Widget → Data Source. If no saved query is attached the runtime falls back to a placeholder `SELECT 1`, which is enough to render the widget shell so the user can iterate on layout before wiring data.
3. **Preview** — Click the widget title. The platform builds blob URLs for every file, rewrites HTML asset refs, rewrites JS ES module imports, injects the bridge, opens the iframe.
4. **Publish** — Click the row's More → Publish. The Publish Widget dialog collects **Title** + **Description** (both required), then the flow runs three phases visualised as a vertical stepper:
   1. **Uploading widget assets** — files (plus a freshly generated `manifest.json` and `widget-runtime.js`) upload to the dev's public bucket. `index.html` is rewritten with the public URLs and re-uploaded last.
   2. **Updating workspace manifest** — the workspace's stored agent manifest is read from the bucket, the patch segment of `manifest.version` is auto-bumped, a `WidgetDecl` (`id`, `name`, `description`, `embedUrl`, and `cubbyAlias`/`sqlQuery` if attached) is upserted into `manifest.widgets[]`, and the new versioned sidecar is written back.
   3. **Publishing manifest to marketplace** — the new manifest version is signed (developer wallet) and POSTed to the marketplace `/api/v1/marketplace/agents` endpoint, going straight to the `production` release state.
5. **Archive** — Row More → Archive. If the widget has no `publishInfo` the row flips to `archived` locally with no marketplace round-trip. If it's been published, the Archive Widget dialog confirms, then bumps the patch version again, strips the `WidgetDecl` from `manifest.widgets[]`, and re-publishes. The widget's bucket files stay in place so a later re-publish doesn't have to re-upload.

Re-publish is always reachable from the More menu — clicking it on a previously-published widget opens the publish dialog with Title and Description pre-filled from the locally-stored values.

---

## Fixing a Broken Widget — Checklist

Run through this list against a widget that's misbehaving:

- [ ] `index.html` is at the root (or exactly one directory deep) of the uploaded folder.
- [ ] All asset refs use **relative paths** (`./logo.png`, not `/logo.png` or `/assets/logo.png`).
- [ ] Widget folder fits comfortably (the Sandbox UI caches uploads in IndexedDB; in private-mode the fallback is localStorage with a ~1.5 MB JSON-serialized ceiling).
- [ ] If using Approach A: your code calls `window.WidgetRuntime.query(window.WidgetSandbox.manifestUrl)` — not `sandbox.dataUrl`, not `fetch(manifestUrl)` yourself.
- [ ] If using Approach B: `#widget-root`, `#widget-title`, `#widget-meta` are all present.
- [ ] No `sandbox-injector.js` in the uploaded folder.
- [ ] If you bundle a `manifest.json`, every required field is set: `sdk.agentId`, `sdk.vaultBaseUrl`, `sdk.urls`, `sqliteCubby.alias`, `query.sql`.
- [ ] `sqliteCubby.alias` matches one of the aliases declared in the workspace's stored agent manifest. Synthesized aliases like `ws_<workspaceId>` are rejected by the vault.
- [ ] HTML is escaped when rendering user-controlled values into `innerHTML`.
- [ ] URL params are wired via SQLite `:name` placeholders in `query.sql` — there's no separate `urlParams` array.

### Error: `window.WidgetRuntime is not available` (or `WidgetRuntime.query` is undefined)

The runtime script never set the global. Causes, in order of likelihood:
1. **The widget is being opened outside the Sandbox** (local file, staging iframe without the bridge). Use `sandbox-injector.js` (see Local Testing) or preview via the Sandbox UI.
2. **Your HTML has a string that looks like `widget-runtime.js` or `WidgetRuntime.mount`** (e.g. in a comment, meta tag, inline script, or docstring). `referencesRuntime()` matches case-insensitively on the raw HTML string and skips runtime injection when it hits. Remove the stray reference, or add a real `<script src="./widget-runtime.js">` tag so the bridge rewrites the URL and the script actually runs.
3. **A `<script async>` reads `WidgetRuntime` before the head-injected runtime finishes loading.** Remove `async`, or wait for `load` before calling `query()`.
4. **The compiled `widget-runtime.js` bundle threw during execution** — check the iframe DevTools console for errors thrown before `window.WidgetRuntime = createWidgetRuntime()` runs.

### Error: `agent ... has no cubby "<alias>". Declared aliases: <list>`

The Vault SDK rejected `agent.cubby(alias)` because `alias` isn't in the agent manifest's `cubbies[]`. The widget's `sqliteCubby.alias` must match what the published agent manifest declares; the sandbox panel now resolves the cubby from the *stored manifest's* first cubby alias for exactly this reason. If you ship a manifest in your widget folder, copy the alias from the workspace's agent manifest (not from any local synthesized value).

### Error: `agent not connected` / 404 from `/api/v1/vaults/<vault>/agents/<agentId>`

`sdk.agentId` doesn't address an agent the vault has consented to. Verify the manifest's `sdk.agentId` is the canonical `<asPubKey>:<agentAlias>` from the workspace's stored manifest — NOT `<asPubKey>:<workspaceId>`. The publish flow stamps the right value automatically; only ad-hoc widget builds need to set it by hand.

### Error: `Widget sign bridge timed out after 30000ms`

The parent app didn't answer the postMessage identity/sign request. Either the host page doesn't mount `useWidgetSignBridge(wallet)`, or the wallet is `null` because the user hasn't connected yet. In ROB this only happens if you embed a widget on a page other than the Sandbox.

### Error: `Onboarding required but no embed-wallet was provided to VaultSDK config`

The widget runtime called `vault.ensure()` — it must call `vault.current()` instead. Onboarding (gateway credential mint, `proxy.addProxy` extrinsic) is the parent app's responsibility; the widget's parent-bridged wallet has no access to the user's `EmbedWallet`.

### Error: `WidgetRuntime.query requires the compiled SDK runtime. This preview is running in dev/fallback mode...`

You're on the preview-runtime fallback (`previewRuntime.ts`) — the real compiled bundle at `/widget-runtime.js` wasn't reachable, so `runtimeLoader.ts` substituted a stub where `query()` throws this message. In this mode `WidgetRuntime` *is* defined and `mount()` works for layout, but `query()` can't execute SQL. Fix: run the app via `vite dev` (the `widgetRuntimeDevPlugin` serves the real bundle) or publish the widget.

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Polling / waiting for `window.WidgetRuntime` to appear | Not needed — it's set via a synchronous `<head>` script before any plain body script runs. |
| Putting `async` on the body script that uses `WidgetRuntime` | `async` breaks the head-then-body ordering guarantee; it can fire before the runtime finishes loading. Drop `async` or wait for the `load` event. |
| Writing a `<script>` in `<head>` that reads `WidgetRuntime` | The bridge's scripts are appended to the *end* of `<head>`, so earlier head scripts run first. Move the code to `<body>`. |
| Gating boot on `DOMContentLoaded` to wait for the runtime | Move `<script>` after the DOM it reads, or keep `DOMContentLoaded` only for DOM readiness — not for runtime readiness. |
| Fetching from `sandbox.dataUrl` | `dataUrl` no longer exists — use `window.WidgetRuntime.query(sb.manifestUrl)`. |
| Checking `sandbox.data` for inline rows | Platform never injects `data` — call `WidgetRuntime.query()`. |
| Fetching the manifest yourself from `sandbox.manifestUrl` | `sandbox.manifest` is already parsed — read it directly, or pass `manifestUrl` to `query()` which fetches internally. |
| Absolute asset paths (`/images/logo.png`) | Use relative paths — only relative URLs are rewritten to blob/public URLs. |
| Declaring `manifest.query.urlParams` | That array is gone. Use SQLite `:name` placeholders in `query.sql` — the runtime resolves them from `window.location.search` by name. |
| Setting `sdk.agentId` to `<asPubKey>:<workspaceId>` | The vault rejects this with 404 `agent not connected`. Copy `agentId` from the workspace's stored manifest (`<asPubKey>:<agentAlias>`). |
| Setting `sqliteCubby.alias` to a synthesized `ws_<workspaceId>` | The vault rejects unknown aliases. Use one of the aliases declared in the agent manifest's `cubbies[]`. |
| Calling `vault.ensure()` inside the widget | The widget's parent-bridged wallet has no onboarding capability. Call `vault.current()` — the parent already onboarded. |
| Embedding a widget on a host that doesn't mount `useWidgetSignBridge` | Every Vault SDK call times out after 30 s. The host page must mount the bridge with the user's wallet adapter. |
| Leaving `sandbox-injector.js` in the uploaded folder | Delete it before upload. The real bridge sets `WidgetSandbox` + `WidgetRuntime`. |
| Very large widget folder | Minify / tree-shake. If IndexedDB is unavailable the UI falls back to a ~1.5 MB localStorage serialisation and will refuse to save. |
