---
name: cef-inference
description: Use when calling ML models from a CEF agent handler via context.fetch(). Covers the inference endpoint, model catalog (Qwen2-VL, Qwen3 embeddings, Whisper, emotion, sentiment, YOLO, plate detector, plate OCR), request/response formats, retry patterns, and production-ready handler examples.
---

# CEF Inference

All model inference in CEF goes through `context.fetch()` to the inference endpoint. Never use `context.models`; it does not exist in production.

> **Reminder:** All handler code must be fully inline. No `import` or `require`. See the **coding** skill.

## Inference Endpoint

All models run on the same endpoint and bucket:

```
POST https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference
```

Every request follows the same structure:

```typescript
const response = await context.fetch(
    'https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference',
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: { bucket: 1338, name: MODEL_NAME, version: MODEL_VERSION },
            input: { ... }
        })
    }
);
const data = await response.json();
// data.output   - model-specific output
// data.metrics  - { totalTimeMs, inferenceTimeMs }
// data.requestId
```

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

All models: bucket `1338`, endpoint `https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference`.

| Model | Name | Version | Task | Input |
|-|-|-|-|-|
| Qwen2-VL 7B Instruct | `qwen2-vl-7b-instruct` | `v1.0.0` | Vision-language / chat | `prompt`, optional `image`, `max_tokens`, `temperature` |
| Qwen3 Embedding 4B | `qwen3-embedding-4b` | `v1.0.0` | Text embeddings | `text` |
| Whisper Large V3 | `whisper_large_v3` | `v1.0.4` | Speech-to-text | `audio` (URL or base64) |
| Emotion DistilRoBERTa | `emotion-english-distilroberta-base` | `v1.0.2` | Emotion classification | `text` |
| Multilingual Sentiment | `multilingual-sentiment-analysis` | `v1.0.0` | Sentiment polarity | `text` |
| YOLO11x 1280 | `yolo11x_1280` | `v1.0.0` | Object detection | `image` (URL or base64) |
| YOLO Plate Detector | `yolo-plate-detector` | `v1.0.1` | License plate detection | `image` (URL or base64) |
| Fast Plate OCR | `fast-plate-ocr` | `v1.0.0` | Plate text recognition | `image` (URL or base64) |

---

### Qwen2-VL 7B Instruct (Vision-Language / Chat)

Multimodal model for image understanding, visual Q&A, and text-only chat. Supports streaming.

```typescript
// Text-only chat
const request = {
    model: { bucket: 1338, name: 'qwen2-vl-7b-instruct', version: 'v1.0.0' },
    input: { prompt: 'What is the capital of France?', max_tokens: 2048, temperature: 0.8 }
};

// Vision: prompt + image
const request = {
    model: { bucket: 1338, name: 'qwen2-vl-7b-instruct', version: 'v1.0.0' },
    input: {
        prompt: 'Describe this image.',
        image: 'https://example.com/photo.png',  // URL or base64
        max_tokens: 2048,
        temperature: 0.8
    }
};
```

| Parameter | Type | Required | Default | Description |
|-|-|-|-|-|
| prompt | string | Yes | - | User prompt or question |
| image | string | No | - | Image URL or base64 data |
| max_tokens | number | No | 2048 | Max tokens to generate |
| temperature | number | No | 0.8 | Sampling temperature |

Response:

```json
{
  "output": { "text": "Paris is the capital of France." },
  "metrics": { "totalTimeMs": 239, "inferenceTimeMs": 239 }
}
```

---

### Qwen3 Embedding 4B (Text Embeddings)

Instruction-aware embeddings. Supports 100+ languages.

```typescript
const request = {
    model: { bucket: 1338, name: 'qwen3-embedding-4b', version: 'v1.0.0' },
    input: { text: 'What is machine learning?' }
};
// output.embedding = [0.012, -0.034, 0.056, ...]
```

Post-processing: L2-normalize for cosine similarity search.

---

### Whisper Large V3 (Speech-to-Text)

Multilingual transcription with timestamps.

