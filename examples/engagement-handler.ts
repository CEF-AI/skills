/**
 * Engagement Handler — CEF entry point for PAGE_CHANGE and BATCH_EVAL events
 *
 * From Notion spec "Tazz Notion SoT Agent Data Structures":
 *   PAGE_CHANGE → classify → change detect (via sotDeltas cubby)
 *               → fan-out to N eval agents → await all → compute consensus
 *               → update stats → Slack notification
 *
 * Does NOT write to RAFT KV — that's the RAFT Indexer's job.
 */

import type { CEFHandlerFn, CEFEvent, CEFContext } from '../types/cef.js';
import type {
  PageChangeEvent,
  BatchEvalEvent,
  ConsensusRecord,
  TopicCategory,
  EvalVersion,
  DeltaProcessingStats,
} from '../types/eval.js';
import { processPageChange, updateProcessingStats, getProcessingStats } from '../lib/cubby-deltas.js';
import { keys, getAgentLatestVersion, setConsensus } from '../lib/cubby.js';
import { TopicClassifier } from '../connector/topic-classifier.js';

const EVAL_AGENTS = ['gemini', 'llama', 'claude'] as const;
const SLACK_MCP_URL = process.env.SLACK_MCP_URL || '';

const classifier = new TopicClassifier();

/** Main handler — dispatches by event_type */
export const handle: CEFHandlerFn = async (event: CEFEvent, context: CEFContext) => {
  const payload = event.payload as Record<string, unknown>;
  const eventType = payload.event_type as string;

  context.log(`engagement-handler: received ${eventType}`);

  if (eventType === 'PAGE_CHANGE') {
    return handlePageChange(payload as unknown as PageChangeEvent, context);
  }

  if (eventType === 'BATCH_EVAL') {
    return handleBatchEval(payload as unknown as BatchEvalEvent, context);
  }

  context.log(`engagement-handler: unknown event_type "${eventType}", skipping`);
  return { skipped: true, reason: `unknown event_type: ${eventType}` };
};

/** Handle a wiki page change */
async function handlePageChange(event: PageChangeEvent, context: CEFContext) {
  const { page_id, page_title, content, edited_by, source_timestamp } = event;

  // 1. Classify
  const category: TopicCategory = classifier.classify(page_title, content);
  context.log(`engagement-handler: classified "${page_title}" as category ${category}`);

  // 2. Change detection via sotDeltas cubby
  const deltasCubby = context.cubby('sotDeltas');
  const delta = await processPageChange(
    deltasCubby,
    page_id,
    page_title,
    category,
    content,
    edited_by,
    source_timestamp,
  );

  if (!delta) {
    context.log(`engagement-handler: no change detected for "${page_title}", skipping`);
    return { skipped: true, reason: 'no_change' };
  }

  context.log(`engagement-handler: delta ${delta.deltaId} for "${page_title}"`);

  // 3. Fan-out to N eval agents
  const evalPayload = {
    delta_id: delta.deltaId,
    page_id,
    page_title,
    category,
    content,
    author: edited_by,
    timestamp: source_timestamp,
  };

  const agentResults = await Promise.all(
    EVAL_AGENTS.map(async (agentId) => {
      try {
        const agent = context.agents[`sotEvaluator_${agentId}`];
        const result = await agent.evaluateFaq(evalPayload);
        return { agentId, result, error: null };
      } catch (err) {
        context.log(`engagement-handler: agent ${agentId} failed: ${err}`);
        return { agentId, result: null, error: String(err) };
      }
    }),
  );

  // 4. Compute consensus per FAQ
  const evalsCubby = context.cubby('sotEvals');
  const faqMappingRaw = await evalsCubby.json.get(keys.faqMapping());
  const faqMapping = (faqMappingRaw as { faqs: Array<{ question_id: string; category: TopicCategory }> })?.faqs || [];
  const affectedFaqs = faqMapping.filter((f) => f.category === category);

  const consensusResults: ConsensusRecord[] = [];

  for (const faq of affectedFaqs) {
    const agentScores: Record<string, { can_answer: number; quality: number }> = {};
    const respondingAgents: string[] = [];

    for (const agentId of EVAL_AGENTS) {
      const latest = await getAgentLatestVersion(evalsCubby, faq.question_id, agentId);
      if (latest) {
        agentScores[agentId] = {
          can_answer: latest.scores.can_answer,
          quality: latest.scores.quality,
        };
        respondingAgents.push(agentId);
      }
    }

    if (respondingAgents.length === 0) continue;

    const qualityValues = Object.values(agentScores).map((s) => s.quality);
    const avgQuality = qualityValues.reduce((a, b) => a + b, 0) / qualityValues.length;
    const maxQuality = Math.max(...qualityValues);
    const minQuality = Math.min(...qualityValues);
    const divergence = maxQuality - minQuality;
    const bestAgent = respondingAgents.reduce((best, id) =>
      (agentScores[id].quality > (agentScores[best]?.quality ?? 0)) ? id : best,
    );

    const consensus: ConsensusRecord = {
      question_id: faq.question_id,
      agents: respondingAgents,
      scores: agentScores,
      avg_quality: Number(avgQuality.toFixed(3)),
      divergence: Number(divergence.toFixed(3)),
      best_agent: bestAgent,
      timestamp: new Date().toISOString(),
    };

    await setConsensus(evalsCubby, consensus);
    consensusResults.push(consensus);
  }

  // 5. Update processing stats with eval scores
  const stats = await getProcessingStats(deltasCubby);
  if (stats && consensusResults.length > 0) {
    const overallAvg = consensusResults.reduce((s, c) => s + c.avg_quality, 0) / consensusResults.length;
    const overallDiv = consensusResults.reduce((s, c) => s + c.divergence, 0) / consensusResults.length;
    stats.lastEvalScore = Number(overallAvg.toFixed(3));
    stats.lastAvgQuality = Number(overallAvg.toFixed(3));
    stats.lastDivergence = Number(overallDiv.toFixed(3));
    await updateProcessingStats(deltasCubby, stats);
  }

  // 6. Slack notification
  if (SLACK_MCP_URL) {
    try {
      await context.fetch(SLACK_MCP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: formatSlackSummary(page_title, delta.deltaId, agentResults, consensusResults),
        }),
      });
    } catch (err) {
      context.log(`engagement-handler: Slack notification failed: ${err}`);
    }
  }

  return {
    delta_id: delta.deltaId,
    category,
    agents_called: EVAL_AGENTS.length,
    agents_succeeded: agentResults.filter((r) => !r.error).length,
    faqs_evaluated: consensusResults.length,
    consensus: consensusResults,
  };
}

