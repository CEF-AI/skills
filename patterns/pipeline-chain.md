# Pipeline Chain Pattern

A pipeline chain processes data through a sequence of agents, where each step's output feeds into the next step's input. This creates a linear processing flow: A → B → C → result.

**Derived from:** Production audio NLP pipeline (STT -> sentiment -> embedding -> topic matching)

---

## When to Use

- Data must pass through multiple processing stages in order
- Each stage transforms or enriches the data
- The output of one stage is the input to the next
- You want to build composable, reusable agent tasks

---

## Structure

```
Input arrives
  → Stage 1: Agent A processes input → output_a
  → Stage 2: Agent B processes output_a → output_b
  → Stage 3: Agent C processes output_b → output_c
  → Persist final result
```

---

## Inline Template

```typescript
async function handle(event: any, context: any) {
    const { entityId, rawInput } = event.payload;

    // Stage 1: Transcription (raw audio -> text)
    const transcription = await context.agents.speechToText.transcribe({
        audio: rawInput.audio,
        audioFormat: 'wav'
    });

    if (!transcription.fullText || transcription.fullText.trim() === '') {
        context.log('Empty transcription -- skipping pipeline');
        return { skipped: true };
    }

    // Stage 2: Sentiment analysis (text -> sentiment + emotion)
    const sentiment = await context.agents.sentimentAgent.analyze({
        text: transcription.fullText
    });

    // Stage 3: Embedding generation (text -> vector)
    const embeddingResult = await context.agents.embeddingAgent.embed({
        texts: [transcription.fullText]
    });
    const embedding = embeddingResult.embeddings[0];

    if (!embedding || embedding.length === 0) {
        context.log('Empty embedding -- skipping topic matching');
        return {
            transcription: transcription.fullText,
            sentiment: sentiment.sentiment,
            emotion: sentiment.emotion
        };
    }

    // Stage 4: Topic matching (vector -> topic assignment)
    const matchResult = await context.agents.topicAgent.matchTopic({
        embedding,
        entityId,
        threshold: 0.75
    });

    // Stage 5: Topic update or accumulation
    if (matchResult.topicId) {
        await context.agents.topicAgent.updateTopic({
            entityId,
            topicId: matchResult.topicId,
            embedding,
            sentiment: sentiment.sentiment
        });
    }

    // Persist the enriched record
    const now = new Date().toISOString();
    await context.cubbies.myDomain.exec(
        entityId,
        `INSERT INTO processed (entity_id, text, sentiment, emotion, topic_id, similarity, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [entityId, transcription.fullText, sentiment.sentiment, sentiment.emotion,
         matchResult.topicId || null, matchResult.similarity || null, now]
    );

    return {
        text: transcription.fullText,
        sentiment: sentiment.sentiment,
        emotion: sentiment.emotion,
        topicId: matchResult.topicId || null
    };
}
```

---

## Key Techniques

### Early exit on empty results

If a stage produces nothing useful, skip the rest of the pipeline:

```typescript
const transcription = await context.agents.stt.transcribe({ audio });
if (!transcription.fullText?.trim()) return { skipped: true };

const embedding = await context.agents.embedding.embed({ texts: [transcription.fullText] });
if (!embedding.embeddings[0]?.length) return { text: transcription.fullText, embedding: null };
```

### Error isolation per stage

Wrap each stage in try/catch to allow partial results:

```typescript
let sentiment = { sentiment: 0, emotion: 'neutral', confidence: 0 };
try {
    sentiment = await context.agents.sentimentAgent.analyze({ text });
} catch (error) {
    context.log(`Sentiment failed: ${error.message} — using defaults`);
}

let embedding: number[] = [];
try {
    const result = await context.agents.embeddingAgent.embed({ texts: [text] });
    embedding = result.embeddings[0] || [];
} catch (error) {
    context.log(`Embedding failed: ${error.message}`);
}
```

### Pipeline with accumulation

When running the pipeline in a loop (e.g., per audio chunk), accumulate unmatched items for batch processing later:

```typescript
const unassigned: Array<{ embedding: number[]; text: string }> = [];

for (const chunk of chunks) {
    const text = await context.agents.stt.transcribe({ audio: chunk.audio });
    const embedding = await context.agents.embedding.embed({ texts: [text.fullText] });
    const match = await context.agents.topic.matchTopic({ embedding: embedding.embeddings[0] });

    if (match.topicId) {
        await context.agents.topic.updateTopic({ topicId: match.topicId, embedding: embedding.embeddings[0] });
    } else {
        unassigned.push({ embedding: embedding.embeddings[0], text: text.fullText });
    }
}

// Batch-process unassigned items
if (unassigned.length >= 3) {
    const clusters = await context.agents.clustering.cluster({
        embeddings: unassigned.map(u => u.embedding),
        config: { minClusterSize: 3, minSamples: 2 }
    });
    // Create new topics from clusters...
}
```

---

## Example: Audio NLP Pipeline

A typical audio processing pipeline:

```
Audio chunk (base64)
  -> speechToText.transcribe() -> { fullText, segments }
  -> sentimentAgent.analyze() -> { sentiment, emotion }
  -> embeddingAgent.embed() -> { embeddings: number[][] }
  -> topicAgent.matchTopic() -> { topicId, similarity }
  -> topicAgent.updateTopic() or accumulate for clustering
```

After all chunks are processed, unassigned items can be batch-clustered:

```
Unassigned embeddings
  -> clusteringAgent.cluster() -> { labels, clusterCount }
  -> topicAgent.createTopic() for each cluster
```
