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
    cubbies: CEFCubbiesClient;
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

// ─── Cubbies (SQLite) ──────────────────────────────────────────────────────

/**
 * Result from a query() call (SELECT).
 */
export interface CEFQueryResult {
    columns: string[];
    rows: unknown[][];
    meta: { duration: number; rowsRead: number };
}

/**
 * Result from an exec() call (INSERT/UPDATE/DELETE).
 */
export interface CEFExecResult {
    rowsAffected: number;
    lastInsertId: number;
    meta: { duration: number; rowsRead: number };
}

/**
 * Handle to a single cubby (SQLite database), accessed via ctx.cubbies.{alias}.
 *
 * Overloaded signatures: if the first string argument contains a space,
 * it is treated as SQL and instanceId defaults to "default".
 * Otherwise the first argument is the instanceId.
 */
export interface CEFCubbyHandle {
    query(sql: string, params?: unknown[]): Promise<CEFQueryResult>;
    query(instanceId: string, sql: string, params?: unknown[]): Promise<CEFQueryResult>;
    exec(sql: string, params?: unknown[]): Promise<CEFExecResult>;
    exec(instanceId: string, sql: string, params?: unknown[]): Promise<CEFExecResult>;
}

/**
 * Dynamic proxy keyed by cubby alias. Aliases are defined in the cubby
 * definition and must be valid JS identifiers.
 */
export interface CEFCubbiesClient {
    [alias: string]: CEFCubbyHandle;
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
