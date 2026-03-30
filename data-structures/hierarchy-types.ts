/**
 * CEF Deploy Config Type Definitions — REFERENCE ONLY
 *
 * These types describe the cef.config.yaml schema used by the cef-deploy CLI.
 * DO NOT import this file — it exists purely as documentation.
 *
 * Source of truth: CLI/cef-deploy/src/types.ts
 */

// ─── Config Schema ─────────────────────────────────────────────────────────

export interface CefConfig {
    agentServicePubKey: string;
    agentServiceId?: string;
    workspaces?: WorkspaceConfig[];
    engagements?: EngagementConfig[];
    agents?: AgentConfig[];
    cubbies?: CubbyConfig[];
}

export interface WorkspaceConfig {
    name: string;
    description?: string;
    workspaceId?: string;
    streams?: StreamConfig[];
}

export interface StreamConfig {
    name: string;
    description?: string;
    streamId?: string;
    selectors?: SelectorConfig[];
    deployments?: DeploymentConfig[];
}

export interface SelectorConfig {
    name: string;
    conditions: string[];
}

export interface DeploymentConfig {
    name: string;
    description?: string;
    deploymentId?: string;
    engagement: string;     // name reference — resolved to engagementId at deploy time
    isActive?: boolean;
    triggers?: TriggerConfig[];
    engagementRules?: unknown[];
}

export interface TriggerConfig {
    name: string;
    conditions: string[];
}

export interface EngagementConfig {
    name: string;
    description?: string;
    engagementId?: string;
    file: string;           // relative path to .ts handler
    version?: string;
}

export interface AgentConfig {
    name: string;
    alias: string;          // camelCase — used in context.agents.<alias>
    description?: string;
    agentId?: string;
    version?: string;
    tasks: TaskConfig[];
}

export interface TaskConfig {
    name: string;
    alias: string;          // camelCase — used in context.agents.<agentAlias>.<taskAlias>()
    file: string;           // relative path to .ts handler
    parameters?: Record<string, unknown>;  // JSON Schema
    returns?: Record<string, unknown>;     // JSON Schema
}

export interface CubbyConfig {
    alias: string;          // camelCase -- used in ctx.cubbies.<alias>
    name: string;
    description?: string;
    migrations: CubbyMigration[];
    maxSizeBytes?: number;
    idleTimeout?: string;   // e.g., '24h'
}

export interface CubbyMigration {
    version: number;
    up: string;             // SQL DDL statement
}

// ─── Environment ───────────────────────────────────────────────────────────

export interface EnvConfig {
    authToken: string;       // CEF_AUTH_TOKEN
    orchestratorUrl: string; // CEF_ORCHESTRATOR_URL
    robApiUrl: string;       // CEF_ROB_API_URL
    ddcUrl?: string;         // CEF_DDC_URL
}
