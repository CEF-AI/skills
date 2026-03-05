# CEF Intelligence

Reference documentation for building agent services on the CEF stack. This knowledge base enables both human developers and LLMs to design, generate, and deploy complete CEF topologies from natural language goals.

---

## Quick Start

**If you're building a new agent service:**

1. Read `hierarchy/entity-model.md` — understand the entity hierarchy (workspace, stream, engagement, agent, task, cubby)
2. Read `hierarchy/config-schema.md` — understand the `cef.config.yaml` format and directory layout
3. Browse `patterns/` — pick the patterns that match your use case
4. Browse `models/inference-catalog.md` — find models for your capabilities
5. Look at `examples/` — see complete, deployable reference projects

**If you're generating a topology from a natural language goal:**

1. Read `generation/system-prompt.md` — the full instruction set for NLP-driven generation
2. Follow the 5-step process: decompose → select patterns → select models → design entity graph → generate project
3. Use `generation/templates/` as starters for common categories

---

## Critical Runtime Constraint

**All handler code must be fully inline.** The CEF Agent Runtime (V8 isolates) does not support `import` or `require`. Every `.ts` handler file must define all its types, constants, helpers, and logic inside the same file. The only external API is `context.*` injected at runtime.

---

## Structure

```
intelligence/
├── README.md                              ← You are here
│
├── hierarchy/                             ← Entity model and config schema
│   ├── entity-model.md                   ← Workspace > Stream > Deployment > Engagement > Agent > Task > Cubby
│   └── config-schema.md                  ← cef.config.yaml reference + directory layout convention
│
├── api-reference/                         ← CEF runtime APIs (available inside handlers)
│   ├── cef-context.md                    ← CEFEvent, CEFContext, fetch, handler signature
│   ├── cubby-api.md                      ← JSON store, vector store, primitives, TTL
│   ├── streams-api.md                    ← Stream subscription, event types
│   └── agent-to-agent.md                ← Dynamic proxy, fan-out, error handling
│
├── patterns/                              ← Composable architecture patterns
│   ├── concierge-orchestrator.md         ← Multi-agent coordination
│   ├── inference-worker.md               ← Single-model inference task
│   ├── stream-processor.md               ← Long-running stream subscription
│   ├── cubby-state-machine.md            ← Read-process-write state management
│   ├── fan-out-aggregate.md              ← Parallel agent calls + aggregation
│   └── pipeline-chain.md                ← Sequential A → B → C processing
│
├── models/                                ← Inference model catalog
│   └── inference-catalog.md              ← Known models, request formats, bring-your-own
│
├── data-structures/                       ← Type definitions (REFERENCE ONLY — not importable)
│   ├── cef-types.ts                      ← CEFEvent, CEFContext, handler signature
│   └── hierarchy-types.ts               ← CefConfig, AgentConfig, TaskConfig (from CLI)
│
├── examples/                              ← Complete, deployable reference projects
│   ├── nightingale-drone-surveillance/   ← Multi-stream drone + YOLO + violation detection
│   ├── gaming-demo-analytics/            ← Audio pipeline + topic trees + pattern analysis
│   └── github-notion-sync/              ← SaaS bridge: GitHub PR → LLM → Notion
│
└── generation/                            ← NLP generation guidance
    ├── system-prompt.md                  ← Instructions for LLM-driven topology generation
    └── templates/                        ← YAML starter configs by use case
        ├── object-detection.yaml
        ├── nlp-pipeline.yaml
        ├── data-sync.yaml
        └── real-time-analytics.yaml
```

---

## Storage Model

| Store | API | Use For |
|-------|-----|---------|
| **Cubby** | `context.cubby(name)` | Long-term state, agent-to-agent sharing, query-accessible data |

---

## Sources

- Handler/runtime: Production agents in `Agents/Gaming Demo Agents/`, `Agents/Nightingale Agents/`, `Agents/Project-Tazz-Execution-Log-Tracker/`
- Deploy CLI: `CLI/cef-deploy/`
- Config schema: `CLI/cef-deploy/src/types.ts`
# Agent-Service-Intelligence
