---
name: sandbox-widget-creation
description: Use when building, debugging, or fixing an HTML widget folder for the Cere Sandbox — covers the exact window.WidgetSandbox / window.WidgetRuntime contract, the head/body script injection order, two rendering approaches, manifest shape (with fallback), auto-mount conditions, multi-file ES module limits, and a troubleshooting checklist for common runtime-not-available errors
---

# Sandbox Widget Creation

## Overview

A Cere Sandbox widget is a **folder of static files** (HTML + JS + CSS + assets) uploaded via the Sandbox UI. `index.html` is required at the root of the folder (or nested once — the platform picks the shallowest `index.html`).

At preview and publish time the platform:
1. Rewrites `src` / `href` / `poster` / `srcset` in your HTML to blob or signed S3 URLs.
2. Injects a `<script>` into `<head>` that sets `window.WidgetSandbox` (with the fully parsed manifest inlined).
3. Injects `<script src=".../widget-runtime.js">` into `<head>` **if** your HTML doesn't already reference `widget-runtime.js` or call `WidgetRuntime.mount`. That script sets `window.WidgetRuntime`.
4. Appends an auto-mount `<script>` to the end of `<body>` **if** your HTML has all three of `#widget-root`, `#widget-title`, `#widget-meta` AND doesn't already call `WidgetRuntime.mount`.

Because both injected scripts land in `<head>` and are synchronous (parser-blocking), `window.WidgetSandbox` and `window.WidgetRuntime` are **guaranteed to exist before any plain `<body>` `<script>` runs**. No polling or `DOMContentLoaded` gating is needed for runtime availability. Caveats: this guarantee does **not** apply to `<script async>` (races the runtime) or to scripts placed in `<head>` *before* the bridge's appended scripts.

**Size:** no enforced platform ceiling on the uploaded folder, but the Sandbox UI snapshots uploads in the browser's IndexedDB and, as a fallback when IndexedDB is unavailable (e.g. private-mode), in `localStorage` with a ~1.5 MB JSON-serialized ceiling (`MAX_STORED_WIDGET_BYTES` in `localStorage.ts`). Keep folders lean so the fallback path still works.

---

## The Exact Contract

### `window.WidgetSandbox`

```js
window.WidgetSandbox = {
  manifestUrl: "blob:... | https://s3.../manifest.json?X-Amz-...",
  runtimeUrl:  "blob:... | https://s3.../widget-runtime.js?X-Amz-...",
  manifest:    { /* full parsed SandboxWidgetManifest — no fetch needed */ }
};
```

There is no `dataUrl` and no `sandbox.data` — the platform never pre-fetches rows. Always execute the query live via `WidgetRuntime.query()`.

### `window.WidgetRuntime`

```js
window.WidgetRuntime = {
  // Table renderer — used by Approach B. Mutates #widget-root/#widget-title/#widget-meta.
  mount(options: { rootId, titleId, metaId, manifestUrl }): Promise<void>;

  // Custom renderer — fetch + parse manifest, execute SDK query, return rows.
  query(manifestUrl: string): Promise<{
    manifest: SandboxWidgetManifest;
    columns:  string[];
    rows:     unknown[][];
    meta:     { duration: number; rowsRead: number };
  }>;
};
```

`query()` internally:
- Fetches and validates the manifest (schemaVersion must be `1`).
- Resolves positional `query.params`, overriding entries at `urlParams[i].index` with values from `window.location.search`.
- Creates a `ClientSdk` with a dev-mode `UriSigner`, opens an agreement for the manifest's scopes, and executes `sdk.query.sql(manifest.query.sql, params, manifest.query.timeoutMs)`.
- Normalizes the result into `{ columns, rows, meta }`.

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

