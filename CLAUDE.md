# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

This is `@cef-ai/skills`, a package of AI coding skills for building agent services on the CEF AI platform. It is consumed by AI coding tools (Claude Code, Cursor, Codex) via:

```bash
bunx skills add cef-ai/skills
```

There is no application code, no build step, no tests. The repo contains only Markdown skill files and a package.json. The `"skills": "skills/"` field in package.json tells skill loaders where to find them.

## Repository Structure

```
├── package.json               # @cef-ai/skills package manifest
├── README.md                  # Install instructions and skill index
└── skills/
    ├── README.md              # Same as root README (for skill registry)
    ├── clientsdk/             # @cef-ai/client-sdk: events, queries, streams from external code
    ├── cli/                   # Config & deploy: cef.config.yaml schema, CLI commands, env vars
    ├── coding/
    │   ├── handlers/          # Runtime API: handler signature, CEFContext, V8 constraints
    │   ├── orchestration/     # Coordination: concierge, stream processor, fan-out, pipeline chain
    │   └── generation/        # Generation: 5-step process to produce a full project from a goal
    ├── inference/             # ML models: Qwen2-VL, Qwen3, Whisper, emotion, sentiment, YOLO, plate; calling patterns
    └── storage/               # Storage: SQLite query/exec, migrations, sqlite-vec, state patterns
```

Each skill is a single `SKILL.md` with YAML frontmatter (`name`, `description`) that determines when the AI tool loads it.

## Skill Ownership Rules

Each skill owns its domain content exactly once. Other skills cross-reference rather than duplicate. When content appears in multiple skills (e.g., `bytesToString()`, `retry()`), it is intentional: CEF handlers run in V8 isolates with no imports, so complete handler examples must include all helpers inline.

| Content | Owned By |
|-|-|
| @cef-ai/client-sdk setup, events, queries, streams, agreements | clientsdk |
| cef.config.yaml schema, deploy commands, env vars, naming conventions | cli |
| Handler signature, CEFEvent, CEFContext, entity hierarchy | coding/handlers |
| Multi-agent patterns, streams API, fan-out, pipeline chain | coding/orchestration |
| 5-step generation process, starter configs, handler templates | coding/generation |
| Model catalog, inference endpoints, request/response formats | inference |
| Cubby API (query/exec), migrations, sqlite-vec, state patterns | storage |

## Critical Domain Constraint

All CEF handler code must be fully inline. The runtime uses V8 isolates; `import` and `require` are not supported. Every `.ts` handler file must be self-contained. Code examples in skills must reflect this.

## Editing Skills

When modifying a skill:
- Keep the frontmatter `description` field accurate; it drives when the skill gets loaded
- Handler code examples must remain complete and copy-pasteable (all helpers inline)
- If adding content, check the ownership table above; put it in the owning skill
- Cross-references use bold skill names: `See **cli** for config schema`
- Do not add content that requires loading another skill to be useful; include enough inline for the AI to work independently
