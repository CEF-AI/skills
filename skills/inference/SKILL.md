---
name: cef-inference
description: Use when calling ML models from a CEF agent handler via context.fetch(). Covers the inference endpoint, model catalog (Qwen2-VL, Qwen3 embeddings, Whisper, emotion, sentiment, YOLO, plate detector, plate OCR), request/response formats, input/output schemas, integration guides, retry patterns, and production-ready handler examples.
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

| Model | Name | Version | Task | Type | Provider | Params | Input |
|-|-|-|-|-|-|-|-|
| Qwen2-VL 7B Instruct | `qwen2-vl-7b-instruct` | `v1.0.0` | text-generation | multimodal | Alibaba | 7B | `prompt`, optional `image`, `max_tokens`, `temperature` |
| Qwen3 Embedding 4B | `qwen3-embedding-4b` | `v1.0.0` | feature-extraction | embedding | Alibaba | 4B | `text` |
| Whisper Large V3 | `whisper_large_v3` | `v1.0.4` | speech-to-text | audio | OpenAI | 1.5B | `audio` (URL or base64) |
| Emotion DistilRoBERTa | `emotion-english-distilroberta-base` | `v1.0.2` | text-classification | nlp | Hugging Face | 82M | `text` |
| Multilingual Sentiment | `multilingual-sentiment-analysis` | `v1.0.0` | text-classification | nlp | Hugging Face | 280M | `text` |
| YOLO11x 1280 | `yolo11x_1280` | `v1.0.0` | object-detection | cv | Ultralytics | 1280 | `image` (URL or base64) |
| YOLO Plate Detector | `yolo-plate-detector` | `v1.0.1` | object-detection | cv | Ultralytics | YOLO | `image` (URL or base64) |
| Fast Plate OCR | `fast-plate-ocr` | `v1.0.0` | image-to-text | cv | Custom | OCR | `image` (URL or base64) |

---

### Qwen2-VL 7B Instruct (Vision-Language / Chat)

Multimodal model for image understanding, visual Q&A, and text-only chat. Supports streaming.

- **Capabilities:** vision, chat, streaming
- **License:** Custom (commercial use allowed)
- **Use cases:** Visual question answering (describe images, answer questions about photos), image captioning and alt-text generation, multimodal chat (text-only or text + image), document understanding (forms, charts, diagrams), multilingual vision (English, Chinese, and 10+ languages)

**Input schema:**

| Parameter | Type | Required | Default | Description |
|-|-|-|-|-|
| prompt | string | Yes | - | User prompt or question |
| image | string | No | - | Image URL or base64 data |
| max_tokens | number | No | 2048 | Max tokens to generate |
| temperature | number | No | 0.8 | Sampling temperature |

**Output schema:** `{ response: string }`

**Handler usage:**

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

**Response:**

```json
{
  "output": { "text": "Paris is the capital of France." },
  "metrics": { "totalTimeMs": 239, "inferenceTimeMs": 239 },
  "requestId": "abc123"
}
```

**cURL example:**

```bash
curl -X POST "https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference" \
  -H "Content-Type: application/json" \
  -d '{"model":{"bucket":1338,"name":"qwen2-vl-7b-instruct","version":"v1.0.0"},"input":{"prompt":"What is the capital of France?","max_tokens":256,"temperature":0.7}}'
```

**JavaScript example (standalone):**

```javascript
const body = {
  model: { bucket: 1338, name: 'qwen2-vl-7b-instruct', version: 'v1.0.0' },
  input: { prompt: 'Describe this image.', image: 'https://example.com/photo.png', max_tokens: 2048, temperature: 0.8 }
};
const res = await fetch('https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const data = await res.json();
console.log(data.output);
```

**Example requests:**

- **Chat** (text-only): `{ prompt: 'What is the capital of France?', max_tokens: 2048, temperature: 0.8 }`
- **Vision** (prompt + image): `{ prompt: 'Describe this image.', image: 'https://example.com/image.png', max_tokens: 2048, temperature: 0.8 }`

---

### Qwen3 Embedding 4B (Text Embeddings)

Instruction-aware embeddings. Supports 100+ languages.

- **Capabilities:** embedding
- **License:** Custom (commercial use allowed)
- **Use cases:** Semantic search (query and document embeddings), RAG and retrieval-augmented generation, document clustering and similarity, multilingual embedding (100+ languages), instruction-aware embeddings for task-specific retrieval

