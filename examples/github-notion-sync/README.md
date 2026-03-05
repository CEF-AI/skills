# GitHub-Notion Sync — SaaS Bridge Pattern

An agent pipeline that receives GitHub PR events, analyzes them with an LLM, and writes structured entries to a Notion page.

## Goal

"When a PR is merged/opened/closed on GitHub, analyze it with an LLM to determine if it's worth logging, then write a structured activity record to a Notion page."

## Architecture

```
GitHub webhook (PR event)
  → GitHub Action sends payload to CEF event stream
    → Engagement: concierge receives PR event
      → Validate + dedup (cubby)
      → Agent: PR Analysis (LLM) → should_log, summary, category
      → Map to generic ActivityRecord
      → Agent: Notion Writer → write entry to Notion page
      → Mark as processed (cubby dedup)
```

## Entity Graph

| Entity | Name | Alias | Purpose |
|--------|------|-------|---------|
| Engagement | Execution Log Concierge | — | Orchestrates PR → analysis → Notion write |
| Agent | PR Analysis | `prAnalysisAgent` | LLM-based PR analysis |
| Task | Analyze | `analyze` | Determines if PR should be logged |
| Agent | Notion | `notionAgent` | Reads/writes Notion pages |
| Task | Write Entry | `writeEntry` | Writes ActivityRecord to Notion |
| Task | Read Page | `readPage` | Reads Notion page blocks |
| Cubby | executionLog | — | Dedup store for processed events |

## Patterns Used

- **Concierge orchestrator** — linear flow: validate → analyze → map → write
- **Inference worker** — PR analysis agent wraps LLM inference
- **Cubby state machine** — dedup via cubby primitive (set/get string keys)

## Key Implementation Details

- The concierge uses a **source-agnostic mapping layer**: GitHub PR data is mapped to a generic `ActivityRecord` format. To add GitLab or Bitbucket, only the mapping changes.
- Deduplication uses cubby primitive strings: `cubby.set(dedupKey, ...)` and `cubby.get(dedupKey)` for fast existence checks
- The PR analysis agent returns `{ should_log, summary, category }` — if `should_log` is false, the pipeline exits early
- The Notion agent uses `context.fetch()` to call the Notion API directly (external API access via fetch)
