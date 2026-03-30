---
name: cef-inference
description: Use when calling ML models from a CEF agent handler via context.fetch(). Covers inference endpoints, model catalog (YOLO, Whisper, Qwen3 embeddings, sentiment, emotion, Llama), request/response formats, retry patterns, response parsing, bring-your-own-model, and production-ready handler examples.
---

# CEF Inference

All model inference in CEF goes through `context.fetch()` to inference endpoints. Never use `context.models`; it does not exist in production.

> **Reminder:** All handler code must be fully inline. No `import` or `require`. See the **cef-agent-basics** skill.

## Inference Endpoints

| Endpoint | Use For |
|-|-|
| `http://202.181.153.253:8000/inference/` | HuggingFace models on CEF infra (embeddings, NLP, audio, LLM) |
| `https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference` | DDC-deployed models (YOLO, custom vision) |

## Retry Wrapper (include in every handler)

```typescript
async function retry(action: () => Promise<any>, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try { return await action(); }
        catch (error) { if (i === retries - 1) throw error; }
    }
}
```

## Model Catalog

### YOLO11x (Object Detection)

Endpoint: `https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference`

```typescript
const request = {
    model: { bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' },
    input: { image: base64ImageData }
};

const response = await context.fetch(
    'https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }
);
const data = await response.json();
// data.output.detections = [{ label: 'car', confidence: 0.95, box: { xmin, ymin, xmax, ymax } }]
// data.metrics.inference_time = 0.045
```

### Whisper Large v3 (Speech-to-Text)

```typescript
const request = {
    model: { bucket: '1317', path: 'fs/whisper-large-v3.zip' },
    input: { type: 'audio', data: base64AudioData },
    options: { model_type: 'huggingface' }
};
const data = await response.json();
// data.output = { text: "Hello world", chunks: [{ timestamp: [0.0, 1.5], text: "Hello world" }] }
```

Response format varies; parse defensively:
- Format 1: `{ text, chunks }` (direct transcription)
- Format 2: `{ transcription, segments }` (alternative keys)
- Format 3: Raw string
- Format 4: Array of segments

### Qwen3-Embedding-4B (Text Embeddings)

Dimension: 1536

```typescript
const request = {
    model: { bucket: '1320', cid: 'fs/Qwen3-Embedding-4B.zip' },
    input: { type: 'text', data: ['text to embed'] },
    options: { model_type: 'huggingface', task: 'feature-extraction' }
};
const data = await response.json();

// Output may be nested; unwrap:
let output = data.output;
while (Array.isArray(output) && output.length === 1 && Array.isArray(output[0]) && Array.isArray(output[0][0])) {
    output = output[0];
}
// output[i] is now a number[] embedding for the i-th input text
```

Post-processing: truncate to 1536 dimensions, L2-normalize.

### emotion-english-distilroberta-base (Emotion Classification)

Labels: anger, disgust, fear, joy, neutral, sadness, surprise

```typescript
const request = {
    model: { bucket: '1317', path: 'fs/emotion-english-distilroberta-base.zip' },
    input: [{ type: 'text', data: 'I am so happy!' }],
    options: {}
};
// output[0] = { label: 'joy', score: 0.98 }
```

### multilingual-sentiment-analysis (Sentiment Polarity)

Labels: "Very Negative" (-1), "Negative" (-0.5), "Neutral" (0), "Positive" (0.5), "Very Positive" (1)

```typescript
const SENTIMENT_LABEL_MAP: Record<string, number> = {
    'Very Negative': -1, 'Negative': -0.5, 'Neutral': 0, 'Positive': 0.5, 'Very Positive': 1
};

const request = {
    model: { bucket: '1320', cid: 'fs/multilingual-sentiment-analysis.zip' },
    input: { type: 'text', data: ['This is terrible'] },
    options: { model_type: 'huggingface' }
};
// SENTIMENT_LABEL_MAP[output[0].label] -> -0.5
```

### Llama 3.2 11B Vision Instruct (LLM Reasoning)

```typescript
const request = {
    model: { bucket: '1317', path: 'fs/llama-3.2-11B-vision-instruct.zip' },
    input: [{ type: 'text', data: 'Classify this behavior as POSITIVE or NEGATIVE: ...' }],
    options: { max_tokens: 200 }
};
// Parse: data.output[0].generated_text or data.output
```

## Model Spec Formats

```typescript
// Path-based (HuggingFace infra)
{ bucket: '1317', path: 'fs/model-name.zip' }

// CID-based (HuggingFace infra)
{ bucket: '1320', cid: 'fs/model-name.zip' }

// Named (DDC inference)
{ bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' }
```

## Inference Request Formats

```typescript
// Text classification / feature extraction
{ model: MODEL, input: { type: 'text', data: texts }, options: { model_type: 'huggingface', task: 'feature-extraction' } }

// Audio (speech-to-text)
{ model: MODEL, input: { type: 'audio', data: base64Audio }, options: { model_type: 'huggingface' } }

// Text with array input (emotion, LLM)
{ model: MODEL, input: [{ type: 'text', data: text }], options: {} }

// DDC model (YOLO)
{ model: { bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' }, input: { image: base64Image } }
```

