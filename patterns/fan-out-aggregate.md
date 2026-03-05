# Fan-Out Aggregate Pattern

Fan-out dispatches work to multiple agents in parallel using `Promise.all`, then aggregates the results. Use this when independent operations can run concurrently.

**Extracted from:** `Gaming Demo Agents/conciergeAgent.ts` (parallel streams), `Gaming Demo Agents/sentimentAgent.ts` (parallel model calls), `Nightingale Agents/engagement.ts` (parallel frame queries)

---

## When to Use

- Multiple independent agent calls can run concurrently
- Multiple model inference calls can run in parallel
- Multiple cubby reads/writes are independent
- You need to collect results from N agents into one response

---

## Structure

```
Input arrives
  → Fan out: launch N parallel operations
  → Await all results via Promise.all
  → Aggregate / merge results
  → Persist or return combined output
```

---

## Inline Template

### Parallel Agent Calls

```typescript
async function handle(event: any, context: any) {
    const { inputData } = event.payload;

    // Fan out to multiple agents in parallel
    const [detectionResult, classificationResult, embeddingResult] = await Promise.all([
        context.agents.objectDetection.yolo({ image: inputData.image })
            .catch((err: any) => ({ error: err.message, detections: [] })),
        context.agents.classifier.classify({ text: inputData.text })
            .catch((err: any) => ({ error: err.message, label: 'unknown' })),
        context.agents.embeddingAgent.embed({ texts: [inputData.text] })
            .catch((err: any) => ({ error: err.message, embeddings: [[]] }))
    ]);

    // Aggregate
    return {
        detections: detectionResult.detections,
        classification: classificationResult.label,
        embedding: embeddingResult.embeddings[0],
        hasErrors: !!(detectionResult.error || classificationResult.error || embeddingResult.error)
    };
}
```

### Parallel Model Inference

```typescript
const INFERENCE_URL = 'http://202.181.153.253:8000/inference/';
const EMOTION_MODEL = { bucket: '1317', path: 'fs/emotion-english-distilroberta-base.zip' };
const SENTIMENT_MODEL = { bucket: '1320', cid: 'fs/multilingual-sentiment-analysis.zip' };

async function retry(action: () => Promise<any>, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try { return await action(); }
        catch (error) { if (i === retries - 1) throw error; }
    }
}

async function callModel(model: any, input: any, context: any): Promise<any> {
    return retry(async () => {
        const response = await context.fetch(INFERENCE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input, options: { model_type: 'huggingface' } })
        });
        if (!response.ok) throw new Error(`Inference failed: ${response.statusText}`);
        return await response.json();
    });
}

async function handle(event: any, context: any) {
    const { text } = event.payload;

    // Both models run in parallel
    const [emotionData, sentimentData] = await Promise.all([
        callModel(EMOTION_MODEL, [{ type: 'text', data: text }], context)
            .catch(() => ({ output: [{ label: 'neutral', score: 0 }] })),
        callModel(SENTIMENT_MODEL, { type: 'text', data: [text] }, context)
            .catch(() => ({ output: [{ label: 'Neutral' }] }))
    ]);

    return {
        emotion: emotionData.output[0]?.label ?? 'neutral',
        confidence: emotionData.output[0]?.score ?? 0,
        sentiment: sentimentData.output[0]?.label ?? 'Neutral'
    };
}
```

### Parallel Stream Processing

```typescript
async function handle(event: any, context: any) {
    const { audioStreamId, gameDataStreamId, entityId } = event.payload;
    const cubby = context.cubby('my-store');
    const results: any = { audio: null, game: null };

    // Process both streams in parallel
    await Promise.all([
        processAudioStream(audioStreamId, entityId, cubby, context)
            .then(r => { results.audio = r; })
            .catch(err => { context.log(`Audio stream error: ${err.message}`); }),
        processGameStream(gameDataStreamId, entityId, cubby, context)
            .then(r => { results.game = r; })
            .catch(err => { context.log(`Game stream error: ${err.message}`); })
    ]);

    // Both streams complete — run aggregation
    await runPostProcessing(entityId, results, cubby, context);

    return { ok: true };
}

// These functions would be defined inline in the same file
async function processAudioStream(streamId: string, entityId: string, cubby: any, context: any) {
    // ... stream processing logic ...
}

async function processGameStream(streamId: string, entityId: string, cubby: any, context: any) {
    // ... stream processing logic ...
}

async function runPostProcessing(entityId: string, results: any, cubby: any, context: any) {
    // ... aggregation logic ...
}
```

---

## Key Techniques

### Error isolation

Always wrap each parallel branch in `.catch()` to prevent one failure from aborting everything:

```typescript
const [a, b, c] = await Promise.all([
    agentA.doWork(payload).catch(err => ({ error: err.message })),
    agentB.doWork(payload).catch(err => ({ error: err.message })),
    agentC.doWork(payload).catch(err => ({ error: err.message }))
]);
```

### Dynamic fan-out

Fan out to a dynamic number of agents:

```typescript
const agentAliases = ['evaluator_gemini', 'evaluator_llama', 'evaluator_claude'];

const results = await Promise.all(
    agentAliases.map(async (alias) => {
        const agent = context.agents[alias];
        return agent.evaluate(payload).catch((err: any) => ({ error: err.message }));
    })
);
```

### Parallel cubby reads

Multiple independent cubby reads benefit from parallelization:

```typescript
const [rgbFrames, thermalFrames, klvPackets] = await Promise.all([
    findFramesInWindow(entityId, 'rgb', targetTimestamp, cubby),
    findFramesInWindow(entityId, 'thermal', targetTimestamp, cubby),
    findFramesInWindow(entityId, 'klv', targetTimestamp, cubby)
]);
```
