# Fan-Out Pattern

Run N agents in parallel, collect results, compute consensus.

---

## Pattern

```
Event arrives
    │
    ├─→ Agent A (gemini)    ─┐
    ├─→ Agent B (llama)      ├─→ Collect results → Compute consensus
    └─→ Agent C (claude)    ─┘
```

## Implementation

### 1. Fan-out to agents

```typescript
const EVAL_AGENTS = ['gemini', 'llama', 'claude'] as const;

const agentResults = await Promise.all(
  EVAL_AGENTS.map(async (agentId) => {
    try {
      const agent = context.agents[`evaluator_${agentId}`];
      const result = await agent.evaluate(payload);
      return { agentId, result, error: null };
    } catch (err) {
      context.log(`agent ${agentId} failed: ${err}`);
      return { agentId, result: null, error: String(err) };
    }
  }),
);
```

### 2. Compute consensus

```typescript
const scores: Record<string, { quality: number }> = {};
const respondingAgents: string[] = [];

for (const agentId of EVAL_AGENTS) {
  const latest = await getAgentLatestVersion(cubby, itemId, agentId);
  if (latest) {
    scores[agentId] = { quality: latest.scores.quality };
    respondingAgents.push(agentId);
  }
}

const values = Object.values(scores).map(s => s.quality);
const avg = values.reduce((a, b) => a + b, 0) / values.length;
const divergence = Math.max(...values) - Math.min(...values);
const bestAgent = respondingAgents.reduce((best, id) =>
  scores[id].quality > (scores[best]?.quality ?? 0) ? id : best
);

const consensus = {
  item_id: itemId,
  agents: respondingAgents,
  scores,
  avg_quality: avg,
  divergence,       // 0 = unanimous, >0.3 = significant disagreement
  best_agent: bestAgent,
  timestamp: new Date().toISOString(),
};

await cubby.json.set(`item:${itemId}/consensus`, consensus);
```

### 3. Handle partial failures

- Some agents may fail — that's OK
- Compute consensus from responding agents only
- Log failures but don't abort the whole job
- Consider a minimum threshold (e.g., at least 2 agents must respond)

---

## When to Use

- Multi-model evaluation (same question, different LLMs)
- Ensemble scoring (combine multiple perspectives)
- Redundancy (at least one agent should succeed)
- Quality comparison (which model is best for this task?)