```typescript
const request = {
    model: { bucket: 1338, name: 'whisper_large_v3', version: 'v1.0.4' },
    input: { audio: 'https://example.com/recording.mp3' }  // URL or base64
};
```

Response:

```json
{
  "output": {
    "text": "Hello, this is the transcribed text.",
    "chunks": [
      { "text": "Hello, ", "timestamp": [0.0, 0.5] },
      { "text": "this is the transcribed text.", "timestamp": [0.5, 2.0] }
    ]
  }
}
```

---

### Emotion DistilRoBERTa (Emotion Classification)

Labels: anger, disgust, fear, joy, neutral, sadness, surprise.

```typescript
const request = {
    model: { bucket: 1338, name: 'emotion-english-distilroberta-base', version: 'v1.0.2' },
    input: { text: 'I am so happy today!' }
};
```

Response:

```json
{
  "output": {
    "label": "joy",
    "confidence": 0.96,
    "scores": { "anger": 0.001, "disgust": 0.0, "fear": 0.0, "joy": 0.96, "neutral": 0.003, "sadness": 0.005, "surprise": 0.027 }
  }
}
```

---

### Multilingual Sentiment Analysis (Sentiment Polarity)

Labels: Very Negative, Negative, Neutral, Positive, Very Positive. Supports 16+ languages.

```typescript
const SENTIMENT_LABEL_MAP: Record<string, number> = {
    'Very Negative': -1, 'Negative': -0.5, 'Neutral': 0, 'Positive': 0.5, 'Very Positive': 1
};

const request = {
    model: { bucket: 1338, name: 'multilingual-sentiment-analysis', version: 'v1.0.0' },
    input: { text: 'I love this product!' }
};
// SENTIMENT_LABEL_MAP[output.label] -> 0.5
```

Response:

```json
{
  "output": {
    "label": "Positive",
    "confidence": 0.52,
    "scores": { "Very Negative": 0.016, "Negative": 0.021, "Neutral": 0.044, "Positive": 0.518, "Very Positive": 0.401 }
  }
}
```

---

### YOLO11x 1280 (Object Detection)

General object detection (COCO classes).

```typescript
const request = {
    model: { bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' },
    input: { image: base64ImageData }  // URL or base64
};
```

Response:

```json
{
  "output": [
    { "label": "person", "score": 0.95, "box": { "xmin": 10, "ymin": 20, "xmax": 100, "ymax": 200 } }
  ],
  "metrics": { "totalTimeMs": 420, "inferenceTimeMs": 400 }
}
```

---

### YOLO Plate Detector (License Plate Detection)

Detects license plates in images. Outputs bounding boxes and optionally a `plate_image` (cropped base64) for piping to OCR.

```typescript
const request = {
    model: { bucket: 1338, name: 'yolo-plate-detector', version: 'v1.0.1' },
    input: { image: 'https://example.com/car.jpg' }
};
```

Response:

```json
{
  "output": {
    "detections": [
      { "label": "plate", "score": 0.9, "box": { "xmin": 50, "ymin": 100, "xmax": 200, "ymax": 140 } }
    ],
    "plate_image": "base64..."
  }
}
```

---

### Fast Plate OCR (License Plate Text Recognition)

Reads text from license plate images. Best used after `yolo-plate-detector` crop.

```typescript
const request = {
    model: { bucket: 1338, name: 'fast-plate-ocr', version: 'v1.0.0' },
    input: { image: 'https://example.com/plate-crop.jpg' }
};
```

Response:

```json
{
  "output": {
    "plate": "AB12 CDE",
    "avg_confidence": 0.96
  }
}
```

---

## Common Pipelines

### Plate Detection + OCR

```typescript
// Step 1: Detect plate
const detection = await retry(async () => {
    const res = await ctx.fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: { bucket: 1338, name: 'yolo-plate-detector', version: 'v1.0.1' },
            input: { image }
        })
    });
    if (!res.ok) throw new Error(`Plate detection failed: ${res.status}`);
    return res.json();
});

if (detection.output.plate_image) {
    // Step 2: OCR the cropped plate
    const ocr = await retry(async () => {
        const res = await ctx.fetch(ENDPOINT, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: { bucket: 1338, name: 'fast-plate-ocr', version: 'v1.0.0' },
                input: { image: detection.output.plate_image }
            })
        });
        if (!res.ok) throw new Error(`OCR failed: ${res.status}`);
        return res.json();
    });
    return { plate: ocr.output.plate, confidence: ocr.output.avg_confidence };
}
```

