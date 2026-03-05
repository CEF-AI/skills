# Nightingale — Drone Surveillance for Parking Violations

A production deployment that processes multi-stream drone footage to detect illegally parked vehicles.

## Goal

"Detect illegally parked cars from drone footage, synchronize multi-stream sensor data (RGB, thermal, telemetry, KLV), and expose results via a query API."

## Architecture

```
Drone data streams (telemetry, RGB, thermal, KLV)
  → Stream: "DSC 142" (filtered by event_type:illegalParking)
    → Deployment: triggers engagement on all events
      → Engagement: subscribes to stream, dispatches by event_type
        → Agent: Object Detection (YOLO on RGB frames)
        → Agent: Parking Violation Detector (geo-projection + zone classification)
        → Cubby: syncMission (stores synced packets, violations)
          → Query: syncMission (exposes data to client UI)
```

## Entity Graph

| Entity | Name | Alias | Purpose |
|--------|------|-------|---------|
| Workspace | Freemont | — | Geographic site |
| Stream | DSC 142 | — | Drone data channel |
| Engagement | Illegal Parking Detection | — | Multi-stream sync + orchestration |
| Agent | Object Detection | `objectDetection` | YOLO inference on images |
| Task | Yolo | `yolo` | Calls YOLO11x model |
| Agent | Parking Violation Detector | `parkingViolationDetector` | Violation classification |
| Task | Detect | `detect` | Geo-projection + zone check |
| Cubby | syncMission | — | Mission data + violation records |
| Query | syncMission | — | Client-facing query API |

## Patterns Used

- **Stream processor** — engagement subscribes to stream, dispatches by event_type
- **Inference worker** — YOLO task wraps DDC inference endpoint
- **Cubby state machine** — mission data stored with timestamp indices
- **Fan-out aggregate** — parallel frame queries during sync
- **Buffered flush** — violations accumulated and flushed on time window

## Key Implementation Details

- The engagement handles 4 event types in one stream: `DRONE_TELEMETRY_DATA`, `VIDEO_STREAM_DATA`, `THERMAL_STREAM_DATA`, `VIDEO_KLV_DATA`
- RGB frames trigger YOLO detection inline (not via separate invocation — the engagement calls `context.agents.objectDetection.yolo()` during frame storage)
- Detected vehicles are passed to `context.agents.parkingViolationDetector.detect()` for geo-projection against an embedded GeoJSON map
- Violations are buffered and flushed every 30 seconds, then deduplicated and aggregated
- The cubby query supports multiple modes: `latest`, `range`, `paginated`, `since`, `metadata`, `lastN`

## Files

```
nightingale-drone-surveillance/
├── cef.config.yaml
├── engagements/engagement.ts           ← 900-line orchestrator (stream processor + cubby state machine)
├── agents/
│   ├── object-detection/tasks/yolo.ts  ← 28-line YOLO inference worker
│   └── parking-violation-detector/tasks/detect.ts  ← 300-line geo-projection + zone classification
└── queries/syncMission.ts              ← Multi-mode cubby query handler
```

All `.ts` files are fully self-contained with zero imports.
