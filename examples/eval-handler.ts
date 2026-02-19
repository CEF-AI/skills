/**
 * Eval Handler — CEF agent handler for FAQ evaluation
 *
 * From Notion spec "Tazz Notion SoT Agent Data Structures":
 *   Event → load FAQ mapping → filter by category
 *         → query Notion MCP for related pages (primary)
 *         → fallback to RAFT KV for category deltas
 *         → per FAQ: LLM answer + self-eval, then vs_previous comparison
 *         → store in sotEvals cubby at faq:{id}/agent:{agentId}
 *         → emit EVAL_COMPLETE
 *
 * Same handler binary, different modelId per agent instance.
 * modelId is set at deploy time via agent config.
 */

import type { CEFHandlerFn, CEFEvent, CEFContext } from '../types/cef.js';
import type {
  EvalRecord,
  EvalVersion,
  EvalScores,
  EvalRunMeta,
  FAQMapping,
  TopicCategory,
} from '../types/eval.js';
import {
  keys,
  getAgentLatestVersion,
  getAgentEvalRecord,
  appendAgentEvalVersion,
  createAgentEvalRecord,
  setAgentRunMeta,
} from '../lib/cubby.js';

/** Eval payload from engagement handler */
interface EvalPayload {
  delta_id: string;
  page_id: string;
  page_title: string;
  category: TopicCategory;
  content: string;
  author?: string;
  timestamp?: string;
  faq_id?: string;
  batch?: boolean;
}

/** LLM response for answer + self-eval */
interface AnswerEvalResponse {
  answer: string;
  can_answer: number;
  quality: number;
  reasoning: string;
}

/** LLM response for vs_previous comparison */
interface ComparisonResponse {
  vs_previous: number;
  reasoning: string;
}

const EVAL_SYSTEM_PROMPT = `You are a strict quality evaluator for a knowledge base FAQ system.
You evaluate how well wiki content can answer specific questions.
Always respond with valid JSON. No markdown fences, no extra text.`;

