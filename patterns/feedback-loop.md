# Human Feedback Loop (RLHF Pattern)

Human scores anchor the multi-model benchmark. Agent scores drift; human corrections pull them back.

---

## Flow

```
Agent evaluates → scores.human = null (pending)
    │
Human reviews → agree | override | flag
    │
    ├─ agree:    scores.human = agent's quality score
    ├─ override: scores.human = human-provided score
    └─ flag:     mark for re-evaluation
    │
Record updated → best_verified_by = 'human'
```

## Handler

```typescript
export const handle: CEFHandlerFn = async (event, context) => {
  const { faq_id, agent_id, version, action, human_score, reviewer } = event.payload;
  
  const cubby = context.cubby('myStore');
  const record = await getRecord(cubby, faq_id, agent_id);
  
  const evalVersion = record.versions.find(v => v.version === version);
  
  if (action === 'agree') {
    evalVersion.scores.human = evalVersion.scores.quality;
  } else if (action === 'override') {
    evalVersion.scores.human = human_score;
  }
  
  record.best_version = version;
  record.best_verified_by = 'human';
  
  await cubby.json.set(keys.record(faq_id, agent_id), record);
};
```

## Key Points

- Human feedback is **ground truth** — always takes precedence
- Store feedback with timestamp and reviewer for audit trail
- Update both the version scores AND the record-level best pointer
- Human-verified versions should influence future `vs_previous` comparisons
