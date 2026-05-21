# CEF AI Agent Skills

AI coding skills for building agent services on the [CEF AI](https://cef.ai) stack. Install into Claude Code, Cursor, Codex, or any AI coding tool that supports the Agent Skills standard.

## Install

```bash
npx skills add cef-ai/skills
```

## Skills

| Skill | Description |
|-|-|
| **cef-agent** | CEF vault agent anatomy: V8 isolate runtime, `ctx.*` API, event handling, cubby reads/writes, async-without-`setTimeout` patterns, `@cef-ai/agent-sdk` configuration |
| **cef-client** | Browser companion: Cere wallet connect, Vault SDK init, publishing events to an agent, polling the agent's cubby for results |
| **cef-widget** | Cere Sandbox widget folders: `window.WidgetSandbox` / `window.WidgetRuntime` contract, manifest shape, parent-bridged wallet signing, publish/archive flows |

## How It Works

Skills are automatically discovered by your AI coding assistant based on context. When you ask it to build a CEF agent, call a model, or manage cubby state, the relevant skill loads and provides CEF-specific guidance, code patterns, and production examples.

## Critical Constraint

All CEF handler code must be fully inline (no `import` or `require`). The runtime uses V8 isolates. Every skill enforces this rule.

## Links

- [CEF AI Platform](https://cef.ai)
- [ROB Control Plane](https://rob.compute.test.ddcdragon.com/)