**Input schema:** `{ text: string }` (required)

**Output schema:** `{ embedding: number[] }`

**Handler usage:**

```typescript
const request = {
    model: { bucket: 1338, name: 'qwen3-embedding-4b', version: 'v1.0.0' },
    input: { text: 'What is machine learning?' }
};
// output.embedding = [0.012, -0.034, 0.056, ...]
```

Post-processing: L2-normalize for cosine similarity search.

**Response:**

```json
{
  "output": { "embedding": [0.012, -0.034, 0.056, "..."] },
  "metrics": { "totalTimeMs": 150, "inferenceTimeMs": 150 },
  "requestId": "abc123"
}
```

**cURL example:**

```bash
curl -X POST "https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference" \
  -H "Content-Type: application/json" \
  -d '{"model":{"bucket":1338,"name":"qwen3-embedding-4b","version":"v1.0.0"},"input":{"text":"What is machine learning?"}}'
```

**JavaScript example (standalone):**

```javascript
const body = {
  model: { bucket: 1338, name: 'qwen3-embedding-4b', version: 'v1.0.0' },
  input: { text: 'What is machine learning?' }
};
const res = await fetch('https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const data = await res.json();
console.log(data.output);
```

**Example requests:**

- **Single text:** `{ text: 'What is machine learning?' }`
- **Query:** `{ text: 'How does neural network training work?' }`

---

### Whisper Large V3 (Speech-to-Text)

Multilingual transcription with timestamps.

- **Capabilities:** transcription, multilingual
- **License:** MIT (commercial use allowed)
- **Use cases:** Meeting and call transcription, subtitles and captions for video, voice memos to text, multilingual speech recognition, accessibility (audio to text)

**Input schema:** `{ audio: string }` (required; URL or base64-encoded audio, WAV/MP3)

**Output schema:** `{ text: string, chunks: Array<{ text: string, timestamp: number[] }> }`

**Handler usage:**

```typescript
const request = {
    model: { bucket: 1338, name: 'whisper_large_v3', version: 'v1.0.4' },
    input: { audio: 'https://example.com/recording.mp3' }  // URL or base64
};
```

**Response:**

```json
{
  "output": {
    "text": "Hello, this is the transcribed text.",
    "chunks": [
      { "text": "Hello, ", "timestamp": [0.0, 0.5] },
      { "text": "this is the transcribed text.", "timestamp": [0.5, 2.0] }
    ]
  },
  "metrics": { "totalTimeMs": 3200, "inferenceTimeMs": 3100 },
  "requestId": "abc123"
}
```

**cURL example:**

```bash
curl -X POST "https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference" \
  -H "Content-Type: application/json" \
  -d '{"model":{"bucket":1338,"name":"whisper_large_v3","version":"v1.0.4"},"input":{"audio":"https://cdn.ddc-dragon.com/920/baear4ic7ocixnmtib2z5oqmgth7qofbrun6pb6rocutlrzzisfsvu6xis4/en.mp3"}}'
```

**JavaScript example (standalone):**

```javascript
const body = {
  model: { bucket: 1338, name: 'whisper_large_v3', version: 'v1.0.4' },
  input: { audio: 'https://example.com/recording.mp3' }
};
const res = await fetch('https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const data = await res.json();
console.log(data.output.text);
```

**Example requests:**

- **From URL:** `{ audio: 'https://cdn.ddc-dragon.com/920/baear4ic7ocixnmtib2z5oqmgth7qofbrun6pb6rocutlrzzisfsvu6xis4/en.mp3?source=developer-console' }`
- **From base64:** `{ audio: 'base64_or_url_here' }`

---

### Emotion DistilRoBERTa (Emotion Classification)

Labels: anger, disgust, fear, joy, neutral, sadness, surprise.

- **Capabilities:** classification
- **License:** Apache-2.0 (commercial use allowed)
- **Use cases:** Customer support emotion detection, content moderation (anger, fear), social listening and brand sentiment, chatbot response tuning, mental health and wellness apps

**Input schema:** `{ text: string }` (required)

**Output schema:** `{ label: string, confidence: number, scores: Record<string, number> }`

**Handler usage:**

```typescript
const request = {
    model: { bucket: 1338, name: 'emotion-english-distilroberta-base', version: 'v1.0.2' },
    input: { text: 'I am so happy today!' }
};
```

**Response:**

