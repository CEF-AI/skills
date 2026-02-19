/**
 * Cubby helpers for sotDeltas — Delta metadata storage
 *
 * Key schema from Notion spec "Tazz Notion SoT Agent Data Structures":
 *   page:{pageId}      → DeltaMetadata (last-known delta per page)
 *   stats:processing    → DeltaProcessingStats (running totals)
 */

import type { CEFCubbyInstance } from '../types/cef.js';
import type { DeltaMetadata, DeltaProcessingStats, TopicCategory } from '../types/eval.js';
import { createHash } from 'crypto';

const CUBBY_NAME = 'sotDeltas';

/** Key builders */
export const deltaKeys = {
  page: (pageId: string) => `page:${pageId}`,
  stats: () => 'stats:processing',
} as const;

/** Get last-known delta metadata for a page */
export async function getPageDelta(
  cubby: CEFCubbyInstance,
  pageId: string,
): Promise<DeltaMetadata | null> {
  const data = await cubby.json.get(deltaKeys.page(pageId));
  return data as DeltaMetadata | null;
}

/** Store delta metadata after change detection */
export async function setPageDelta(
  cubby: CEFCubbyInstance,
  pageId: string,
  meta: DeltaMetadata,
): Promise<void> {
  await cubby.json.set(deltaKeys.page(pageId), meta);
}

/** Get processing stats */
export async function getProcessingStats(
  cubby: CEFCubbyInstance,
): Promise<DeltaProcessingStats | null> {
  const data = await cubby.json.get(deltaKeys.stats());
  return data as DeltaProcessingStats | null;
}

/** Update processing stats */
export async function updateProcessingStats(
  cubby: CEFCubbyInstance,
  stats: DeltaProcessingStats,
): Promise<void> {
  await cubby.json.set(deltaKeys.stats(), stats);
}

/** Hash content for change detection (per spec: hash(content) vs last-known contentHash) */
export function hashContent(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/** Detect if content changed vs last-known delta */
export async function hasContentChanged(
  cubby: CEFCubbyInstance,
  pageId: string,
  content: string,
): Promise<boolean> {
  const existing = await getPageDelta(cubby, pageId);
  if (!existing) return true; // first time = changed
  return existing.contentHash !== hashContent(content);
}

/** Build and store a new delta, updating stats. Returns null if no change. */
export async function processPageChange(
  cubby: CEFCubbyInstance,
  pageId: string,
  title: string,
  category: TopicCategory,
  content: string,
  author: string,
  editedTime: string,
): Promise<DeltaMetadata | null> {
  const contentHash = hashContent(content);
  const existing = await getPageDelta(cubby, pageId);

  // No change — skip
  if (existing && existing.contentHash === contentHash) {
    return null;
  }

  const deltaId = `d_${createHash('sha256').update(`${pageId}:${editedTime}`).digest('hex').slice(0, 12)}`;
  const now = new Date().toISOString();

  const meta: DeltaMetadata = {
    deltaId,
    title,
    category,
    contentHash,
    author,
    lastEditedTime: editedTime,
    processedAt: now,
  };

  await setPageDelta(cubby, pageId, meta);

  // Update stats
  const stats = await getProcessingStats(cubby) || {
    total: 0,
    lastDeltaId: '',
    lastPageId: '',
    lastTitle: '',
    lastCategory: category,
    lastProcessedAt: '',
  };

  stats.total += 1;
  stats.lastDeltaId = deltaId;
  stats.lastPageId = pageId;
  stats.lastTitle = title;
  stats.lastCategory = category;
  stats.lastProcessedAt = now;

  await updateProcessingStats(cubby, stats);

  return meta;
}

export { CUBBY_NAME };
