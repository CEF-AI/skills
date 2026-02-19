/**
 * Cubby helpers for SOT eval storage
 *
 * Wraps CEFCubbyInstance with typed, domain-specific operations.
 * Key schema aligned with Notion spec "Tazz Notion SoT Agent Data Structures":
 *   faq:{id}/agent:{agentId}         → full EvalRecord (per-agent)
 *   faq:{id}/agent:{agentId}/latest  → latest EvalVersion (per-agent)
 *   faq:{id}/consensus               → ConsensusRecord (cross-agent)
 *   config:faq_mapping                → FAQ list
 *   meta:last_run:{agentId}           → EvalRunMeta (per-agent)
 */

import type { CEFCubbyInstance } from '../types/cef.js';
import type { EvalRecord, EvalVersion, EvalRunMeta, ConsensusRecord } from '../types/eval.js';

const CUBBY_NAME = 'sotEvals';

/** Key builders — agent-namespaced per spec */
export const keys = {
  /** Full eval record for a specific agent */
  faqAgent: (questionId: string, agentId: string) =>
    `faq:${questionId}/agent:${agentId}`,
  /** Latest version pointer for a specific agent */
  faqAgentLatest: (questionId: string, agentId: string) =>
    `faq:${questionId}/agent:${agentId}/latest`,
  /** Cross-agent consensus */
  faqConsensus: (questionId: string) =>
    `faq:${questionId}/consensus`,
  /** FAQ mapping config */
  faqMapping: () => 'config:faq_mapping',
  /** Per-agent run metadata */
  lastRun: (agentId: string) => `meta:last_run:${agentId}`,

  // Legacy flat keys (kept for LocalEvalStore compatibility)
  faq: (id: string) => `faq:${id}`,
  faqLatest: (id: string) => `faq:${id}/latest`,
  faqBest: (id: string) => `faq:${id}/best`,
} as const;

// ── Agent-namespaced operations (spec-aligned) ──

/** Get eval record for a specific agent */
export async function getAgentEvalRecord(
  cubby: CEFCubbyInstance,
  questionId: string,
  agentId: string,
): Promise<EvalRecord | null> {
  const data = await cubby.json.get(keys.faqAgent(questionId, agentId));
  return data as EvalRecord | null;
}

/** Store a new eval version for a specific agent */
export async function appendAgentEvalVersion(
  cubby: CEFCubbyInstance,
  questionId: string,
  agentId: string,
  version: EvalVersion,
): Promise<void> {
  const key = keys.faqAgent(questionId, agentId);
  const record = await cubby.json.get(key) as EvalRecord | null;

  if (record) {
    record.versions.unshift(version);
    // Auto-set best if first version or higher quality
    if (record.versions.length === 1 ||
        version.scores.quality > (record.versions[1]?.scores.quality ?? 0)) {
      record.best_version = version.version;
      record.best_verified_by = 'self';
    }
    await cubby.json.set(key, record);
  } else {
    throw new Error(
      `EvalRecord "${questionId}" for agent "${agentId}" does not exist.`,
    );
  }

  // Update latest pointer
  await cubby.json.set(keys.faqAgentLatest(questionId, agentId), version);
}

/** Create an agent-specific eval record */
export async function createAgentEvalRecord(
  cubby: CEFCubbyInstance,
  questionId: string,
  agentId: string,
  question: string,
  mapping: string[],
): Promise<EvalRecord> {
  const record: EvalRecord = {
    question_id: questionId,
    agent_id: agentId,
    question,
    mapping,
    versions: [],
    best_version: 0,
    best_verified_by: 'self',
  };
  await cubby.json.set(keys.faqAgent(questionId, agentId), record);
  return record;
}

/** Get latest version for a specific agent */
export async function getAgentLatestVersion(
  cubby: CEFCubbyInstance,
  questionId: string,
  agentId: string,
): Promise<EvalVersion | null> {
  const data = await cubby.json.get(keys.faqAgentLatest(questionId, agentId));
  return data as EvalVersion | null;
}

/** Store consensus record after all agents complete */
export async function setConsensus(
  cubby: CEFCubbyInstance,
  consensus: ConsensusRecord,
): Promise<void> {
  await cubby.json.set(keys.faqConsensus(consensus.question_id), consensus);
}

/** Get consensus record */
export async function getConsensus(
  cubby: CEFCubbyInstance,
  questionId: string,
): Promise<ConsensusRecord | null> {
  const data = await cubby.json.get(keys.faqConsensus(questionId));
  return data as ConsensusRecord | null;
}

/** Store per-agent run metadata */
export async function setAgentRunMeta(
  cubby: CEFCubbyInstance,
  agentId: string,
  meta: EvalRunMeta,
): Promise<void> {
  await cubby.json.set(keys.lastRun(agentId), meta);
}

/** List all tracked FAQ IDs (deduped across agents) */
export async function listFAQs(cubby: CEFCubbyInstance): Promise<string[]> {
  const allKeys = await cubby.json.keys('faq:*');
  const ids = new Set<string>();
  for (const k of allKeys) {
    // Extract question ID from faq:{id}/... patterns
    const match = k.match(/^faq:([^/]+)/);
    if (match) ids.add(match[1]);
  }
  return [...ids];
}

// ── Legacy flat operations (LocalEvalStore compat) ──

export async function getEvalRecord(
  cubby: CEFCubbyInstance,
  questionId: string,
): Promise<EvalRecord | null> {
  const data = await cubby.json.get(keys.faq(questionId));
  return data as EvalRecord | null;
}

export async function appendEvalVersion(
  cubby: CEFCubbyInstance,
  questionId: string,
  version: EvalVersion,
): Promise<void> {
  const record = await getEvalRecord(cubby, questionId);
  if (record) {
    record.versions.unshift(version);
    await cubby.json.set(keys.faq(questionId), record);
  } else {
    throw new Error(
      `EvalRecord "${questionId}" does not exist. Create it before appending versions.`,
    );
  }
  await cubby.json.set(keys.faqLatest(questionId), version);
}

export async function setBestVersion(
  cubby: CEFCubbyInstance,
  questionId: string,
  version: number,
  verifiedBy: 'human' | 'self' | 'evaluator',
): Promise<void> {
  await cubby.json.set(keys.faqBest(questionId), { version, verified_by: verifiedBy });
  const record = await getEvalRecord(cubby, questionId);
  if (record) {
    record.best_version = version;
    record.best_verified_by = verifiedBy;
    await cubby.json.set(keys.faq(questionId), record);
  }
}

export async function setRunMeta(
  cubby: CEFCubbyInstance,
  meta: EvalRunMeta,
): Promise<void> {
  await cubby.json.set('meta:last_run', meta);
}

export { CUBBY_NAME };
