# CEF Intelligence

Reference documentation for building and connecting to agent services on the Cere CEF stack.

## Two Sides

### 🔧 Building Agent Services (handler code that runs inside CEF)
- `api-reference/` — CEFContext, Cubby, Streams, Agent-to-Agent APIs
- `patterns/` — Handler, Cubby, Fan-out, Feedback loop, RAFT indexer
- `data-structures/` — TypeScript types, hierarchy model
- `examples/` — Production-validated handlers from razzmatazz

### 🔌 Connecting to Agent Services (client SDK for external apps)
- `client-sdk/` — `@cef-ai/client-sdk` usage: events, streams, agreements, queries, wallets

---

## Structure

```
intelligence/
├── api-reference/              ← CEF runtime APIs (inside handlers)
│   ├── cef-context.md
│   ├── cubby-api.md
│   ├── streams-api.md
│   └── agent-to-agent.md
├── patterns/                   ← Reusable patterns
│   ├── handler-pattern.md
│   ├── cubby-patterns.md
│   ├── fan-out-pattern.md
│   ├── feedback-loop.md
│   └── raft-indexer.md
├── data-structures/            ← Types and hierarchy
│   ├── cef-types.ts
│   └── hierarchy.md
├── examples/                   ← Real handler code
│   ├── eval-handler.ts
│   ├── engagement-handler.ts
│   ├── feedback-handler.ts
│   ├── cubby-helpers.ts
│   └── cubby-deltas.ts
├── client-sdk/                 ← External connection (npm SDK)
│   ├── overview.md
│   ├── events.md
│   ├── streams.md
│   ├── agreements.md
│   ├── queries.md
│   └── wallets.md
└── README.md
```

## Usage

When you describe an agent service:
1. I read the relevant docs from this folder
2. Build handler code using the patterns and API reference
3. Build client code using the SDK docs
4. Wire it all together with proper types, signing, and error handling

## Sources

- Handler/runtime: [cere-io/razzmatazz](https://github.com/cere-io/razzmatazz) (production-validated)
- Client SDK: [@cef-ai/client-sdk](https://www.npmjs.com/package/@cef-ai/client-sdk) v0.0.6
