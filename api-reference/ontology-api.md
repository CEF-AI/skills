# Ontology API — ROB Resource Management

The Ontology API (via Orchestrator) manages the CEF resource hierarchy. Used to create, read, and manage agent services and all their child resources.

---

## Client Setup

```typescript
import { OntologyClientFactory, createApiModules } from '@your-package/api';

const clientFactory = new OntologyClientFactory({
  ontologyBaseUrl: 'https://compute.devnet.ddc-dragon.com/orchestrator',
});
const ontologyClient = clientFactory.getOntologyClient();
const api = createApiModules(ontologyClient);
```

---

## API Modules

### Agent Services

```typescript
// Create
const as = await api.agentServices.create({
  agentServicePubKey: 'pub-key',
  name: 'My Service',
  description: 'Description',
  bucketId: 12345,
});

// Get by ID
const service = await api.agentServices.getById('pub-key');

// Get full hierarchy (workspaces → streams → deployments → engagements)
const ontology = await api.agentServices.getHierarchy('pub-key');
```

### Workspaces

```typescript
const ws = await api.workspaces.create('as-pub-key', {
  agentServicePubKey: 'as-pub-key',
  name: 'My Workspace',
  description: 'Description',
  workspaceId: 'ws-id',
});
```

### Streams

```typescript
const stream = await api.streams.createWorkspaceStream('as-pub-key', 'ws-id', {
  agentServicePubKey: 'as-pub-key',
  workspaceId: 'ws-id',
  name: 'My Stream',
  description: 'Description',
  selectors: [],
});
```

### Cubbies

```typescript
// Create
const cubby = await api.cubbies.createCubby('as-pub-key', {
  name: 'my-cubby',
  alias: 'myAlias',
  description: 'Description',
  dataTypes: ['json', 'vector'],
});

// Create query on cubby
await api.cubbies.createCubbyQuery('as-pub-key', cubby.name, {
  name: 'get_data',
  tsCode: 'export default async (ctx, params) => { ... }',
  parameters: [{ name: 'id', type: 'string' }],
  returns: { type: 'object' },
});

// List cubbies
const cubbies = await api.cubbies.listCubbies('as-pub-key');

// Attach cubby to deployment
await api.cubbies.attachToCubby('as-pub-key', cubby.name, {
  targetId: 'deployment-id',
  targetType: 'deployment',
  accessMode: 'exclusive',
});
```

### Agents

```typescript
const agent = await api.agents.create('as-pub-key', {
  agentServicePubKey: 'as-pub-key',
  name: 'My Agent',
  description: 'Description',
  tasks: [{
    name: 'analyze',
    tsCode: 'export default async (ctx) => { ... }',
  }],
});
```

### Engagements

```typescript
const engagement = await api.engagements.create('as-pub-key', {
  name: 'My Engagement',
  description: 'Description',
  conciergeAgent: { /* agent config */ },
  version: '1.0',
  agentServicePubKey: 'as-pub-key',
});
```

### Deployments

```typescript
const deployment = await api.deployments.create('as-pub-key', 'stream-id', {
  engagements: [{
    id: 'engagement-id',
    rules: [
      { name: 'priority', value: 1 },
      { name: 'weight', value: 100 },
    ],
  }],
  name: 'My Deployment',
  description: 'Description',
  isActive: true,
  triggers: [{ eventType: 'myEvent' }],
  streamId: 'stream-id',
});
```

### Rafts

Rafts are created via the Orchestrator API directly (not through the ontology modules):

```typescript
const raft = await createRaft(
  'as-pub-key',
  'stream-id',
  {
    alias: `raft_${Date.now()}`,
    matchExpression: '',
    tsCode: 'export default function(data) { return data; }',
  },
  ontologyClient,
);
```

---

## Tenant Monitor (Jobs & Activities)

```typescript
// Get jobs for a workspace
const jobs = await api.tenantMonitor.getWorkspaceJobs('as-pub-key', 'ws-id');
// Response: { items: Job[] } or { jobs: Job[] }

// Get activities for a job
const activities = await api.tenantMonitor.getJobActivities('as-pub-key', 'ws-id', 'job-id');
// Response: { items: Activity[] } or { activities: Activity[] }

// Get logs for an activity
const logs = await api.tenantMonitor.getJobActivityLogs('as-pub-key', 'ws-id', 'job-id', 'activity-id');
// Response: { logs: Log[] }
```

---

## Service URLs

| Service | Docker | Devnet |
|---------|--------|--------|
| Orchestrator | `http://orchestrator:8080` | `https://compute.devnet.ddc-dragon.com/orchestrator` |
| Event Runtime | `http://event-runtime:8084` | `https://compute.devnet.ddc-dragon.com/event` |
| SIS | `http://sis:8085` | `https://compute.devnet.ddc-dragon.com/sis` |
| Agent Runtime | `http://agent-runtime:8082` | `https://compute.devnet.ddc-dragon.com/agent` |

---

## Creation Order (dependencies)

```
1. Agent Service
2. Workspace (needs agent service)
3. Stream (needs workspace)
4. Cubbies (needs agent service, independent of workspace)
5. Rafts (needs stream, via orchestrator)
6. Agent (needs agent service)
7. Engagement (needs agent service, references cubby)
8. Deployment (needs stream + engagement, attach cubbies after)
```
