# CEF Intelligence

Reference documentation for building agent services on the Cere CEF stack.

When you describe an agent service you want to build, I reference this folder to understand the APIs, patterns, data structures, and hierarchy — then build it correctly.

## Structure

```
intelligence/
├── api-reference/
│   ├── cef-context.md        # CEFContext, CEFEvent — the runtime injected into handlers
│   ├── cubby-api.md          # Cubby JSON, Vector, KV, Archive APIs
│   ├── streams-api.md        # Stream subscribe, event patterns
│   └── agent-to-agent.md     # Dynamic proxy pattern for inter-agent calls
├── patterns/
│   ├── handler-pattern.md    # How to write a CEF handler (handle(event, context))
│   ├── cubby-patterns.md     # Key schemas, TTL, namespace conventions
│   ├── fan-out-pattern.md    # Engagement → N agents → consensus
│   ├── feedback-loop.md      # Human-in-the-loop RLHF pattern
│   └── raft-indexer.md       # Stream → classify → pre-index for agents
├── data-structures/
│   ├── cef-types.ts          # All CEF TypeScript interfaces
│   └── hierarchy.md          # Agent Service → Workspace → Stream → Deployment → Engagement
├── examples/
│   ├── eval-handler.ts       # Multi-model FAQ evaluator
│   ├── engagement-handler.ts # Event dispatcher with fan-out + consensus
│   ├── feedback-handler.ts   # Human feedback → score update
│   ├── cubby-helpers.ts      # Typed cubby wrappers with key builders
│   └── cubby-deltas.ts       # Change detection via content hashing
└── README.md
```

## Source

Extracted from [cere-io/razzmatazz](https://github.com/cere-io/razzmatazz) — a production-validated eval system on CEF.
