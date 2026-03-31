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
| **cli** | cef.config.yaml schema, deploy commands, environment variables, naming conventions |
| **coding** | Handler signature, runtime API (CEFContext), entity hierarchy, V8 constraints, orchestration patterns, topology generation |
| **inference** | ML model catalog (Qwen2-VL, Qwen3 embeddings, Whisper, emotion, sentiment, YOLO, plate detection, OCR) and calling patterns |
| **storage** | Cubby API (SQLite query/exec, migrations, sqlite-vec), state machine, dedup, SQL patterns |

## How It Works

Skills are automatically discovered by your AI coding assistant based on context. When you ask it to build a CEF agent, call a model, or manage cubby state, the relevant skill loads and provides CEF-specific guidance, code patterns, and production examples.

## Critical Constraint

All CEF handler code must be fully inline (no `import` or `require`). The runtime uses V8 isolates. Every skill enforces this rule.

## Links

- [CEF AI Platform](https://cef.ai)
- [ROB Control Plane](https://rob.stage.cere.io/)
