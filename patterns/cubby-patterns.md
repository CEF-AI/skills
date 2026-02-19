# Cubby Patterns

Practical patterns for using Cubbies in CEF agent services.

---

## Key Builder Pattern

Create a `keys` object to centralize key schemas. Prevents typos, makes refactoring easy.

```typescript
export const keys = {
  faqAgent: (questionId: string, agentId: string) =>
    `faq:${questionId}/agent:${agentId}`,
  faqAgentLatest: (questionId: string, agentId: string) =>
    `faq:${questionId}/agent:${agentId}/latest`,
  faqConsensus: (questionId: string) =>
    `faq:${questionId}/consensus`,
  faqMapping: () => 'config:faq_mapping',
  lastRun: (agentId: string) => `meta:last_run:${agentId}`,
} as const;
```

---

## Typed Wrapper Pattern

Wrap raw cubby operations with domain-specific, typed functions:

```typescript
export async function getRecord(
  cubby: CEFCubbyInstance,
  id: string,
): Promise<MyRecord | null> {
  const data = await cubby.json.get(keys.record(id));
  return data as MyRecord | null;
}

export async function setRecord(
  cubby: CEFCubbyInstance,
  id: string,
  record: MyRecord,
): Promise<void> {
  await cubby.json.set(keys.record(id), record);
}
```

---

## Versioned History Pattern

Store versions as an array inside the record, with a "latest" pointer for fast access:

```typescript
// Append new version (unshift = newest first)
record.versions.unshift(newVersion);
await cubby.json.set(keys.record(id), record);

// Update latest pointer (fast reads without loading full history)
await cubby.json.set(keys.recordLatest(id), newVersion);
```

---

## Change Detection Pattern

Hash content to detect actual changes (avoid processing identical content):

```typescript
import { createHash } from 'crypto';

function hashContent(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

async function hasChanged(cubby: CEFCubbyInstance, id: string, content: string): boolean {
  const existing = await cubby.json.get(keys.page(id));
  if (!existing) return true;  // first time = changed
  return existing.contentHash !== hashContent(content);
}
```

---

## Separate Cubbies by Concern

Different data has different lifetimes:

| Cubby | TTL | Content |
|-------|-----|---------|
| `{domain}-intermediate` | Short (1h) | Job results, temp state |
| `{domain}-archive` | Permanent | Versioned history, best results |
| `{domain}-config` | Permanent | Mappings, settings |

```typescript
const intermediateCubby = context.cubby('sot-intermediate');
const archiveCubby = context.cubby('sot-archive');
```

---

## Stats/Counter Pattern

Track running totals alongside your data:

```typescript
const stats = await cubby.json.get('stats:processing') || {
  total: 0,
  lastProcessedAt: '',
};
stats.total += 1;
stats.lastProcessedAt = new Date().toISOString();
await cubby.json.set('stats:processing', stats);
```