`manifest.json` is **optional** at the root of your folder. If absent, the platform builds one from the attached SQLite Cubby query. If present, its `schemaVersion` must be `1`.

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
    workspaceId: string;
    streamId: string;
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
    alias: string;
    instanceId: 'default';
  };
  query: {
    id: string;
    label: string;
    sql: string;
    params: unknown[];                   // positional SQL params
    timeoutMs: number;
    execution: 'client.query.sql';
    refresh: { enabled: boolean; intervalMs?: number };
    urlParams?: Array<{ name: string; index: number; type: 'string' | 'number' | 'boolean' }>;
  };
  render: { mode: 'table' };
}
```

### URL Params — runtime query overrides

Define them on `manifest.query.urlParams` to let embedders override positional SQL params via the iframe URL:

```json
"urlParams": [
  { "name": "userId", "index": 0, "type": "string" },
  { "name": "limit",  "index": 1, "type": "number" }
]
```

```html
<iframe src="https://s3.../index.html?userId=456&limit=20"></iframe>
```

The runtime reads `window.location.search` and substitutes values before executing the SQL.

---

## Multi-file / ES Module Builds

At **preview** time, `resolveEsModuleImportUrls()` walks every `.js` file in your folder, rewrites relative static and dynamic imports to blob URLs, and creates a new blob URL per file. Circular deps fall back to best-effort rewriting.

At **publish** time, JS files are uploaded as-is to S3 — relative imports are **not** rewritten. This works fine for **public** buckets (the browser resolves `./utils.js` against the index URL and the unsigned object is readable). For **private** buckets the index is served from a signed URL; browsers strip the query string when resolving relative paths, so `./utils.js` 404s without its own signature.

**Rule of thumb:** ship a single-file IIFE bundle for publish (e.g. `esbuild --format=iife`). Multi-file ES modules work in preview and on public-bucket publishes, but break on private-bucket publishes.

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

// Stub the runtime — returns static rows so you can develop without the SDK.
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

After publishing, copy the signed `manifest.json` and `widget-runtime.js` URLs from the embed page and pin them in `sandbox-injector.js`:

```js
// sandbox-injector.js — load BEFORE any widget script
window.WidgetSandbox = {
  manifestUrl: 'https://s3.example.com/.../manifest.json?X-Amz-...',
  runtimeUrl:  'https://s3.example.com/.../widget-runtime.js?X-Amz-...',
  manifest:    null,
};
// window.WidgetRuntime is provided by widget-runtime.js
```

```html
<script src="./sandbox-injector.js"></script>
<script src="https://s3.example.com/.../widget-runtime.js?X-Amz-..."></script>
<script src="./main.js"></script>
```

Signed URLs expire (~24 h) — re-publish to refresh.

**Important:** `sandbox-injector.js` must never be present in the folder you upload. Remove it (or exclude it) before uploading to Sandbox — the real bridge will set the globals for you.

---

## Upload → Preview → Publish

1. **Upload** — Sandbox UI → Upload → folder or files. The shallowest `index.html` is taken as the entry.
2. **Attach query** — Pencil icon → Attached query. If the uploaded folder contains a valid `manifest.json`, its query is used; otherwise the platform auto-picks the first matching SQLite Cubby query for the workspace.
3. **Preview** — Platform builds blob URLs for every file, rewrites HTML asset refs, rewrites JS ES module imports, injects the bridge, opens the iframe.
4. **Publish** — Files (plus a freshly generated `manifest.json` and `widget-runtime.js`) upload to S3. `index.html` is rewritten with signed URLs and re-uploaded last. Embed URL is returned.

---

## Fixing a Broken Widget — Checklist

Run through this list against a widget that's misbehaving:

- [ ] `index.html` is at the root (or exactly one directory deep) of the uploaded folder.
- [ ] All asset refs use **relative paths** (`./logo.png`, not `/logo.png` or `/assets/logo.png`).
- [ ] Widget folder fits comfortably (the Sandbox UI caches uploads in IndexedDB; in private-mode the fallback is localStorage with a ~1.5 MB JSON-serialized ceiling).
- [ ] If using Approach A: your code calls `window.WidgetRuntime.query(window.WidgetSandbox.manifestUrl)` — not `sandbox.dataUrl`, not `fetch(manifestUrl)` yourself.
- [ ] If using Approach B: `#widget-root`, `#widget-title`, `#widget-meta` are all present.
- [ ] No `sandbox-injector.js` in the uploaded folder.
- [ ] Output is a single-file JS bundle, or multi-file ES modules that you only rely on in preview.
- [ ] HTML is escaped when rendering user-controlled values into `innerHTML`.
- [ ] If the widget accepts URL params, `manifest.query.urlParams` declares them; otherwise they're ignored.

### Error: `window.WidgetRuntime is not available` (or `WidgetRuntime.query` is undefined)

The runtime script never set the global. Causes, in order of likelihood:
1. **The widget is being opened outside the Sandbox** (local file, staging iframe without the bridge). Use `sandbox-injector.js` (see Local Testing) or preview via the Sandbox UI.
2. **Your HTML has a string that looks like `widget-runtime.js` or `WidgetRuntime.mount`** (e.g. in a comment, meta tag, inline script, or docstring). `referencesRuntime()` matches case-insensitively on the raw HTML string and skips runtime injection when it hits. Remove the stray reference, or add a real `<script src="./widget-runtime.js">` tag so the bridge rewrites the URL and the script actually runs.
3. **A `<script async>` reads `WidgetRuntime` before the head-injected runtime finishes loading.** Remove `async`, or wait for `load` before calling `query()`.
4. **The compiled `widget-runtime.js` bundle threw during execution** — check the iframe DevTools console for errors thrown before `window.WidgetRuntime = createWidgetRuntime()` runs.

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
| Absolute asset paths (`/images/logo.png`) | Use relative paths — only relative URLs are rewritten to blob/signed URLs. |
| Shipping a multi-file ES module build when publishing to a private (signed-URL) bucket | Bundle to a single IIFE (`esbuild --format=iife`) — relative imports don't carry the signature. Multi-file ES modules are safe in preview and on public-bucket publishes. |
| Leaving `sandbox-injector.js` in the uploaded folder | Delete it before upload. The real bridge sets `WidgetSandbox` + `WidgetRuntime`. |
| Very large widget folder | Minify / tree-shake. If IndexedDB is unavailable the UI falls back to a ~1.5 MB localStorage serialisation and will refuse to save. |