/** Handle batch re-evaluation */
async function handleBatchEval(event: BatchEvalEvent, context: CEFContext) {
  const evalsCubby = context.cubby('sotEvals');
  const faqMappingRaw = await evalsCubby.json.get(keys.faqMapping());
  const faqMapping = (faqMappingRaw as { faqs: Array<{ question_id: string }> })?.faqs || [];

  const faqIds = event.faq_ids || faqMapping.map((f) => f.question_id);
  context.log(`engagement-handler: batch eval for ${faqIds.length} FAQs`);

  // For batch, we trigger eval agents without a specific delta
  const results = await Promise.all(
    faqIds.map(async (faqId) => {
      const agentResults = await Promise.all(
        EVAL_AGENTS.map(async (agentId) => {
          try {
            const agent = context.agents[`sotEvaluator_${agentId}`];
            return await agent.evaluateFaq({ faq_id: faqId, batch: true });
          } catch (err) {
            context.log(`engagement-handler: batch agent ${agentId} failed for ${faqId}: ${err}`);
            return null;
          }
        }),
      );
      return { faqId, agents: agentResults };
    }),
  );

  return { batch: true, faqs_triggered: faqIds.length, results };
}

/** Format a Slack summary message */
function formatSlackSummary(
  pageTitle: string,
  deltaId: string,
  agentResults: Array<{ agentId: string; result: unknown; error: string | null }>,
  consensus: ConsensusRecord[],
): string {
  const succeeded = agentResults.filter((r) => !r.error).length;
  const lines = [
    `*Wiki Change Evaluated* — "${pageTitle}"`,
    `Delta: \`${deltaId}\` | Agents: ${succeeded}/${agentResults.length} succeeded`,
  ];

  for (const c of consensus) {
    const scores = Object.entries(c.scores)
      .map(([agent, s]) => `${agent}: ${s.quality.toFixed(2)}`)
      .join(', ');
    lines.push(`FAQ \`${c.question_id}\`: avg=${c.avg_quality.toFixed(2)}, div=${c.divergence.toFixed(2)}, best=${c.best_agent} (${scores})`);
  }

  return lines.join('\n');
}

export default handle;
