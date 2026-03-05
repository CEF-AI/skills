/**
 * CEF Runtime Type Definitions — REFERENCE ONLY
 *
 * These types describe the shapes injected by the CEF Agent Runtime.
 * DO NOT import this file in handlers — it exists purely as documentation.
 * All handlers run in V8 isolates with no module system.
 *
 * The runtime injects `event` and `context` into every handler's `handle()` function.
 */

// ─── Event ─────────────────────────────────────────────────────────────────

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

// ─── Context ───────────────────────────────────────────────────────────────

export interface CEFContext {
    log(...args: unknown[]): void;
    cubby(name: string): CEFCubbyInstance;
    agents: CEFAgentClient;
    streams: CEFStreamsClient;
    fetch(url: string, options?: CEFFetchOptions): Promise<CEFFetchResponse>;
    path?: { agentServicePubKey: string; workspaceId: string };
}

// ─── Handler Signature ─────────────────────────────────────────────────────

export type CEFHandlerFn<TResult = unknown> = (
    event: CEFEvent,
    context: CEFContext,
) => Promise<TResult>;

// ─── Fetch ─────────────────────────────────────────────────────────────────

export interface CEFFetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}

export interface CEFFetchResponse {
    ok: boolean;
    status: number;
    statusText?: string;
    json(): Promise<unknown>;
    text(): Promise<string>;
    headers?: Record<string, string>;
}

// ─── Cubby ─────────────────────────────────────────────────────────────────

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
    mget?(keys: string[]): Promise<Record<string, unknown>>;
    mset?(entries: Record<string, unknown>): Promise<void>;
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

// ─── Agent-to-Agent ────────────────────────────────────────────────────────

export interface CEFAgentProxy {
    [method: string]: (input: unknown) => Promise<unknown>;
}

export interface CEFAgentClient {
    [agentAlias: string]: CEFAgentProxy;
}

// ─── Streams ───────────────────────────────────────────────────────────────

export interface CEFStreamPacket {
    payload: Uint8Array;
    sequenceNum?: number;
}

export interface CEFStreamsClient {
    subscribe(streamId: string): Promise<AsyncIterable<CEFStreamPacket>>;
}