```json
{
  "output": {
    "label": "joy",
    "confidence": 0.96,
    "scores": { "anger": 0.0015, "disgust": 0.0004, "fear": 0.0004, "joy": 0.9616, "neutral": 0.003, "sadness": 0.0055, "surprise": 0.0276 }
  },
  "metrics": { "totalTimeMs": 85, "inferenceTimeMs": 85 },
  "requestId": "abc123"
}
```

**cURL example:**

```bash
curl -X POST "https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference" \
  -H "Content-Type: application/json" \
  -d '{"model":{"bucket":1338,"name":"emotion-english-distilroberta-base","version":"v1.0.2"},"input":{"text":"I am so happy today!"}}'
```

**JavaScript example (standalone):**

```javascript
const body = {
  model: { bucket: 1338, name: 'emotion-english-distilroberta-base', version: 'v1.0.2' },
  input: { text: 'I am so happy today!' }
};
const res = await fetch('https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const data = await res.json();
console.log(data.output.label, data.output.confidence);
```

**Example requests:**

- **Joy:** `{ text: 'I am so happy today!' }`
- **Sadness:** `{ text: 'I lost my keys and now I am late.' }`
- **Neutral:** `{ text: 'The meeting is at 3 PM.' }`

---

### Multilingual Sentiment Analysis (Sentiment Polarity)

Labels: Very Negative, Negative, Neutral, Positive, Very Positive. Supports 16+ languages.

- **Capabilities:** sentiment
- **License:** Apache-2.0 (commercial use allowed)
- **Use cases:** Product and review sentiment, social media and brand listening, customer feedback analysis, multilingual content moderation (16+ languages), survey and NPS analysis

**Input schema:** `{ text: string }` (required)

**Output schema:** `{ label: string, confidence: number, scores: Record<string, number> }`

**Handler usage:**

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

**Response:**

```json
{
  "output": {
    "label": "Positive",
    "confidence": 0.52,
    "scores": { "Very Negative": 0.016, "Negative": 0.021, "Neutral": 0.044, "Positive": 0.518, "Very Positive": 0.401 }
  },
  "metrics": { "totalTimeMs": 90, "inferenceTimeMs": 90 },
  "requestId": "abc123"
}
```

**cURL example:**

```bash
curl -X POST "https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference" \
  -H "Content-Type: application/json" \
  -d '{"model":{"bucket":1338,"name":"multilingual-sentiment-analysis","version":"v1.0.0"},"input":{"text":"I love this product!"}}'
```

**JavaScript example (standalone):**

```javascript
const body = {
  model: { bucket: 1338, name: 'multilingual-sentiment-analysis', version: 'v1.0.0' },
  input: { text: 'I love this product!' }
};
const res = await fetch('https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const data = await res.json();
console.log(data.output.label, data.output.confidence);
```

**Example requests:**

- **Positive:** `{ text: 'I love this product!' }`
- **Negative:** `{ text: 'This is the worst experience ever.' }`
- **Neutral:** `{ text: 'The package arrived on Tuesday.' }`

---

### YOLO11x 1280 (Object Detection)

General object detection (COCO classes).

- **Capabilities:** object-detection
- **License:** AGPL-3.0 (commercial use allowed)
- **Use cases:** General object detection (COCO classes), inventory and counting, surveillance and security, retail and shelf analytics, industrial quality inspection

**Input schema:** `{ image: string }` (required; URL or base64)

**Output schema:** `{ detections: Array<{ label: string, score: number, box: { xmin, ymin, xmax, ymax } }> }`

**Handler usage:**

```typescript
const request = {
    model: { bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' },
    input: { image: base64ImageData }  // URL or base64
};
```

**Response:**

```json
{
  "output": [
    { "label": "person", "score": 0.95, "box": { "xmin": 10, "ymin": 20, "xmax": 100, "ymax": 200 } }
  ],
  "metrics": { "totalTimeMs": 420, "inferenceTimeMs": 400 },
  "requestId": "abc123"
}
```

**cURL example:**

```bash
curl -X POST "https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference" \
  -H "Content-Type: application/json" \
  -d '{"model":{"bucket":1338,"name":"yolo11x_1280","version":"v1.0.0"},"input":{"image":"https://example.com/photo.jpg"}}'
```

**JavaScript example (standalone):**

```javascript
const body = {
  model: { bucket: 1338, name: 'yolo11x_1280', version: 'v1.0.0' },
  input: { image: 'https://example.com/photo.jpg' }
};
const res = await fetch('https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const data = await res.json();
console.log(data.output);
```

