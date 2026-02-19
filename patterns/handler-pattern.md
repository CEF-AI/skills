# Handler Pattern

Every CEF agent is a single file that exports a `handle` function.

---

## Minimal Handler

```typescript
import type { CEFHandlerFn, CEFEvent, CEFContext } from './types/cef';

export const handle: CEFHandlerFn = async (event: CEFEvent, context: CEFContext) => {
  const payload = event.payload as Record<string, unknown>;
  
  context.log(`handler: received event`);
  
  // Do work...
  
  return { success: true };
};

export default handle;
```

---

## Event Dispatch Pattern

When a handler processes multiple event types:

```typescript
export const handle: CEFHandlerFn = async (event: CEFEvent, context: CEFContext) => {
  const payload = event.payload as Record<string, unknown>;
  const eventType = payload.event_type as string;

  switch (eventType) {
    case 'PAGE_CHANGE':
      return handlePageChange(payload, context);
    case 'BATCH_EVAL':
      return handleBatchEval(payload, context);
    default:
      context.log(`unknown event_type: ${eventType}`);
      return { skipped: true, reason: `unknown: ${eventType}` };
  }
};
```

---

## Structured Response

Always return a result object — the runtime and observability tools use it:

```typescript
return {
  agent_id: agentId,
  faqs_evaluated: results.length,
  avg_quality: 0.85,
  duration_ms: Date.now() - startTime,
  results,
};
```

---

## Error Handling

- **Per-item errors**: Catch inside loops, log, continue with remaining items
- **Fatal errors**: Let them throw — runtime handles uncaught exceptions
- **Agent call errors**: Always try/catch `context.agents.*` calls (remote agents can fail)

```typescript
for (const item of items) {
  try {
    await processItem(item, context);
  } catch (err) {
    context.log(`failed on ${item.id}: ${err}`);
    // Continue with next item
  }
}
```

---

## Logging

```typescript
// Use context.log — it's the only logging mechanism in V8 isolates
context.log(`handler[${agentId}]: processing ${items.length} items`);

// Single string arg — no console.log, no structured logging
context.log(`result: quality=${score.toFixed(2)}, duration=${ms}ms`);
```
