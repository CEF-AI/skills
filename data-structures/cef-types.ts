/**
 * CEF Type Definitions
 *
 * Source: Notion docs + production agent validation (Game-Demo-Agent-Service)
 * See: .agent/rules/cef-context.md for full API reference
 */

// ── Handler ──

export type CEFHandlerFn<TResult = unknown> = (
  event: CEFEvent,
  context: CEFContext,
) => Promise<TResult>;

// ── Event ──

export interface CEFEvent {
  payload: Record<string, unknown>;
  id?: string;
  event_type?: string;
  app_id?: string;
  account_id?: string;
  timestamp?: string;
  signature?: string;
  context_path?: {
    agent_service: string;
    workspace: string;
    stream?: string;
  };
}

// ── Context ──

export interface CEFContext {
  log(...args: unknown[]): void;
  cubby(name: string): CEFCubbyInstance;
  kv: CEFKVClient;
  agents: CEFAgentClient;
  streams: CEFStreamsClient;
  fetch(url: string, options?: CEFFetchOptions): Promise<CEFFetchResponse>;
  emit?(eventType: string, payload: Record<string, unknown>, targetId?: string): void;
  models?: CEFModelClient;
  storage?: CEFStorageClient;
  path?: {
    agentServicePubKey: string;
    workspaceId: string;
  };
}

// ── Cubby ──

export interface CEFCubbyInstance {
  json: CEFCubbyJsonStore;
  vector: CEFCubbyVectorStore;
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  del(key: string): Promise<void>;
  expire(key: string, seconds: number): Promise<void>;
}

export interface CEFCubbyJsonStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
}

export interface CEFCubbyVectorStore {
  add(id: string, embedding: number[], metadata?: Record<string, unknown>): Promise<void>;
  get(id: string): Promise<{ vector: number[]; metadata?: Record<string, unknown> } | null>;
  search(
    vector: number[],
    options?: { limit?: number; filter?: Record<string, unknown> },
  ): Promise<Array<{ id: string; score: number; metadata?: Record<string, unknown> }>>;
  createIndex(config: { dimension: number }): Promise<void>;
}

// ── Agents ──

export interface CEFAgentProxy {
  [method: string]: (input: unknown) => Promise<unknown>;
}

export interface CEFAgentClient {
  [agentAlias: string]: CEFAgentProxy;
}

// ── Streams ──

export interface CEFStreamPacket {
  payload: Uint8Array;
}

export interface CEFStreamsClient {
  subscribe(streamId: string): Promise<AsyncIterable<CEFStreamPacket>>;
}

// ── Fetch ──

export interface CEFFetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
  headers?: Record<string, string>;
}

export interface CEFFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

// ── RAFT KV ──

export interface CEFKVClient {
  hset(key: string, fields: Record<string, string>): Promise<void>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  rpush(key: string, value: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  incr(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

// ── Optional (documented, not in production) ──

export interface CEFModelClient {
  infer(modelId: string, input: unknown): Promise<unknown>;
}

export interface CEFStorageClient {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
