---
name: cef-inference
description: Use when calling ML models from a CEF agent handler. Inference goes through `context.models.<alias>.infer(input)` (non-streaming) or `context.models.<alias>.stream(input)` (streaming). Covers the full 16-model registry — yolo, yoloXL, whisper, whisperTiny, whisperLarge, llm, llamaVision, qwenVision, qwenCoder, mistral7b, mistralSmall, embedding, emotionClassifier, sentimentAnalysis, plateDetector, plateOcr — with input/output schemas, handler examples, streaming consumption, and common pipelines.
---

# CEF Inference

Inference runs through the **Context API**. Each model is exposed on `context.models` by a JS-safe **alias** that the Agent Runtime injects into your V8 isolate from your Agent Service's model registry at execution time. There is no URL to call, no bucket number, no version string — just the alias.

```typescript
const result = await context.models.yolo.infer({ image: event.payload.image });
// result: { detections: [...], status: 'success', model: '...' }
```

> **Handler code is fully inline.** No `import` / `require` (V8 isolate). See the **coding** skill.

## The two methods

Every model exposes `.infer()`. Streaming-capable models also expose `.stream()`.

```typescript
// Non-streaming — returns the full output once the model is done.
const out = await context.models.<alias>.infer(input);

// Streaming — yields chunks as they arrive (SSE). Only on streaming models.
for await (const chunk of context.models.<alias>.stream(input)) {
    // ...
}
```

- `input` is the **raw JSON-Schema fields** of the model's `inputSchema`. **Not** wrapped in `{ input: ... }`. For `yolo` that means `{ image, confidence? }`, not `{ input: { image } }`.
- `infer()` returns `Promise<Output>` matching the model's `outputSchema`.
- `stream()` returns an async iterable — consume with `for await`. Each chunk matches the model's streaming `outputSchema`.
- Timeouts, retries, and routing (GPU node selection, cold-start handling) are handled by the runtime. Do **not** wrap calls in manual retry loops — the Agent Runtime → Orchestrator → Inference Gateway layer already retries transient failures.

## Streaming consumption

Use `for await` to process chunks as they arrive; accumulate if you want the full result at the end.

```typescript
// Accumulate a full LLM response
let full = '';
for await (const chunk of context.models.llm.stream({ prompt: 'Write a haiku about SQLite' })) {
    full += chunk.text ?? '';
}
return { text: full };
```

```typescript
// Transcribe audio incrementally and log progress
for await (const chunk of context.models.whisperLarge.stream({ audio, language: 'en' })) {
    context.log('Token:', chunk.text);
}
```

If you do not need per-chunk processing, prefer `.infer()` — it buffers the full response in one call.

---

## Model Catalog

All aliases are injected into `context.models.<alias>`. `Stream` means `.stream()` is available in addition to `.infer()`.

| Alias | Underlying model | Version | Task | Stream | Pricing |
|---|---|---|---|---|---|
| `yolo` | yolo11n_ensemble | v1.0.2 | object-detection | — | $0.00112 / image |
| `yoloXL` | yolo11x_1280 | v1.0.0 | object-detection | — | $0.0056 / image |
| `plateDetector` | yolo_plate_detector | v1.0.1 | object-detection | — | $0.002 / image |
| `plateOcr` | fast_plate_ocr | v1.0.0 | image-classification | — | $0.001 / image |
| `whisperTiny` | whisper-tiny | v1.0.0 | speech-to-text | — | $0.0000015 in / $0.000006 out per token |
| `whisper` | whisper_tiny | v1.0.0 | speech-to-text | ✓ | $0.0000015 in / $0.000006 out per token |
| `whisperLarge` | whisper_large_v3 | v1.0.5 | speech-to-text | ✓ | $0.000005 in / $0.00002 out per token |
| `llm` | smollm_135m | v1.0.0 | text-generation | ✓ | $0.00001 in / $0.00005 out per token |
| `qwenVision` | qwen2-vl-7b-instruct | v1.0.2 | text-generation (VLM) | ✓ | $0.00003 in / $0.00012 out per token |
| `llamaVision` | llama-3.2-11b-vision-instruct | v1.0.0 | text-generation (VLM) | ✓ | $0.00004 in / $0.00016 out per token |
| `mistral7b` | mistral-7b-instruct | v0.3.0 | text-generation | ✓ | $0.00003 in / $0.00012 out per token |
| `mistralSmall` | mistral-small-3.1-24b | v1.0.0 | text-generation | ✓ | $0.00008 in / $0.00032 out per token |
| `qwenCoder` | qwen3-coder-next | v1.0.0 | text-generation (code) | ✓ | $0.00005 in / $0.0002 out per token |
| `embedding` | qwen3-embedding-4b | v1.0.0 | feature-extraction | ✓ | $0.00002 / token |
| `emotionClassifier` | emotion-english-distilroberta-base | v1.0.2 | text-classification | — | $0.0005 / call |
| `sentimentAnalysis` | multilingual-sentiment-analysis | v1.0.0 | text-classification | — | $0.0005 / call |

