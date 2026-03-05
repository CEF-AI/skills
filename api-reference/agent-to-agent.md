# Agent-to-Agent Calls

CEF provides a dynamic proxy for inter-agent communication within an agent service.

---

## Dynamic Proxy Pattern

```typescript
interface CEFAgentProxy {
  [method: string]: (input: unknown) => Promise<unknown>;
}

interface CEFAgentClient {
  [agentAlias: string]: CEFAgentProxy;
}
```

### Usage

```typescript
// Call another agent by its alias (set during deployment)
const result = await context.agents.embeddingAgent.embed({ texts: ['hello'] });
const topic = await context.agents.topicAgent.matchTopic({ embedding, threshold: 0.8 });
```

### How it works

- Agent aliases are configured at deployment time (use dot notation: `context.agents.<alias>.<task>(payload)`)
- Method calls on the proxy trigger HTTP calls to the target agent's handler
- The target agent receives the call as a normal `CEFEvent` with the method args as payload

### Error handling

```typescript
try {
  const result = await context.agents.myAgent.doWork(payload);
} catch (err) {
  context.log(`Agent call failed: ${err}`);
  // Handle gracefully — agent may be down or overloaded
}
```

### Naming convention

- Use descriptive aliases: `sotEvaluator_gemini`, `embeddingAgent`, `topicClassifier`
- The alias maps to a deployment within the same agent service
- Each deployment runs the same or different handler code