export const handle: CEFHandlerFn = async (event: CEFEvent, context: CEFContext) => {
  const payload = event.payload as unknown as EvalPayload;
  const startTime = Date.now();

  // Agent ID from the deployment config (e.g., "gemini", "llama", "claude")
  const agentId = (event.payload as Record<string, unknown>).agent_id as string
    || context.path?.agentServicePubKey
    || 'unknown';

  // Model ID from agent config
  const modelId = (event.payload as Record<string, unknown>).model_id as string
    || 'gemini-3-flash-preview';

  context.log(`eval-handler[${agentId}]: received eval for "${payload.page_title}" (${payload.category})`);

  const evalsCubby = context.cubby('sotEvals');

  // 1. Load FAQ mapping
  const faqMappingRaw = await evalsCubby.json.get(keys.faqMapping());
  const faqMapping = (faqMappingRaw as { faqs: FAQMapping[] })?.faqs || [];

  // 2. Filter FAQs by category match
  const affectedFaqs = payload.faq_id
    ? faqMapping.filter((f) => f.question_id === payload.faq_id)
    : faqMapping.filter((f) => f.category === payload.category);

  if (affectedFaqs.length === 0) {
    context.log(`eval-handler[${agentId}]: no FAQs for category ${payload.category}`);
    return { agent_id: agentId, faqs_evaluated: 0 };
  }

  // 3. Build wiki context — Notion MCP (primary) + RAFT KV (fallback)
  let wikiContext = payload.content; // event payload content is always available

  // Primary: Notion MCP semantic search
  try {
    for (const faq of affectedFaqs.slice(0, 3)) { // limit to avoid rate limits
      const searchResponse = await context.fetch(
        process.env.NOTION_MCP_URL || 'https://notion-mcp.cere.network/search',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: faq.question, limit: 5 }),
        },
      );
      if (searchResponse.ok) {
        const results = await searchResponse.json() as Array<{ title: string; content: string }>;
        for (const page of (results || [])) {
          wikiContext += `\n\n--- ${page.title} ---\n${page.content}`;
        }
      }
    }
  } catch {
    context.log(`eval-handler[${agentId}]: Notion MCP unavailable, using RAFT KV fallback`);

    // Fallback: RAFT KV category query
    try {
      const categoryKeys = await context.kv.lrange(`delta:cat:${payload.category}`, -20, -1);
      for (const key of categoryKeys) {
        const delta = await context.kv.hgetall(key);
        if (delta?.content && delta?.page_title) {
          wikiContext += `\n\n--- ${delta.page_title} ---\n${delta.content}`;
        }
      }
    } catch {
      context.log(`eval-handler[${agentId}]: RAFT KV also unavailable, using event payload only`);
    }
  }

  // 4. Evaluate each affected FAQ
  const results: Array<{ question_id: string; version: number; scores: EvalScores }> = [];

  for (const faq of affectedFaqs) {
    try {
      // Read previous version
      const previousVersion = await getAgentLatestVersion(evalsCubby, faq.question_id, agentId);

      // LLM call 1: answer + self-eval
      const answerPrompt = buildAnswerPrompt(faq.question, wikiContext);
      const answerRaw = await inferModel(context, modelId, EVAL_SYSTEM_PROMPT, answerPrompt);
      const answerResult = parseJsonResponse<AnswerEvalResponse>(answerRaw);

      const canAnswer = clamp(answerResult?.can_answer ?? 0.5, 0, 1);
      const quality = clamp(answerResult?.quality ?? 0.5, 0, 1);
      const answer = answerResult?.answer || answerRaw;

      // LLM call 2: vs_previous comparison (if prior version exists)
      let vsPrevious: number | null = null;
      if (previousVersion) {
        const humanNote = previousVersion.scores.human != null
          ? `\nThe previous version was rated ${previousVersion.scores.human} by a human reviewer.`
          : '';

        const compPrompt = buildComparisonPrompt(
          faq.question,
          previousVersion.answer,
          answer,
          previousVersion.scores,
          { can_answer: canAnswer, quality },
          humanNote,
        );

        try {
          const compRaw = await inferModel(context, modelId, EVAL_SYSTEM_PROMPT, compPrompt);
          const compResult = parseJsonResponse<ComparisonResponse>(compRaw);
          vsPrevious = clamp(compResult?.vs_previous ?? 0, -1, 1);
        } catch {
          context.log(`eval-handler[${agentId}]: comparison failed for ${faq.question_id}`);
        }
      }

      // Store new version
      const scores: EvalScores = {
        can_answer: canAnswer,
        quality,
        human: null,
        evaluator_agent: null,
        vs_previous: vsPrevious,
      };

      const versionNumber = previousVersion ? previousVersion.version + 1 : 1;

      const evalVersion: EvalVersion = {
        version: versionNumber,
        timestamp: new Date().toISOString(),
        model: modelId,
        chunks_used: faq.chunk_ids || [],
        answer,
        scores,
        delta_trigger: payload.delta_id,
      };

      // Ensure record exists
      let record = await getAgentEvalRecord(evalsCubby, faq.question_id, agentId);
      if (!record) {
        record = await createAgentEvalRecord(
          evalsCubby, faq.question_id, agentId, faq.question, faq.chunk_ids || [],
        );
      }

      await appendAgentEvalVersion(evalsCubby, faq.question_id, agentId, evalVersion);

      results.push({ question_id: faq.question_id, version: versionNumber, scores });

      context.log(`eval-handler[${agentId}]: ${faq.question_id} v${versionNumber} — quality=${quality.toFixed(2)}`);
    } catch (err) {
      context.log(`eval-handler[${agentId}]: failed on ${faq.question_id}: ${err}`);
    }
  }

  // 5. Store run metadata
  const durationMs = Date.now() - startTime;
  const avgQuality = results.length > 0
    ? results.reduce((s, r) => s + r.scores.quality, 0) / results.length
    : 0;

  const runMeta: EvalRunMeta = {
    timestamp: new Date().toISOString(),
    deltas_processed: 1,
    faqs_evaluated: results.length,
    model: modelId,
    duration_ms: durationMs,
    agent_id: agentId,
  };
  await setAgentRunMeta(evalsCubby, agentId, runMeta);

  // 6. Emit EVAL_COMPLETE (observability)
  if (context.emit) {
    context.emit('EVAL_COMPLETE', {
      event_type: 'EVAL_COMPLETE',
      agent_id: agentId,
      trigger: payload.delta_id,
      faqs_evaluated: results.length,
      avg_quality: Number(avgQuality.toFixed(3)),
      duration_ms: durationMs,
    });
  }

  return {
    agent_id: agentId,
    faqs_evaluated: results.length,
    avg_quality: Number(avgQuality.toFixed(3)),
    duration_ms: durationMs,
    results,
  };
};

// ── Helpers ──

async function inferModel(
  context: CEFContext,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  if (!context.models) {
    throw new Error('context.models not available — CEF native inference required');
  }
  const result = await context.models.infer(modelId, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
    max_tokens: 4096,
  }) as { content: string } | string;

  return typeof result === 'string' ? result : result.content;
}

function buildAnswerPrompt(question: string, wikiContent: string): string {
  return `# Question\n\n${question}\n\n---\n\n## Wiki Content\n\n${wikiContent}\n\n---\n\n## Self-Evaluation\n\nAfter writing your answer, self-evaluate on two dimensions:\n- can_answer (0-1): How completely can this question be answered from the wiki content?\n- quality (0-1): How good is the answer? Consider accuracy, completeness, and clarity.\n\nRespond with JSON:\n{\n  "answer": "your answer here",\n  "can_answer": 0.0,\n  "quality": 0.0,\n  "reasoning": "brief explanation of scores"\n}`;
}

function buildComparisonPrompt(
  question: string,
  previousAnswer: string,
  currentAnswer: string,
  prevScores: { can_answer: number; quality: number },
  currScores: { can_answer: number; quality: number },
  humanNote: string,
): string {
  return `## Question\n${question}\n\n## Previous Answer (${prevScores.quality.toFixed(2)} quality)\n${previousAnswer}${humanNote}\n\n## Current Answer (${currScores.quality.toFixed(2)} quality)\n${currentAnswer}\n\n## Instructions\nCompare the current answer against the previous answer.\n\nRespond with JSON:\n{\n  "vs_previous": 0.0,\n  "reasoning": "brief explanation"\n}`;
}

function parseJsonResponse<T>(text: string): T | null {
  const trimmed = text.trim();
  // Try code fence
  const fence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch { /* fall through */ }
  }
  // Try raw JSON
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try { return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)); } catch { /* fall through */ }
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export default handle;