---

## Per-model reference

### `yolo` — General object detection (fast)

YOLO11 Nano ensemble — fast, low-cost default for COCO-class object detection.

**Input** — `{ image: string; confidence?: number; iou?: number }`
- `image` (required): URL or base64-encoded image
- `confidence` (default `0.25`): minimum detection confidence (0-1)
- `iou` (default `0.45`): IoU threshold for non-maximum suppression (0-1)

**Output** — `{ detections: Array<{ label: string; confidence: number; box: { xmin, ymin, xmax, ymax } }>; model: string; status: 'success' | 'error' }`

```typescript
async function handle(event: any, context: any) {
    const result = await context.models.yolo.infer({
        image: event.payload.image,
        confidence: 0.3
    });
    return { count: result.detections.length, detections: result.detections };
}
```

---

### `yoloXL` — High-accuracy object detection at 1280×1280

YOLO11 Extra Large at 1280×1280. Best for aerial/drone imagery and small-object cases. ~5× more expensive than `yolo` but much higher recall on small objects.

**Input** — `{ image: string }` (URL or base64)

**Output** — `{ count: number; detections: Array<{ label: string; class_id: number; confidence: number; box: { xmin, ymin, xmax, ymax } }>; input_size: [number, number]; status: 'success' | 'error' }`

> **Coordinate space:** `box` coordinates are in the **model input space (1280×1280 letterboxed)**, not the original image. Use `input_size` to rescale back to the source image dimensions.

```typescript
async function handle(event: any, context: any) {
    const result = await context.models.yoloXL.infer({ image: event.payload.image });

    // Rescale boxes from 1280×1280 letterboxed space back to source coords if you know the source size.
    const [modelW, modelH] = result.input_size;
    context.log(`Detected ${result.count} objects in ${modelW}×${modelH} space`);
    return result;
}
```

---

### `plateDetector` — License plate detection

YOLOv9-S trained on global license plate data (Precision 0.957, Recall 0.917, mAP50 0.966). Use before `plateOcr`.

**Input** — `{ image: string }`

**Output** — `{ count: number; detections: Array<{ label: string; confidence: number; box: { xmin, ymin, xmax, ymax } }>; input_size: [number, number] }`

```typescript
const det = await context.models.plateDetector.infer({ image: event.payload.image });
for (const plate of det.detections) {
    context.log('Plate box:', plate.box, 'confidence:', plate.confidence);
}
```

---

### `plateOcr` — Plate text recognition

Fast CCT-S-ReLU OCR model. Trained on 220k+ plates from 65+ countries. Expects a **cropped** plate image (run `plateDetector` + `context.image.crop` first).

**Input** — `{ image: string }` (cropped plate image as URL or base64)

**Output** — `{ plate: string; avg_confidence: number; confidence: number[] }`

```typescript
const ocr = await context.models.plateOcr.infer({ image: croppedPlateBase64 });
return { text: ocr.plate, confidence: ocr.avg_confidence };
```

---

### `whisperTiny` — Speech-to-text (small, non-streaming)

Whisper Tiny. Smallest + cheapest ASR option for short audio.

**Input** — `{ audio: string }` (URL or base64-encoded audio; WAV/MP3)

**Output** — `{ text: string; language: string; status: string }`

```typescript
const r = await context.models.whisperTiny.infer({ audio: event.payload.audioUrl });
return { transcript: r.text, language: r.language };
```

---

### `whisper` — Speech-to-text (streaming tiny)

Streaming variant of Whisper Tiny. Same model as `whisperTiny` but delivers tokens incrementally via `.stream()`.

