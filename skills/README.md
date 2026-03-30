# CEF AI Agent Skills

AI coding skills for building agent services on the [CEF AI](https://cef.ai) stack. Install into Claude Code, Cursor, Codex, or any AI coding tool that supports the Agent Skills standard.

## Install

```bash
bunx skills add cef-ai/skills
```

## Skills

| Skill | Description |
|-|-|
| **cef-agent-basics** | Entity hierarchy, project structure, config schema, handler signature, V8 constraints |
| **cef-inference** | ML model catalog (YOLO, Whisper, Qwen3, sentiment, LLM) and calling patterns |
| **cef-cubby-state** | Cubby API (SQLite query/exec, migrations, sqlite-vec), state machine, dedup, SQL patterns |
| **cef-orchestration** | Multi-agent coordination, streams, fan-out, pipeline chains |
| **cef-generate-topology** | Generate a complete CEF project from a natural language goal |

## How It Works

Skills are automatically discovered by your AI coding assistant based on context. When you ask it to build a CEF agent, call a model, or manage cubby state, the relevant skill loads and provides CEF-specific guidance, code patterns, and production examples.

## Critical Constraint

All CEF handler code must be fully inline (no `import` or `require`). The runtime uses V8 isolates. Every skill enforces this rule.

## Links

- [CEF AI Platform](https://cef.ai)
- [ROB Control Plane](https://rob.stage.cere.io/)