**Example requests:**

- **Detect objects:** `{ image: 'https://cdn.ddc-dragon.com/1337/baear4ierto64hekv7swg2vag6mykpaztxxg26zlomhidfqr4cowe72apoq/353_3076e922-b656-40c0-9e56-78dae7e43556.jpg' }`

---

### YOLO Plate Detector (License Plate Detection)

Detects license plates in images. Outputs bounding boxes and optionally a `plate_image` (cropped base64) for piping to OCR.

- **Capabilities:** object-detection, license-plate
- **License:** Custom (commercial use allowed)
- **Use cases:** License plate detection (bounding boxes), ANPR and toll gate systems, parking and access control, fleet and vehicle tracking, traffic and law enforcement

**Input schema:** `{ image: string }` (required; URL or base64)

**Output schema:** `{ detections: Array<{ label: string, score: number, box: object }> }`

**Handler usage:**

```typescript
const request = {
    model: { bucket: 1338, name: 'yolo-plate-detector', version: 'v1.0.1' },
    input: { image: 'https://example.com/car.jpg' }
};
```

**Response:**

May include `detections` and optionally `plate_image` (cropped plate as base64) for piping to OCR.

```json
{
  "output": {
    "detections": [
      { "label": "plate", "score": 0.9, "box": { "xmin": 50, "ymin": 100, "xmax": 200, "ymax": 140 } }
    ],
    "plate_image": "base64..."
  },
  "metrics": { "totalTimeMs": 310, "inferenceTimeMs": 290 },
  "requestId": "abc123"
}
```

**cURL example:**

```bash
curl -X POST "https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference" \
  -H "Content-Type: application/json" \
  -d '{"model":{"bucket":1338,"name":"yolo-plate-detector","version":"v1.0.1"},"input":{"image":"https://example.com/car.jpg"}}'
```

**JavaScript example (standalone):**

```javascript
const body = {
  model: { bucket: 1338, name: 'yolo-plate-detector', version: 'v1.0.1' },
  input: { image: 'https://example.com/car.jpg' }
};
const res = await fetch('https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const data = await res.json();
console.log(data.output);
```

**Example requests:**

- **Detect plate:** `{ image: 'https://cdn.ddc-dragon.com/1337/baear4ierto64hekv7swg2vag6mykpaztxxg26zlomhidfqr4cowe72apoq/353_3076e922-b656-40c0-9e56-78dae7e43556.jpg' }`

---

### Fast Plate OCR (License Plate Text Recognition)

Reads text from license plate images. Best used after `yolo-plate-detector` crop.

- **Capabilities:** ocr, license-plate
- **License:** Custom (commercial use allowed)
- **Use cases:** License plate text recognition (ANPR), toll and parking payment systems, fleet and vehicle identification, access control and gated communities, pipeline: use after yolo-plate-detector crop

**Input schema:** `{ image: string }` (required; URL or base64)

**Output schema:** `{ plate: string, avg_confidence: number }`

**Handler usage:**

```typescript
const request = {
    model: { bucket: 1338, name: 'fast-plate-ocr', version: 'v1.0.0' },
    input: { image: 'https://example.com/plate-crop.jpg' }
};
```

**Response:**

```json
{
  "output": {
    "plate": "AB12 CDE",
    "avg_confidence": 0.96
  },
  "metrics": { "totalTimeMs": 180, "inferenceTimeMs": 160 },
  "requestId": "abc123"
}
```

**cURL example:**

```bash
curl -X POST "https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference" \
  -H "Content-Type: application/json" \
  -d '{"model":{"bucket":1338,"name":"fast-plate-ocr","version":"v1.0.0"},"input":{"image":"https://example.com/plate.jpg"}}'
```

**JavaScript example (standalone):**

```javascript
const body = {
  model: { bucket: 1338, name: 'fast-plate-ocr', version: 'v1.0.0' },
  input: { image: 'https://example.com/plate.jpg' }
};
const res = await fetch('https://compute-5.devnet.ddc-dragon.com/inference/api/v1/inference', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
const data = await res.json();
console.log(data.output.plate, data.output.avg_confidence);
```

**Example requests:**

- **Read plate:** `{ image: 'https://cdn.ddc-dragon.com/1337/baear4ierto64hekv7swg2vag6mykpaztxxg26zlomhidfqr4cowe72apoq/353_3076e922-b656-40c0-9e56-78dae7e43556.jpg' }`

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