**Input** — `{ audio: string }`

**Output per chunk** — `{ text: string }`

```typescript
let transcript = '';
for await (const chunk of context.models.whisper.stream({ audio: event.payload.audioUrl })) {
    transcript += chunk.text ?? '';
    context.log('partial:', transcript);
}
return { transcript };
```

---

### `whisperLarge` — Speech-to-text (high accuracy, multilingual, streaming)

Whisper Large V3. Supports language hints, context prompts, timestamps, and transcribe-vs-translate modes.

**Input:**
- `audio` (required): URL or base64
- `language` (optional): ISO 639-1 code — set to the source language to keep original (`'en'`, `'fr'`, `'zh'`, etc.). Default `'en'`.
- `prompt` (optional): context hint (proper nouns, domain terms) to improve recognition
- `return_timestamps` (optional, non-streaming only): word-level timestamps
- `task` (optional): `'transcribe'` (keep source language) or `'translate'` (→ English)

**Output** — `{ text: string; chunks?: Array<{ text: string; timestamp: number[] }> }`

```typescript
// Non-streaming with timestamps
const full = await context.models.whisperLarge.infer({
    audio: event.payload.audioUrl,
    language: 'en',
    return_timestamps: true,
    prompt: 'CEF, DDC, cubby, raft'
});

// Streaming (no timestamps — request per-token text)
let partial = '';
for await (const chunk of context.models.whisperLarge.stream({
    audio: event.payload.audioUrl,
    language: 'es',
    task: 'translate'
})) {
    partial += chunk.text ?? '';
}
```

---

### `llm` — SmolLM 135M (tiny streaming LLM for testing)

SmolLM 135M Instruct. Very small + cheap LLM — ideal for dev, tests, and simple classification/rewrites. Not for high-quality generation.

**Input** — `{ prompt: string }`

**Output per chunk (stream)** — `{ text: string }` · **Output (infer)** — `{ text: string }`

```typescript
// Non-streaming
const { text } = await context.models.llm.infer({ prompt: 'Summarize: ' + event.payload.article });

// Streaming
let out = '';
for await (const chunk of context.models.llm.stream({ prompt: event.payload.prompt })) {
    out += chunk.text ?? '';
}
```

---

### `qwenVision` — Qwen2-VL 7B Instruct (vision-language, streaming)

Multimodal VLM: describe images, answer questions about images, or pure text chat.

**Input:**
- `prompt` (required): user instruction / question
- `image` (optional): URL, base64, or data URL — omit for text-only chat
- `max_tokens` (optional, default 256)
- `temperature` (optional, default 0.7)
- `stop` (optional): `string[]` of stop sequences

**Output** — `{ text: string }` (same for `.infer()` and each `.stream()` chunk)

```typescript
// Visual Q&A
const { text } = await context.models.qwenVision.infer({
    prompt: 'What color is the car and is the driver wearing a seatbelt?',
    image: event.payload.imageUrl,
    max_tokens: 200
});

// Streamed chat
let reply = '';
for await (const chunk of context.models.qwenVision.stream({
    prompt: 'Tell me a short story about a robot.',
    temperature: 0.9,
    max_tokens: 300
})) {
    reply += chunk.text ?? '';
}
```

---

### `llamaVision` — Llama 3.2 11B Vision Instruct (streaming)

Larger vision-language model. Higher quality than `qwenVision` on many benchmarks, but more expensive.

**Input** — `{ prompt: string; image?: string; max_tokens?: number; temperature?: number; stop?: string[] }`

**Output** — `{ text: string }`

```typescript
const { text } = await context.models.llamaVision.infer({
    prompt: 'List the visible brands in this photo as a JSON array.',
    image: event.payload.imageUrl,
    max_tokens: 512,
    temperature: 0.2
});
```

---

### `mistral7b` — Mistral 7B Instruct v0.3 (streaming)

Efficient general-purpose instruction-tuned LLM. Apache 2.0. Good cost/quality baseline.

**Input** — `{ prompt: string; max_tokens?: number; temperature?: number }`

**Output** — `{ text: string }`

```typescript
let answer = '';
for await (const chunk of context.models.mistral7b.stream({
    prompt: event.payload.question,
    max_tokens: 800,
    temperature: 0.3
})) {
    answer += chunk.text ?? '';
}
```

