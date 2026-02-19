/**
 * E2E Test Reference — Full deployment validity + execution flow
 *
 * This is a reference test showing the complete lifecycle:
 * 1. Create agent service → workspace → stream → cubbies → rafts → agent → engagement → deployment
 * 2. Send events via SDK → verify jobs → query cubby data → check activity logs
 *
 * Source: Vasanth's e2e test harness (Feb 2026)
 */

// ── SETUP ──

// URL configuration (Docker vs devnet)
const ONTOLOGY_BASE_URL = process.env.DDC_COMPUTE_URL
  || (process.env.DOCKER_ENV ? 'http://orchestrator:8080' : 'https://compute.devnet.ddc-dragon.com/orchestrator');
const EVENT_RUNTIME_URL = process.env.EVENT_RUNTIME_URL
  || (process.env.DOCKER_ENV ? 'http://event-runtime:8084' : 'https://compute.devnet.ddc-dragon.com/event');
const SIS_API_URL = process.env.SIS_API_URL
  || (process.env.DOCKER_ENV ? 'http://sis:8085' : 'https://compute.devnet.ddc-dragon.com/sis');
const AGENT_RUNTIME_URL = process.env.AGENT_RUNTIME_URL
  || (process.env.DOCKER_ENV ? 'http://agent-runtime:8082' : 'https://compute.devnet.ddc-dragon.com/agent');

// ── PHASE 1: DEPLOYMENT VALIDITY (ROB + Topology) ──

// 1. Create Agent Service
const agentService = await api.agentServices.create({
  agentServicePubKey: testIds.agentServicePubKey,
  name: 'My Agent Service',
  description: 'Description',
  bucketId: 12345,
});

// 2. Create Workspace
const workspace = await api.workspaces.create(agentService.agentServicePubKey, {
  agentServicePubKey: agentService.agentServicePubKey,
  name: 'My Workspace',
  description: 'Description',
  workspaceId: testIds.workspaceId,
});

// 3. Create Stream
const stream = await api.streams.createWorkspaceStream(
  agentService.agentServicePubKey,
  workspace.workspaceId,
  {
    agentServicePubKey: agentService.agentServicePubKey,
    workspaceId: workspace.workspaceId,
    name: 'My Stream',
    description: 'Description',
    selectors: [],
  },
);

// 4. Create Cubbies (with optional queries)
const cubby = await api.cubbies.createCubby(agentService.agentServicePubKey, {
  name: 'my-cubby',
  alias: 'myAlias',
  description: 'Description',
  dataTypes: ['json', 'vector'],
});

// Create cubby queries
await api.cubbies.createCubbyQuery(agentService.agentServicePubKey, cubby.name, {
  name: 'get_data',
  tsCode: 'export default async (ctx, params) => { ... }',
  parameters: [{ name: 'id', type: 'string' }],
  returns: { type: 'object' },
});

// 5. Create Rafts (via Orchestrator API, not ontology)
const raft = await createRaft(
  agentService.agentServicePubKey,
  stream.streamId,
  {
    alias: `raft_${Date.now()}`,
    matchExpression: '',
    tsCode: 'export default function(data) { return data; }',
  },
  ontologyClient,
);

// 6. Create Agent
const agent = await api.agents.create(agentService.agentServicePubKey, {
  agentServicePubKey: agentService.agentServicePubKey,
  name: 'My Agent',
  description: 'Description',
  tasks: [{ name: 'analyze', tsCode: 'export default async (ctx) => { ... }' }],
});

// 7. Create Engagement
const engagement = await api.engagements.create(agentService.agentServicePubKey, {
  name: 'My Engagement',
  description: 'Description',
  conciergeAgent: { /* agent config referencing cubby */ },
  version: '1.0',
  agentServicePubKey: agentService.agentServicePubKey,
});

// 8. Create Deployment (links stream → engagement)
const deployment = await api.deployments.create(
  agentService.agentServicePubKey,
  stream.streamId,
  {
    engagements: [{
      id: engagement.engagementId,
      rules: [
        { name: 'priority', value: 1 },
        { name: 'weight', value: 100 },
      ],
    }],
    name: 'My Deployment',
    description: 'Description',
    isActive: true,
    triggers: [{ eventType: 'analyzeFirstTimeUsers' }],
    streamId: stream.streamId,
  },
);

// 9. Attach Cubbies to Deployment
await api.cubbies.attachToCubby(agentService.agentServicePubKey, cubby.name, {
  targetId: deployment.deploymentId,
  targetType: 'deployment',
  accessMode: 'exclusive',
});

// 10. Verify Ontology (full hierarchy)
const ontology = await api.agentServices.getHierarchy(agentService.agentServicePubKey);
// ontology.workspaces[].streams[].deployments[].engagements[]

// ── PHASE 2: RUNTIME EXECUTION (Event → Job → Query) ──

// 11. Initialize Client SDK
const sdk = new ClientSdk({
  url: ONTOLOGY_BASE_URL,
  webTransportUrl: SIS_API_URL,
  eventRuntimeUrl: EVENT_RUNTIME_URL,
  sisUrl: SIS_API_URL,
  agentRuntimeUrl: AGENT_RUNTIME_URL,
  context: {
    agent_service: agentService.agentServicePubKey,
    workspace: workspace.workspaceId,
    stream: stream.streamId,
  },
  wallet: 'mnemonic phrase here',
});

// 12. Create data stream + send event
const dataStream = await sdk.stream.create();
const eventResponse = await sdk.event.create('analyzeFirstTimeUsers', {
  gameTextStreamId: dataStream.id,
  userId: 'test-user-123',
  gameId: 'test-game-456',
  action: 'game_start',
  score: 1000,
  timestamp: new Date().toISOString(),
});
// eventResponse.status === 'accepted'

// 13. Query cubby data
const queryResult = await sdk.query.fetch(cubby.name, 'get_data', { id: 'test-123' });

// 14. Stream data via publisher (WebTransport — browser only)
const publisher = await sdk.stream.publisher(dataStream.id);
await publisher.send({
  message: { type: 'TEXT_CHUNK', text: 'hello', mimeType: 'application/json' },
  index: Date.now(),
});

// 15. Verify jobs were created
const jobsResponse = await api.tenantMonitor.getWorkspaceJobs(
  agentService.agentServicePubKey,
  workspace.workspaceId,
);
const jobs = jobsResponse.items || jobsResponse.jobs || [];

// 16. Fetch activity logs for a job
if (jobs.length > 0) {
  const activities = await api.tenantMonitor.getJobActivities(
    agentService.agentServicePubKey,
    workspace.workspaceId,
    jobs[0].jobId,
  );
  const activityItems = activities.items || activities.activities || [];

  if (activityItems.length > 0) {
    const logs = await api.tenantMonitor.getJobActivityLogs(
      agentService.agentServicePubKey,
      workspace.workspaceId,
      jobs[0].jobId,
      activityItems[0].id,
    );
  }
}
