# CEF AI Agent Skills

AI coding skills for building agent services on the [CEF AI](https://cef.ai) stack. Install into Claude Code, Cursor, Codex, or any AI coding tool that supports the Agent Skills standard.

## Install

```bash
bunx skills add cef-ai/skills
```

## Skills

| Skill | Description |
|-|-|
| **clientsdk** | Connect external code to CEF via `@cef-ai/client-sdk`: send events, query cubbies, subscribe to streams |
| **cli** | Config schema, deploy/delete/clone commands, local dev server (`cef dev`), local automated testing, playground testing, environment variables, naming conventions |
| **coding** | Handler signature, Context API (`context.models/.agents/.cubbies/.streams/.rafts/.image/.emit/.fetch/.workspace/.log`), entity hierarchy, V8 constraints, orchestration patterns, topology generation |
| **inference** | `context.models.<alias>.infer/.stream` and the 16-model catalog (yolo, yoloXL, whisper, whisperTiny, whisperLarge, llm, mistral7b, mistralSmall, qwenCoder, qwenVision, llamaVision, embedding, emotionClassifier, sentimentAnalysis, plateDetector, plateOcr) — per-model input/output schemas, streaming usage, and production examples |
| **storage** | Cubby API (SQLite query/exec, migrations, sqlite-vec), state machine, dedup, SQL patterns |

## How It Works

Skills are automatically discovered by your AI coding assistant based on context. When you ask it to build a CEF agent, call a model, or manage cubby state, the relevant skill loads and provides CEF-specific guidance, code patterns, and production examples.

## Critical Constraint

All CEF handler code must be fully inline (no `import` or `require`). The runtime uses V8 isolates. Every skill enforces this rule.

## Links

- [CEF AI Platform](https://cef.ai)
- [ROB Control Plane](https://rob.stage.cere.io/)