---

### `mistralSmall` — Mistral Small 3.1 24B Instruct (streaming, 128K context)

Larger Mistral with 128K context. Use when the prompt is long (long document QA, big logs, multi-turn transcripts).

**Input** — `{ prompt: string; max_tokens?: number; temperature?: number }`

**Output** — `{ text: string }`

```typescript
const { text } = await context.models.mistralSmall.infer({
    prompt: longDocument + '\n\nQuestion: ' + event.payload.question,
    max_tokens: 1024,
    temperature: 0.2
});
```

---

### `qwenCoder` — Qwen3-Coder-Next (80B MoE, 256K context, streaming)

Coding-focused agent model. Use for code generation, refactoring, and code-aware reasoning.

**Input** — `{ prompt: string; max_tokens?: number; temperature?: number }`

**Output** — `{ text: string }`

```typescript
const { text } = await context.models.qwenCoder.infer({
    prompt: 'Convert this SQL to TypeScript:\n' + event.payload.sql,
    max_tokens: 1500,
    temperature: 0.1
});
```

---

### `embedding` — Qwen3 Embedding 4B (multilingual, 100+ languages)

2560-dim multilingual embeddings with MRL (Matryoshka) support — you can request smaller dims if you want to cut storage. Supports optional task instructions for instruction-aware retrieval.

**Input:**
- `text` (required): text to embed
- `dimensions` (optional, 32–2560): output dimension for MRL; default 2560
- `instruction` (optional): task instruction for instruction-aware retrieval (e.g., `"Given a question, retrieve passages that answer it"`)

**Output** — `{ embedding: number[]; dimensions: number }`

Prefer `.infer()` for embeddings (single vector — nothing to stream incrementally).

```typescript
const { embedding } = await context.models.embedding.infer({
    text: event.payload.query,
    dimensions: 768,
    instruction: 'Given a search query, retrieve relevant passages'
});

// L2-normalize for cosine similarity search (see Utilities section)
const normalized = l2Normalize(embedding);
```

---

### `emotionClassifier` — 7-class English emotion

Labels: `anger`, `disgust`, `fear`, `joy`, `neutral`, `sadness`, `surprise`. English only.

**Input** — `{ text: string }`

**Output** — `{ label: string; confidence: number; scores: Record<string, number> }`

```typescript
const r = await context.models.emotionClassifier.infer({ text: event.payload.message });
context.log(`Emotion: ${r.label} (${r.confidence.toFixed(2)})`);
```

---

### `sentimentAnalysis` — 5-class multilingual sentiment

23 languages. Labels: `Very Negative`, `Negative`, `Neutral`, `Positive`, `Very Positive`.

**Input** — `{ text: string }`

**Output** — `{ label: 'Very Negative' | 'Negative' | 'Neutral' | 'Positive' | 'Very Positive'; confidence: number; scores: Record<string, number> }`

```typescript
const SENTIMENT_SCORE: Record<string, number> = {
    'Very Negative': -1, 'Negative': -0.5, 'Neutral': 0, 'Positive': 0.5, 'Very Positive': 1
};

const r = await context.models.sentimentAnalysis.infer({ text: event.payload.review });
return { score: SENTIMENT_SCORE[r.label] ?? 0, label: r.label, confidence: r.confidence };
```

---

## Common Pipelines

### Plate detection → crop → OCR

Combines `plateDetector`, `context.image.crop`, and `plateOcr`. `context.image.*` is a native binding — see the **coding** skill.

```typescript
async function handle(event: any, context: any) {
    const { imageBytes } = event.payload;  // Uint8Array of the source image

    const det = await context.models.plateDetector.infer({ image: event.payload.imageUrl });
    if (det.count === 0) return { plates: [] };

    const plates: Array<{ text: string; confidence: number }> = [];
    for (const plate of det.detections) {
        const crop = context.image.crop(imageBytes, plate.box);
        if ('error' in crop) { context.log('Crop failed:', crop.error); continue; }

        // context.image.encode → Uint8Array; convert to base64 for model input
        const base64 = bytesToBase64(crop.data);
        const ocr = await context.models.plateOcr.infer({ image: base64 });
        plates.push({ text: ocr.plate, confidence: ocr.avg_confidence });
    }
    return { plates };
}

function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}
```

