# Inference Catalog

All model inference in CEF goes through `context.fetch()`. This document catalogs the known models deployed on CEF infrastructure, the request/response formats, and how to bring your own model.

---

## Inference Endpoints

| Endpoint | Use For |
|----------|---------|
| `http://202.181.153.253:8000/inference/` | HuggingFace models on CEF infra (embeddings, NLP, audio, LLM) |
| `https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference` | DDC-deployed models (YOLO, custom vision) |

---

## Known Pre-Deployed Models

### YOLO11x (Object Detection)

| Field | Value |
|-------|-------|
| Endpoint | `https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference` |
| Model spec | `{ bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' }` |
| Input | `{ image: base64String }` |
| Output | `{ output: { detections: Array<{ label, confidence, box: { xmin, ymin, xmax, ymax }, class_id }> }, metrics: { inference_time } }` |

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
```

---

### Whisper Large v3 (Speech-to-Text)

| Field | Value |
|-------|-------|
| Endpoint | `http://202.181.153.253:8000/inference/` |
| Model spec | `{ bucket: '1317', path: 'fs/whisper-large-v3.zip' }` |
| Input | `{ type: 'audio', data: base64Audio }` |
| Options | `{ model_type: 'huggingface' }` |
| Output | `{ output: { text: string, chunks: Array<{ timestamp: [start, end], text }> } }` |

```typescript
const request = {
    model: { bucket: '1317', path: 'fs/whisper-large-v3.zip' },
    input: { type: 'audio', data: base64AudioData },
    options: { model_type: 'huggingface' }
};

const response = await context.fetch(INFERENCE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request)
});
const data = await response.json();
// data.output = { text: "Hello world", chunks: [{ timestamp: [0.0, 1.5], text: "Hello world" }] }
```

**Note:** Whisper response format varies. Parse defensively:
- Format 1: `{ text, chunks }` — direct transcription
- Format 2: `{ transcription, segments }` — alternative keys
- Format 3: Raw string — no segmentation
- Format 4: Array of segments

---

### Qwen3-Embedding-4B (Text Embeddings)

| Field | Value |
|-------|-------|
| Endpoint | `http://202.181.153.253:8000/inference/` |
| Model spec | `{ bucket: '1320', cid: 'fs/Qwen3-Embedding-4B.zip' }` |
| Dimension | 1536 |
| Input | `{ type: 'text', data: string[] }` |
| Options | `{ model_type: 'huggingface', task: 'feature-extraction' }` |
| Output | `{ output: number[][][] }` (may need unwrapping) |

```typescript
const request = {
    model: { bucket: '1320', cid: 'fs/Qwen3-Embedding-4B.zip' },
    input: { type: 'text', data: ['text to embed'] },
    options: { model_type: 'huggingface', task: 'feature-extraction' }
};

const response = await context.fetch(INFERENCE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request)
});
const data = await response.json();

// Output may be nested — unwrap:
let output = data.output;
while (Array.isArray(output) && output.length === 1 && Array.isArray(output[0]) && Array.isArray(output[0][0])) {
    output = output[0];
}
// output[i] is now a number[] embedding for the i-th input text
```

**Post-processing:** Truncate to 1536 dimensions, L2-normalize.

---

### emotion-english-distilroberta-base (Emotion Classification)

| Field | Value |
|-------|-------|
| Endpoint | `http://202.181.153.253:8000/inference/` |
| Model spec | `{ bucket: '1317', path: 'fs/emotion-english-distilroberta-base.zip' }` |
| Input | `[{ type: 'text', data: text }]` |
| Options | `{}` |
| Output | `{ output: [{ label: string, score: number }] }` |
| Labels | anger, disgust, fear, joy, neutral, sadness, surprise |

```typescript
const request = {
    model: { bucket: '1317', path: 'fs/emotion-english-distilroberta-base.zip' },
    input: [{ type: 'text', data: 'I am so happy!' }],
    options: {}
};
// output[0] = { label: 'joy', score: 0.98 }
```

---

### multilingual-sentiment-analysis (Sentiment Polarity)

| Field | Value |
|-------|-------|
| Endpoint | `http://202.181.153.253:8000/inference/` |
| Model spec | `{ bucket: '1320', cid: 'fs/multilingual-sentiment-analysis.zip' }` |
| Input | `{ type: 'text', data: string[] }` |
| Options | `{ model_type: 'huggingface' }` |
| Output | `{ output: [{ label: string }] }` |
| Labels | "Very Negative" (-1), "Negative" (-0.5), "Neutral" (0), "Positive" (0.5), "Very Positive" (1) |

```typescript
const SENTIMENT_LABEL_MAP: Record<string, number> = {
    'Very Negative': -1, 'Negative': -0.5, 'Neutral': 0, 'Positive': 0.5, 'Very Positive': 1
};

const request = {
    model: { bucket: '1320', cid: 'fs/multilingual-sentiment-analysis.zip' },
    input: { type: 'text', data: ['This is terrible'] },
    options: { model_type: 'huggingface' }
};
// SENTIMENT_LABEL_MAP[output[0].label] → -0.5
```

---

### Llama 3.2 11B Vision Instruct (LLM Reasoning)

| Field | Value |
|-------|-------|
| Endpoint | `http://202.181.153.253:8000/inference/` |
| Model spec | `{ bucket: '1317', path: 'fs/llama-3.2-11B-vision-instruct.zip' }` |
| Input | `[{ type: 'text', data: prompt }]` |
| Options | `{ max_tokens: 200 }` |
| Output | `{ output: [{ generated_text: string }] }` or `{ output: string }` |

```typescript
const request = {
    model: { bucket: '1317', path: 'fs/llama-3.2-11B-vision-instruct.zip' },
    input: [{ type: 'text', data: 'Classify this behavior as POSITIVE or NEGATIVE: ...' }],
    options: { max_tokens: 200 }
};
// Parse: data.output[0].generated_text or data.output
```

---

## Model Spec Format

CEF inference endpoints accept models in two formats:

### Path-based (HuggingFace infra)

```typescript
{ bucket: '1317', path: 'fs/model-name.zip' }
```

### CID-based (HuggingFace infra)

```typescript
{ bucket: '1320', cid: 'fs/model-name.zip' }
```

### Named (DDC inference)

```typescript
{ bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' }
```

---

## Bring Your Own Model

To deploy a custom model:

1. Package the model as a zip archive
2. Upload to a DDC bucket
3. Reference it in your handler by bucket + path/CID
4. Use the appropriate inference endpoint

The request format follows the same pattern — specify `model`, `input`, and `options`.

---

## Common Utilities

### Retry wrapper

All inference calls should use a retry wrapper:

```typescript
async function retry(action: () => Promise<any>, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try { return await action(); }
        catch (error) { if (i === retries - 1) throw error; }
    }
}
```

### L2 normalization (for embeddings)

```typescript
function l2Normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return norm === 0 ? vector.slice() : vector.map(val => val / norm);
}
```

### Cosine similarity (for vector matching)

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```
