# Queries — Reading Cubby Data from Outside

Named queries let external clients read cubby data through the agent runtime API.

---

## Fetch a Query

```typescript
const result = await sdk.query.fetch(
  'cubby-name',        // which cubby
  'query-name',        // named query to execute
  { faqId: 'faq_001' }, // parameters (optional)
  60000,               // timeout in ms (default: 60000)
);
```

### API endpoint

```
POST {agentRuntimeUrl}/api/v1/agent-services/{asPubKey}/cubbies/{cubbyName}/queries/{queryName}
```

### Request body

```json
{
  "params": { "faqId": "faq_001" },
  "timeoutMs": 60000
}
```

### Response

On success, returns `result.data` from the response. Falls back to full JSON if no `result.data` field.

---

## Error Handling

```typescript
import { CubbyRequestError, CubbyTimeoutError } from '@cef-ai/client-sdk';

try {
  const data = await sdk.query.fetch('myStore', 'getBest', { id: 'faq_001' });
} catch (err) {
  if (err instanceof CubbyTimeoutError) {
    console.log('Query timed out');
  } else if (err instanceof CubbyRequestError) {
    console.log(`Query failed: ${err.message} (${err.status})`);
  }
}
```

| Error | When |
|-------|------|
| `CubbyRequestError` | Non-2xx response from agent runtime |
| `CubbyTimeoutError` | Request exceeded `timeoutMs` |
