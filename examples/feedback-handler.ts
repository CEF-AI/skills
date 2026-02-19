/**
 * Feedback Handler — CEF agent for HUMAN_FEEDBACK stream events
 *
 * From Notion spec "Tazz Notion SoT Agent Data Structures":
 *   HUMAN_FEEDBACK → update sotEvals cubby:
 *     - agree:    scores.human = agent's quality score, best_verified_by = "human"
 *     - override: scores.human = human-provided score, best_verified_by = "human"
 *
 * Human scores are ground truth — they anchor the multi-model benchmark.
 * This is the RLHF loop: agent scores drift, human corrections pull them back.
 */

import type { CEFHandlerFn, CEFEvent, CEFContext } from '../types/cef.js';
import type { HumanFeedbackEvent, EvalRecord } from '../types/eval.js';
import { keys, getAgentEvalRecord } from '../lib/cubby.js';

export const handle: CEFHandlerFn = async (event: CEFEvent, context: CEFContext) => {
  const payload = event.payload as unknown as HumanFeedbackEvent;

  if (payload.event_type !== 'HUMAN_FEEDBACK') {
    context.log(`feedback-handler: unexpected event_type "${payload.event_type}", skipping`);
    return { skipped: true };
  }

  const { faq_id, agent_id, version, action, human_score, comment, reviewer } = payload;

  context.log(`feedback-handler: ${action} from ${reviewer} on ${faq_id}/agent:${agent_id} v${version}`);

  const evalsCubby = context.cubby('sotEvals');

  // Read the agent's eval record
  const record = await getAgentEvalRecord(evalsCubby, faq_id, agent_id);
  if (!record) {
    context.log(`feedback-handler: no record found for ${faq_id}/agent:${agent_id}`);
    return { error: 'record_not_found', faq_id, agent_id };
  }

  // Find the specific version
  const evalVersion = record.versions.find((v) => v.version === version);
  if (!evalVersion) {
    context.log(`feedback-handler: version ${version} not found for ${faq_id}/agent:${agent_id}`);
    return { error: 'version_not_found', faq_id, agent_id, version };
  }

  // Apply feedback
  if (action === 'agree') {
    // Human confirms the agent's quality score
    evalVersion.scores.human = evalVersion.scores.quality;
  } else if (action === 'override') {
    // Human provides their own score
    evalVersion.scores.human = human_score;
  }

  // Mark as human-verified
  record.best_version = version;
  record.best_verified_by = 'human';

  // Write back
  const recordKey = keys.faqAgent(faq_id, agent_id);
  await evalsCubby.json.set(recordKey, record);

  // Update latest pointer if this is the most recent version
  if (record.versions[0]?.version === version) {
    await evalsCubby.json.set(keys.faqAgentLatest(faq_id, agent_id), evalVersion);
  }

  context.log(
    `feedback-handler: applied ${action} — scores.human=${evalVersion.scores.human}, best_verified_by=human`,
  );

  return {
    faq_id,
    agent_id,
    version,
    action,
    human_score: evalVersion.scores.human,
    reviewer,
    comment: comment || null,
  };
};

export default handle;