### Vision Q&A + sentiment

```typescript
const [vision, sentiment] = await Promise.all([
    context.models.qwenVision.infer({ prompt: 'Describe the mood of this scene.', image, max_tokens: 200 }),
    context.models.sentimentAnalysis.infer({ text: event.payload.comment })
]);
return { description: vision.text, reviewerSentiment: sentiment.label };
```

### Streaming transcription → summarization

```typescript
// 1. Transcribe streamed audio
let transcript = '';
for await (const chunk of context.models.whisperLarge.stream({
    audio: event.payload.audioUrl,
    language: 'en'
})) {
    transcript += chunk.text ?? '';
}

// 2. Summarize the full transcript
const { text: summary } = await context.models.mistralSmall.infer({
    prompt: `Summarize this meeting in 5 bullet points:\n\n${transcript}`,
    max_tokens: 400,
    temperature: 0.3
});

return { transcript, summary };
```

### Semantic search with embeddings

```typescript
// Query embedding (small dimensions = smaller cubby rows, faster sqlite-vec)
const { embedding: queryVec } = await context.models.embedding.infer({
    text: event.payload.query,
    dimensions: 768
});

// Search cubby via sqlite-vec (see **storage** skill)
const rows = await context.cubbies.docs.query('default',
    `SELECT id, distance FROM docs_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 5`,
    [new Float32Array(l2Normalize(queryVec)).buffer]
);
return rows;
```

---

## Utilities (inline per handler)

### L2 normalize

```typescript
function l2Normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    return norm === 0 ? vector.slice() : vector.map(v => v / norm);
}
```

### Cosine similarity

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
```

---

## Complete production examples

### YOLO detection handler

```typescript
async function handle(event: any, context: any) {
    const { image } = event.payload;
    if (!image) throw new Error('Missing image');

    const result = await context.models.yolo.infer({ image, confidence: 0.3 });

    return {
        count: result.detections.length,
        detections: result.detections,
        status: result.status
    };
}
```

### Embedding handler (normalized output)

```typescript
function l2Normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    return norm === 0 ? vector.slice() : vector.map(v => v / norm);
}

async function handle(event: any, context: any) {
    const { text } = event.payload;
    if (!text) throw new Error('Missing text');

    const { embedding, dimensions } = await context.models.embedding.infer({
        text,
        dimensions: 768
    });

    return { embedding: l2Normalize(embedding), dimensions };
}
```

### Dual-model sentiment (parallel, fault-tolerant)

```typescript
const SENTIMENT_SCORE: Record<string, number> = {
    'Very Negative': -1, 'Negative': -0.5, 'Neutral': 0, 'Positive': 0.5, 'Very Positive': 1
};

async function handle(event: any, context: any) {
    const { text } = event.payload;

    const [emotion, sentiment] = await Promise.all([
        context.models.emotionClassifier.infer({ text })
            .catch((e: any) => { context.log('emotion failed:', e.message); return { label: 'neutral', confidence: 0 }; }),
        context.models.sentimentAnalysis.infer({ text })
            .catch((e: any) => { context.log('sentiment failed:', e.message); return { label: 'Neutral', confidence: 0 }; })
    ]);

    return {
        sentiment: SENTIMENT_SCORE[sentiment.label] ?? 0,
        sentimentLabel: sentiment.label,
        sentimentConfidence: sentiment.confidence,
        emotion: emotion.label,
        emotionConfidence: emotion.confidence
    };
}
```

### Streaming chat handler (LLM)

```typescript
async function handle(event: any, context: any) {
    const { prompt } = event.payload;
    if (!prompt) throw new Error('Missing prompt');

    let text = '';
    for await (const chunk of context.models.mistral7b.stream({
        prompt,
        max_tokens: 800,
        temperature: 0.3
    })) {
        text += chunk.text ?? '';
    }

    return { text };
}
```

---

## Related Skills

- **coding**: Handler signature, `CEFContext` shape, orchestration patterns (concierge, stream processor, fan-out, pipeline), `context.image.*` for crop/resize/encode
- **cli**: `cef.config.yaml` schema, deploy commands, `cef dev`, naming conventions
- **storage**: Persisting inference results, `sqlite-vec` for embedding search, per-entity instance isolation
- **clientsdk**: Sending events with payloads that inference handlers will consume