## Response Parsing Patterns

```typescript
// YOLO (DDC endpoint)
const detections = data.output.detections;
const processingTime = data.metrics.inference_time;

// HuggingFace classification
const label = data.output[0].label;
const score = data.output[0].score;

// Embedding extraction (may need unwrapping)
let output = data.output;
while (Array.isArray(output) && output.length === 1 && Array.isArray(output[0]) && Array.isArray(output[0][0])) {
    output = output[0];
}

// LLM text generation
const text = data.output[0]?.generated_text || data.output;
```

## Common Utilities (inline in every handler)

### L2 Normalization

```typescript
function l2Normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return norm === 0 ? vector.slice() : vector.map(val => val / norm);
}
```

### Cosine Similarity

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

## Bring Your Own Model

1. Package model as a zip archive
2. Upload to a DDC bucket
3. Reference in handler by `{ bucket, path }` or `{ bucket, cid }`
4. Use the appropriate inference endpoint

## Complete Production Examples

### YOLO Object Detection Handler

```typescript
async function retry(action: () => Promise<any>, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try { return await action(); }
        catch (error) { if (i === retries - 1) throw error; }
    }
}

async function handle(event: any, ctx: any) {
    const { image } = event.payload;

    const response = await retry(async () => {
        const res = await ctx.fetch('https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: { bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' },
                input: { image }
            })
        });
        if (!res.ok) throw new Error(`YOLO failed: ${res.statusText}`);
        return res.json();
    });

    return {
        totalDetections: response.output.detections.length,
        detections: response.output.detections,
        processingTime: response.metrics.inference_time
    };
}
```

### Text Embedding Handler (Qwen3)

```typescript
const INFERENCE_URL = 'http://202.181.153.253:8000/inference/';
const EMBEDDING_MODEL = { bucket: '1320', cid: 'fs/Qwen3-Embedding-4B.zip' };
const VECTOR_DIMENSION = 1536;

async function retry(action: () => Promise<any>, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try { return await action(); }
        catch (error) { if (i === retries - 1) throw error; }
    }
}

function l2Normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return norm === 0 ? vector.slice() : vector.map(val => val / norm);
}

async function handle(event: any, context: any) {
    const { texts } = event.payload;
    if (!Array.isArray(texts) || texts.length === 0) {
        throw new Error('Invalid input: texts must be a non-empty array');
    }

    const data = await retry(async () => {
        const response = await context.fetch(INFERENCE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: EMBEDDING_MODEL,
                input: { type: 'text', data: texts },
                options: { model_type: 'huggingface', task: 'feature-extraction' }
            })
        });
        if (!response.ok) throw new Error(`Embedding failed: ${response.statusText}`);
        return response.json();
    });

    let output = data.output;
    while (Array.isArray(output) && output.length === 1 && Array.isArray(output[0]) && Array.isArray(output[0][0])) {
        output = output[0];
    }
    const embeddings = output.map((item: any) => {
        const vec = typeof item[0] === 'number' ? item : item[0];
        const truncated = vec.length > VECTOR_DIMENSION ? vec.slice(0, VECTOR_DIMENSION) : vec;
        return l2Normalize(truncated);
    });

    return { embeddings };
}
```

### Dual-Model Sentiment Handler (Parallel)

```typescript
const INFERENCE_URL = 'http://202.181.153.253:8000/inference/';
const EMOTION_MODEL = { bucket: '1317', path: 'fs/emotion-english-distilroberta-base.zip' };
const SENTIMENT_MODEL = { bucket: '1320', cid: 'fs/multilingual-sentiment-analysis.zip' };

const SENTIMENT_LABEL_MAP: Record<string, number> = {
    'Very Negative': -1, 'Negative': -0.5, 'Neutral': 0, 'Positive': 0.5, 'Very Positive': 1
};

async function retry(action: () => Promise<any>, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try { return await action(); }
        catch (error) { if (i === retries - 1) throw error; }
    }
}

async function callModel(modelSpec: any, input: any, context: any): Promise<any> {
    return retry(async () => {
        const response = await context.fetch(INFERENCE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelSpec, input, options: { model_type: 'huggingface' } })
        });
        if (!response.ok) throw new Error(`Model failed: ${response.statusText}`);
        return response.json();
    });
}

async function handle(event: any, context: any) {
    const { text } = event.payload;

    const [emotionData, sentimentData] = await Promise.all([
        callModel(EMOTION_MODEL, [{ type: 'text', data: text }], context)
            .catch(() => ({ output: [{ label: 'neutral', score: 0 }] })),
        callModel(SENTIMENT_MODEL, { type: 'text', data: [text] }, context)
            .catch(() => ({ output: [{ label: 'Neutral' }] }))
    ]);

    return {
        sentiment: SENTIMENT_LABEL_MAP[sentimentData.output[0]?.label] ?? 0,
        emotion: emotionData.output[0]?.label ?? 'neutral',
        confidence: emotionData.output[0]?.score ?? 0
    };
}
```

## Related Skills

- **cef-agent-basics**: Handler signature, project structure, config schema
- **cef-orchestration**: Wiring inference workers into pipelines and fan-out patterns
- **cef-cubby-state**: Storing inference results persistently
