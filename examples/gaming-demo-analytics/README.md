# Gaming Demo — Real-Time Player Analytics

A multi-agent pipeline that processes player audio and game data during a match to build topic trees, detect behavioral patterns, and deliver real-time insights.

## Goal

"Analyze a player's voice chat and in-game events during a match. Transcribe speech, detect sentiment and emotions, cluster topics they talk about, and identify behavioral patterns like tilt risk or frustration."

## Architecture

```
Two parallel streams: audio + game data
  → Engagement: concierge subscribes to both streams via Promise.all
    │
    ├── Audio stream pipeline:
    │   → speechToTextAgent.transcribe() → text
    │   → sentimentAgent.analyze() → sentiment + emotion
    │   → embeddingAgent.embed() → vector
    │   → topicAgent.matchTopic() → topic assignment
    │   → topicAgent.updateTopic() or accumulate unassigned
    │
    ├── Game data stream:
    │   → gameDataAgent stores moments to cubby
    │   → Accumulates key events (kills, deaths, etc.)
    │
    └── Post-match processing:
        → clusteringAgent.cluster() → new topics from unassigned
        → topicAgent.createTopic() → backfill utterances
        → patternAgent.analyzeBatch() → behavioral classification
```

## Entity Graph

| Entity | Name | Alias | Purpose |
|--------|------|-------|---------|
| Engagement | Concierge | — | Orchestrates audio + game data processing |
| Agent | Speech To Text | `speechToTextAgent` | Whisper Large v3 transcription |
| Agent | Sentiment | `sentimentAgent` | Dual-model sentiment + emotion |
| Agent | Embedding | `embeddingAgent` | Qwen3-Embedding-4B (1536d) |
| Agent | Topic | `topicAgent` | Match, create, and update topics |
| Task | Match Topic | `matchTopic` | Cosine similarity matching |
| Task | Create Topic | `createTopic` | Create from clustered embeddings |
| Task | Update Topic | `updateTopic` | Update centroid and sentiment |
| Agent | Clustering | `clusteringAgent` | HDBSCAN embedding clustering |
| Agent | Game Data | `gameDataAgent` | Store game moments |
| Agent | Pattern | `patternAgent` | LLM-based behavior classification |
| Cubby | gameDemo | — | Player trees, utterances, patterns |

## Patterns Used

- **Concierge orchestrator** — central coordinator for two parallel pipelines
- **Pipeline chain** — audio: STT → sentiment → embedding → topic matching
- **Fan-out aggregate** — parallel audio + game stream processing
- **Cubby state machine** — topic tree with incremental updates
- **Inference worker** — each model wrapped in its own agent task

## Models Used

| Model | Agent | Purpose |
|-------|-------|---------|
| Whisper Large v3 | speechToTextAgent | Audio transcription |
| emotion-english-distilroberta-base | sentimentAgent | Emotion classification |
| multilingual-sentiment-analysis | sentimentAgent | Sentiment polarity |
| Qwen3-Embedding-4B | embeddingAgent | Text embeddings (1536d) |
| Llama 3.2 11B Vision | patternAgent | Behavioral pattern classification |

## Cubby Schema

```
player/{playerId}/tree                                  ← PlayerTree (topics map)
player/{playerId}/match/{matchId}/{cid}/utterances      ← Array of utterances
player/{playerId}/match/{matchId}/{cid}/moments         ← Array of game moments
player/{playerId}/match/{matchId}/{cid}/patterns        ← Pattern analysis results
player/{playerId}/match/{matchId}/{cid}/completed       ← Completion marker
player/{playerId}/match/{matchId}/cids                  ← CID registry
```
