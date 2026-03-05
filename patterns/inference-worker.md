# Inference Worker Pattern

An inference worker is an agent task that wraps a single model inference call. It validates input, calls the model via `context.fetch()`, parses the response, and returns structured output. This is the most common agent task pattern.

**Extracted from:** `yoloObjectDetectionAgent.ts`, `speechToTextAgent.ts`, `embeddingAgent.ts`, `sentimentAgent.ts`, `patternAgent.ts`

---

## When to Use

- You need to call a machine learning model (computer vision, NLP, embeddings, LLM)
- The agent exposes a typed interface: defined input → model call → structured output
- The model runs on CEF inference infrastructure or an external endpoint

---

## Structure

```
Input payload arrives
  → Validate input
  → Build inference request (model spec + input format)
  → Call context.fetch() with retry
  → Parse model output
  → Return structured result
```

---

## Inline Template

```typescript
const INFERENCE_URL = 'http://202.181.153.253:8000/inference/';
const MODEL = { bucket: '1317', path: 'fs/model-name.zip' };

async function retry(action: () => Promise<any>, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try { return await action(); }
        catch (error) { if (i === retries - 1) throw error; }
    }
}

async function handle(event: any, context: any) {
    const { inputData } = event.payload;

    if (!inputData) {
        throw new Error('Invalid input: inputData is required');
    }

    const request = {
        model: MODEL,
        input: { type: 'text', data: inputData },
        options: { model_type: 'huggingface' }
    };

    const data = await retry(async () => {
        const response = await context.fetch(INFERENCE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        });
        if (!response.ok) {
            throw new Error(`Inference failed: ${response.statusText}: ${await response.text()}`);
        }
        return await response.json();
    });

    return { result: data.output };
}
```

---

## Inference Request Formats

### HuggingFace models (on CEF infra)

Model spec uses `bucket` + `path` or `cid`:

```typescript
// Path-based
const MODEL = { bucket: '1317', path: 'fs/whisper-large-v3.zip' };

// CID-based
const MODEL = { bucket: '1320', cid: 'fs/Qwen3-Embedding-4B.zip' };
```

Input varies by task:

```typescript
// Text classification / feature extraction
{ model: MODEL, input: { type: 'text', data: texts }, options: { model_type: 'huggingface', task: 'feature-extraction' } }

// Audio (speech-to-text)
{ model: MODEL, input: { type: 'audio', data: base64Audio }, options: { model_type: 'huggingface' } }

// Text with array input
{ model: MODEL, input: [{ type: 'text', data: text }], options: {} }
```

### DDC inference endpoint (e.g., YOLO)

Different URL and request format:

```typescript
const DDC_INFERENCE_URL = 'https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference';

const request = {
    model: { bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' },
    input: { image: base64Image }
};
```

### vLLM / LLM inference

Uses messages format:

```typescript
const request = {
    model: MODEL,
    input: [{ type: 'text', data: prompt }],
    options: { max_tokens: 200 }
};
```

---

## Response Parsing

Model responses vary. Common patterns:

```typescript
// Direct output (YOLO)
const detections = response.output.detections;
const processingTime = response.metrics.inference_time;

// HuggingFace classification
const label = response.output[0].label;
const score = response.output[0].score;

// Embedding extraction (may need unwrapping)
let data = response.output;
while (Array.isArray(data) && data.length === 1 && Array.isArray(data[0]) && Array.isArray(data[0][0])) {
    data = data[0]; // Unwrap nested arrays
}

// LLM text generation
const text = response.output[0].generated_text || response.output;
```

---

## Production Examples

### YOLO Object Detection

```typescript
async function handle(event: any, ctx: any) {
    const { image } = event.payload;

    const response = await ctx.fetch('https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: { bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' },
            input: { image }
        })
    }).then(res => res.json());

    const detections = response.output.detections;
    return {
        totalDetections: detections.length,
        detections,
        processingTime: response.metrics.inference_time
    };
}
```

### Text Embedding (Qwen3)

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

    const request = {
        model: EMBEDDING_MODEL,
        input: { type: 'text', data: texts },
        options: { model_type: 'huggingface', task: 'feature-extraction' }
    };

    const data = await retry(async () => {
        const response = await context.fetch(INFERENCE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        });
        if (!response.ok) throw new Error(`Embedding failed: ${response.statusText}`);
        return await response.json();
    });

    // Unwrap, truncate to dimension, L2 normalize
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

### Dual-Model Sentiment (parallel calls)

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
        return await response.json();
    });
}

async function handle(event: any, context: any) {
    const { text } = event.payload;

    // Call both models in parallel
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