### Vision Q&A + Sentiment

```typescript
const [visionResult, sentimentResult] = await Promise.all([
    callModel('qwen2-vl-7b-instruct', 'v1.0.0',
        { prompt: 'Describe what is happening.', image, max_tokens: 512 }, ctx),
    callModel('multilingual-sentiment-analysis', 'v1.0.0',
        { text: userComment }, ctx)
]);
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

### Generic Model Caller

```typescript
const ENDPOINT = 'https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference';

async function callModel(name: string, version: string, input: any, ctx: any): Promise<any> {
    return retry(async () => {
        const res = await ctx.fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: { bucket: 1338, name, version }, input })
        });
        if (!res.ok) throw new Error(`${name} failed: ${res.status}`);
        return res.json();
    });
}
```

## Complete Production Examples

### YOLO Object Detection Handler

```typescript
const ENDPOINT = 'https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference';

async function retry(action: () => Promise<any>, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try { return await action(); }
        catch (error) { if (i === retries - 1) throw error; }
    }
}

async function handle(event: any, ctx: any) {
    const { image } = event.payload;

    const data = await retry(async () => {
        const res = await ctx.fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: { bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' },
                input: { image }
            })
        });
        if (!res.ok) throw new Error(`YOLO failed: ${res.status}`);
        return res.json();
    });

    return {
        totalDetections: data.output.length,
        detections: data.output,
        processingTime: data.metrics.inferenceTimeMs
    };
}
```

### Text Embedding Handler (Qwen3)

```typescript
const ENDPOINT = 'https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference';

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

async function handle(event: any, ctx: any) {
    const { text } = event.payload;
    if (!text) throw new Error('Missing text input');

    const data = await retry(async () => {
        const res = await ctx.fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: { bucket: 1338, name: 'qwen3-embedding-4b', version: 'v1.0.0' },
                input: { text }
            })
        });
        if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
        return res.json();
    });

    return { embedding: l2Normalize(data.output.embedding) };
}
```

### Dual-Model Sentiment Handler (Parallel)

```typescript
const ENDPOINT = 'https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference';

const SENTIMENT_LABEL_MAP: Record<string, number> = {
    'Very Negative': -1, 'Negative': -0.5, 'Neutral': 0, 'Positive': 0.5, 'Very Positive': 1
};

async function retry(action: () => Promise<any>, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try { return await action(); }
        catch (error) { if (i === retries - 1) throw error; }
    }
}

async function callModel(name: string, version: string, input: any, ctx: any): Promise<any> {
    return retry(async () => {
        const res = await ctx.fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: { bucket: 1338, name, version }, input })
        });
        if (!res.ok) throw new Error(`${name} failed: ${res.status}`);
        return res.json();
    });
}

async function handle(event: any, ctx: any) {
    const { text } = event.payload;

    const [emotionData, sentimentData] = await Promise.all([
        callModel('emotion-english-distilroberta-base', 'v1.0.2', { text }, ctx)
            .catch(() => ({ output: { label: 'neutral', confidence: 0 } })),
        callModel('multilingual-sentiment-analysis', 'v1.0.0', { text }, ctx)
            .catch(() => ({ output: { label: 'Neutral', confidence: 0 } }))
    ]);

    return {
        sentiment: SENTIMENT_LABEL_MAP[sentimentData.output.label] ?? 0,
        sentimentConfidence: sentimentData.output.confidence,
        emotion: emotionData.output.label,
        emotionConfidence: emotionData.output.confidence
    };
}
```

## Related Skills

- **coding**: Handler signature, runtime API, orchestration patterns, topology generation
- **cli**: Config schema, deploy commands, environment setup
- **storage**: Storing inference results persistently
