// RAFT: Multi-Stream Synchronization for Drone Data
// Handles: DRONE_TELEMETRY_DATA, VIDEO_STREAM_DATA, THERMAL_STREAM_DATA, VIDEO_KLV_DATA

const SYNC_WINDOW_MS = 3000;
const BUFFER_TTL_MS = 300000;
const VIOLATION_WINDOW_MS = 30000; //120000;   // 2 minutes – aggregation flush window
const VIOLATION_GRID_SIZE = 50;       // px – bbox quantization
const MAX_FRAME_REFS = 5;
const VIOLATION_STALE_MS = 60000;     // 60s – max gap to consider "same sighting"
const DRONE_POS_PRECISION = 4;        // decimal places ≈ ~11m grid
const MIN_DETECTION_CONFIDENCE = 0.80;
const VEHICLE_LABELS = new Set(['car', 'truck', 'van', 'bus', 'vehicle']);

// ─────────────────────────────────────────────────────────────
// Mission Registry
// ─────────────────────────────────────────────────────────────

async function registerMission(missionId, droneName, timestamp, cubby, context) {
    const t0 = Date.now();
    const listKey = 'list_missions';
    let missions = [];
    try {
        missions = await cubby.json.get(listKey);
    } catch (_) {}
    if (!Array.isArray(missions)) missions = [];

    const idx = missions.findIndex(m => m.missionId === missionId);

    if (idx === -1) {
        missions.push({
            missionId,
            droneName,
            firstSeen: timestamp,
            lastSeen: timestamp,
        });
        context.log(`📝 Registered new mission: ${missionId}`);
    } else {
        missions[idx].lastSeen = timestamp;
        if (droneName) missions[idx].droneName = droneName;
    }

    await cubby.json.set(listKey, missions);
    context.log(`⏱ registerMission ${Date.now() - t0}ms`);
}


// ─────────────────────────────────────────────────────────────
// Timestamp Index Helpers
// ─────────────────────────────────────────────────────────────

async function appendTimestamp(missionId, streamType, timestamp, cubby) {
    const indexKey = `mission/${missionId}/${streamType}/_index`;
    let timestamps = []
    try{
        timestamps = await cubby.json.get(indexKey);
    }
    catch(error){

    }
    const cutoff = Date.now() - BUFFER_TTL_MS;
    if (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps = timestamps.filter(ts => ts > cutoff);
    }

    timestamps.push(timestamp);
    await cubby.json.set(indexKey, timestamps);
}

async function getTimestamps(missionId, streamType, cubby, context?) {
    let data = []
    try{
        data = await cubby.json.get(`mission/${missionId}/${streamType}/_index`)
    }
    catch(error){
        if (context) context.log(`⚠️ getTimestamps(${streamType}) failed: ${error.message}`);
    }
    if (!Array.isArray(data)) data = [];
    return data
}

// ─────────────────────────────────────────────────────────────
// Storage Functions
// ─────────────────────────────────────────────────────────────

async function storeTelemetry(missionId, timestamp, data, context, cubby) {
    const t0 = Date.now();
    const key = `mission/${missionId}/telemetry/${timestamp}`;
    const value = { ...data, storedAt: Date.now() };
    await Promise.all([
        cubby.json.set(key, value),
        appendTimestamp(missionId, 'telemetry', timestamp, cubby),
    ]);
    context.log(`✅ Stored telemetry for mission ${missionId} at ${timestamp} (${Date.now() - t0}ms)`);
}

async function storeRgbFrame(missionId, timestamp, data, context, cubby) {
    const t0 = Date.now();
    const key = `mission/${missionId}/rgb/${timestamp}`;

    let detectedObjects = null;
    const tYolo = Date.now();
    try {
        const result = await context.agents.objectDetection.yolo({
            image: data.image,
            objectsToFind: ["a car", "a vehicle", "a truck"],
            minConfidence: 0.03,
        });
        if(result?.detections){
            detectedObjects = result?.detections.filter(d =>
                d.confidence >= MIN_DETECTION_CONFIDENCE && VEHICLE_LABELS.has(d.label.toLowerCase())
            )
        }
    } catch (error) {
        context.log(`ObjectDetectionFailedWithError: ${error.message}`);
    }
    context.log(`⏱ YOLO detection ${Date.now() - tYolo}ms | detections: ${detectedObjects?.length ?? 0}`);

    const value = {
        detectedObjects: detectedObjects,
        index: data.index,
        frameId: data.frameId,
        framePath: data.framePath,
        frameWidth: data.frameWidth,
        timestamp: timestamp,
        droneName: data.droneName,
        storedAt: Date.now(),
    };

    await Promise.all([
        cubby.json.set(key, value),
        appendTimestamp(missionId, 'rgb', timestamp, cubby),
    ]);
    context.log(`✅ Stored RGB frame #${data.index} for mission ${missionId} (${Date.now() - t0}ms)`);
}

async function storeThermalFrame(missionId, timestamp, data, context, cubby) {
    const t0 = Date.now();
    const key = `mission/${missionId}/thermal/${timestamp}`;
    const value = {
        frameId: data.frameId,
        framePath: data.framePath,
        frameWidth: data.frameWidth,
        index: data.index,
        timestamp: timestamp,
        droneName: data.droneName,
        storedAt: Date.now(),
    };

    await Promise.all([
        cubby.json.set(key, value),
        appendTimestamp(missionId, 'thermal', timestamp, cubby),
    ]);
    context.log(`✅ Stored thermal frame #${data.index} for mission ${missionId} (${Date.now() - t0}ms)`);
}

async function storeKlvData(missionId, timestamp, data, context, cubby) {
    const t0 = Date.now();
    const key = `mission/${missionId}/klv/${timestamp}`;
    const value = {
        klv: data.klv,
        index: data.index,
        timestamp: timestamp,
        droneName: data.droneName,
        storedAt: Date.now(),
    };

    await Promise.all([
        cubby.json.set(key, value),
        appendTimestamp(missionId, 'klv', timestamp, cubby),
    ]);
    context.log(`✅ Stored KLV data #${data.index} for mission ${missionId} (${Date.now() - t0}ms)`);
}

// ─────────────────────────────────────────────────────────────
// Query Functions
// ─────────────────────────────────────────────────────────────

async function getLatestSynced(missionId, context, cubby) {
    const key = `mission/${missionId}/synced/latest`;
    const data = await cubby.json.get(key);
    return { success: true, data: data || null };
}

async function getAllSynced(missionId, context, cubby) {
    const pattern = `mission/${missionId}/synced/*`;
    const keys = await cubby.json.keys(pattern);

    if (!keys || keys.length === 0) {
        return { success: true, data: [] };
    }

    const dataKeys = keys.filter(k => !k.endsWith('/latest'));
    if (dataKeys.length === 0) {
        return { success: true, data: [] };
    }

    const allData = await cubby.json.mget(dataKeys);
    const dataArray = Object.values(allData)
        .filter(item => item !== null)
        //@ts-ignore
        .sort((a, b) => a.timestamp - b.timestamp);

    return { success: true, data: dataArray };
}

async function getSyncedRange(missionId, startTime, endTime, context, cubby) {
    const pattern = `mission/${missionId}/synced/*`;
    const keys = await cubby.json.keys(pattern);

    if (!keys || keys.length === 0) {
        return { success: true, data: [] };
    }

    const filteredKeys = keys.filter(k => {
        if (k.endsWith('/latest')) return false;
        const ts = parseInt(k.split('/').pop(), 10);
        return ts >= startTime && ts <= endTime;
    });

    if (filteredKeys.length === 0) {
        return { success: true, data: [] };
    }

    const allData = await cubby.json.mget(filteredKeys);
    const dataArray = Object.values(allData)
        .filter(item => item !== null)
        //@ts-ignore
        .sort((a, b) => a.timestamp - b.timestamp);

    return { success: true, data: dataArray };
}

// ─────────────────────────────────────────────────────────────
// Violation Helpers
// ─────────────────────────────────────────────────────────────

function computeViolationGridKey(bbox) {
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const gridX = Math.floor(cx / VIOLATION_GRID_SIZE);
    const gridY = Math.floor(cy / VIOLATION_GRID_SIZE);
    return `${gridX}_${gridY}`;
}

function quantizeDronePosition(lat, lng) {
    const factor = Math.pow(10, DRONE_POS_PRECISION);
    return `${Math.floor(lat * factor)}_${Math.floor(lng * factor)}`;
}

function buildDedupKey(classLabel, bbox, dronePosition) {
    const bboxKey = computeViolationGridKey(bbox);
    const posKey = dronePosition
        ? quantizeDronePosition(dronePosition.lat, dronePosition.lng)
        : "nopos";
    return `${posKey}/${classLabel}/${bboxKey}`;
}

// ─────────────────────────────────────────────────────────────
// Violation Buffer + Windowed Flush
// ─────────────────────────────────────────────────────────────

async function bufferViolations(missionId, processedRGB, dronePosition, cubby, context) {
    const t0 = Date.now();
    const newEntries = [];

    for (const rgb of processedRGB) {
        const violations = rgb.violationDetection?.value;
        if (!violations || !violations.length) continue;

        for (const v of violations) {
            if (v.violationType !== "outside_slot") continue;

            const classLabel = v.detection?.classLabel;
            const bbox = v.detection?.bbox;
            if (!classLabel || !bbox) continue;

            newEntries.push({
                classLabel,
                bbox,
                confidence: v.confidence,
                trackingId: v.detection.trackingId,
                timestamp: v.timestamp,
                framePath: rgb.framePath || null,
                frameId: rgb.frameId || null,
                dronePosition: dronePosition
                    ? { lat: dronePosition.lat, lng: dronePosition.lng }
                    : null,
                violationLocation:
                    v.location?.lat != null && v.location?.lng != null
                        ? { lat: v.location.lat, lng: v.location.lng }
                        : null,
                // Store the original YOLO detection for traceability
                sourceDetection: rgb.detectedObjects?.find((d) => {
                    const bw = d.box.xmax - d.box.xmin;
                    const bh = d.box.ymax - d.box.ymin;
                    return (
                        Math.abs(d.box.xmin - bbox.x) < 1 &&
                        Math.abs(d.box.ymin - bbox.y) < 1 &&
                        Math.abs(bw - bbox.w) < 1 &&
                        Math.abs(bh - bbox.h) < 1
                    );
                }) || null,
            });
        }
    }

    if (newEntries.length === 0) return;

    const bufKey = `mission/${missionId}/violation_buf`;
    let buf = null;
    try {
        buf = await cubby.json.get(bufKey);
    } catch (error) {}

    if (!buf || !Array.isArray(buf.entries)) {
        buf = { startedAt: Date.now(), entries: [] };
    }

    buf.entries = buf.entries.concat(newEntries);
    await cubby.json.set(bufKey, buf);

    context.log(
        `📥 Buffered ${newEntries.length} violations (total in window: ${buf.entries.length}) (${Date.now() - t0}ms)`
    );
}

async function checkAndFlushViolations(missionId, cubby, context) {
    const t0 = Date.now();
    const bufKey = `mission/${missionId}/violation_buf`;
    let buf = null;
    try {
        buf = await cubby.json.get(bufKey);
    } catch (error) {}

    if (!buf || !Array.isArray(buf.entries) || buf.entries.length === 0) {
        return null;
    }

    const elapsed = Date.now() - buf.startedAt;
    if (elapsed < VIOLATION_WINDOW_MS) {
        return null; // Window not expired yet
    }

    context.log(
        `⏱️ Violation window expired (${Math.round(elapsed / 1000)}s, ${buf.entries.length} entries). Flushing...`
    );

    // ── 1. Deduplicate buffer entries in-memory ──────────────
    const grouped = {};

    for (const e of buf.entries) {
        const dedupKey = buildDedupKey(e.classLabel, e.bbox, e.dronePosition);

        if (!grouped[dedupKey]) {
            grouped[dedupKey] = {
                missionId,
                vehicleType: e.classLabel,
                violationType: "outside_slot",
                dedupKey,
                bboxGridKey: computeViolationGridKey(e.bbox),
                sightingsCount: 0,
                bestConfidence: 0,
                bestDetection: null,
                bestSourceDetection: null,
                firstSeenAt: e.timestamp,
                lastSeenAt: e.timestamp,
                dronePosition: e.dronePosition,
                violationLocation: e.violationLocation || e.dronePosition,
                representativeFramePath: null,
                lastFrameReferences: [],
            };
        }

        const rec = grouped[dedupKey];
        rec.sightingsCount += 1;
        if (e.timestamp < rec.firstSeenAt) rec.firstSeenAt = e.timestamp;
        if (e.timestamp > rec.lastSeenAt) rec.lastSeenAt = e.timestamp;

        if (e.violationLocation) {
            rec.violationLocation = e.violationLocation;
        }

        if (e.confidence > rec.bestConfidence) {
            rec.bestConfidence = e.confidence;
            rec.bestDetection = {
                classLabel: e.classLabel,
                trackingId: e.trackingId,
                confidence: e.confidence,
                bbox: e.bbox,
            };
            rec.bestSourceDetection = e.sourceDetection || null;
            rec.representativeFramePath = e.framePath;
        }

        rec.lastFrameReferences.push({
            framePath: e.framePath,
            frameId: e.frameId,
            timestamp: e.timestamp,
            confidence: e.confidence,
            violationBbox: e.bbox,
            location: e.violationLocation || e.dronePosition,
        });
    }

    // Cap frame references
    const dedupKeys = Object.keys(grouped);
    for (const dk of dedupKeys) {
        grouped[dk].lastFrameReferences = grouped[dk].lastFrameReferences.slice(
            -MAX_FRAME_REFS
        );
    }

    // ── 2. Merge with existing Redis aggregation records ─────
    const redisKeys = dedupKeys.map(
        (dk) => `mission/${missionId}/violation_agg/${dk}`
    );

    let existingMap = {};
    try {
        existingMap = await cubby.json.mget(redisKeys);
    } catch (error) {}

    const toWrite = {};

    for (const dk of dedupKeys) {
        const incoming = grouped[dk];
        const redisKey = `mission/${missionId}/violation_agg/${dk}`;
        const existing = existingMap[redisKey] || null;

        if (existing) {
            const gap = incoming.firstSeenAt - existing.lastSeenAt;
            if (gap > VIOLATION_STALE_MS) {
                toWrite[redisKey] = incoming;
                context.log(
                    `🔄 Reset stale violation ${dk} (gap ${Math.round(gap / 1000)}s)`
                );
                continue;
            }

            existing.sightingsCount += incoming.sightingsCount;
            if (incoming.bestConfidence > existing.bestConfidence) {
                existing.bestConfidence = incoming.bestConfidence;
                existing.bestDetection = incoming.bestDetection;
                existing.bestSourceDetection = incoming.bestSourceDetection;
                existing.representativeFramePath = incoming.representativeFramePath;
            }
            if (incoming.firstSeenAt < existing.firstSeenAt) {
                existing.firstSeenAt = incoming.firstSeenAt;
            }
            if (incoming.lastSeenAt > existing.lastSeenAt) {
                existing.lastSeenAt = incoming.lastSeenAt;
            }
            if (incoming.dronePosition) {
                existing.dronePosition = incoming.dronePosition;
            }
            if (
                incoming.violationLocation &&
                (!incoming.dronePosition ||
                    incoming.violationLocation.lat !== incoming.dronePosition.lat ||
                    incoming.violationLocation.lng !== incoming.dronePosition.lng)
            ) {
                existing.violationLocation = incoming.violationLocation;
            } else if (!existing.violationLocation && incoming.violationLocation) {
                existing.violationLocation = incoming.violationLocation;
            }

            existing.lastFrameReferences = existing.lastFrameReferences
                .concat(incoming.lastFrameReferences)
                .slice(-MAX_FRAME_REFS);

            toWrite[redisKey] = existing;
        } else {
            toWrite[redisKey] = incoming;
        }
    }

    // ── 3. Batch write aggregated records ────────────────────
    await cubby.json.mset(toWrite);

    // ── 4. Update violation_agg index ────────────────────────
    const indexKey = `mission/${missionId}/violation_agg/_index`;
    let indexArr = [];
    try {
        indexArr = await cubby.json.get(indexKey);
    } catch (error) {}
    if (!Array.isArray(indexArr)) indexArr = [];

    const existingSet = new Set(indexArr);
    let indexChanged = false;
    for (const dk of dedupKeys) {
        if (!existingSet.has(dk)) {
            indexArr.push(dk);
            indexChanged = true;
        }
    }
    if (indexChanged) {
        await cubby.json.set(indexKey, indexArr);
    }

    // ── 5. Find closest synced packet and patch it ───────────
    const lastSeenAt = Math.max(...buf.entries.map((e) => e.timestamp));
    const syncedTimestamps = await getTimestamps(missionId, "telemetry", cubby, context);

    let closestSyncTs = null;
    let closestDelta = Infinity;
    for (const ts of syncedTimestamps) {
        const delta = Math.abs(ts - lastSeenAt);
        if (delta < closestDelta) {
            closestSyncTs = ts;
            closestDelta = delta;
        }
    }

    const aggregatedSummary = Object.values(toWrite).map((r:any) => ({
        vehicleType: r.vehicleType,
        dedupKey: r.dedupKey,
        bboxGridKey: r.bboxGridKey,
        sightingsCount: r.sightingsCount,
        bestConfidence: r.bestConfidence,
        firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt,
        violationLocation: r.violationLocation,
        dronePosition: r.dronePosition,
        representativeFramePath: r.representativeFramePath,
    }));

    if (closestSyncTs !== null) {
        const syncedKey = `mission/${missionId}/synced/${closestSyncTs}`;
        let syncedPacket = null;
        try {
            syncedPacket = await cubby.json.get(syncedKey);
        } catch (error) {}

        if (syncedPacket) {
            syncedPacket.aggregatedViolations = aggregatedSummary;
            syncedPacket.violationFlushedAt = Date.now();
            await cubby.json.set(syncedKey, syncedPacket);
            context.log(
                `📌 Attached ${dedupKeys.length} aggregated violations to synced packet at ${closestSyncTs}`
            );
        }
    }

    // ── 6. Append to flush log ───────────────────────────────
    const flushLogKey = `mission/${missionId}/violation_flush_log/_index`;
    let flushLog = [];
    try {
        flushLog = await cubby.json.get(flushLogKey);
    } catch (error) {}
    if (!Array.isArray(flushLog)) flushLog = [];

    flushLog.push({
        flushedAt: Date.now(),
        syncedTimestamp: closestSyncTs,
        violationCount: dedupKeys.length,
        totalSightings: buf.entries.length,
        windowDurationMs: elapsed,
    });
    await cubby.json.set(flushLogKey, flushLog);

    // ── 7. Clear the buffer ──────────────────────────────────
    await cubby.json.set(bufKey, { startedAt: Date.now(), entries: [] });

    context.log(
        `📊 Flushed ${dedupKeys.length} unique violations (${buf.entries.length} raw sightings) over ${Math.round(elapsed / 1000)}s window (flush took ${Date.now() - t0}ms)`
    );

    return aggregatedSummary;
}

/**
 * Retrieve all aggregated violations for a mission.
 */
async function getAggregatedViolations(missionId, cubby) {
    const indexKey = `mission/${missionId}/violation_agg/_index`;
    let indexArr = [];
    try {
        indexArr = await cubby.json.get(indexKey);
    } catch (error) {}
    if (!Array.isArray(indexArr) || indexArr.length === 0) {
        return { success: true, data: [] };
    }

    const keys = indexArr.map(
        (dk) => `mission/${missionId}/violation_agg/${dk}`
    );
    const records = await cubby.json.mget(keys);

    const dataArray = Object.values(records)
        .filter((r) => r !== null)
        //@ts-ignore
        .sort((a, b) => b.bestConfidence - a.bestConfidence);

    return { success: true, data: dataArray };
}

// ─────────────────────────────────────────────────────────────
// Synchronization Logic
// ─────────────────────────────────────────────────────────────

async function detectParkingViloations(mergedRgb, telemetryTimestamp, telemetry, context) {
    const t0 = Date.now();
    const processedRGB = await Promise.all(
        mergedRgb.map(async (rgb) => {
            const data = { ...rgb };
            if (!rgb.detectedObjects?.length || rgb.violationDetectionProcessed) {
                return data;
            }

            context.log(`Detected RGB object Detection`);
            const objectsToDetect = rgb.detectedObjects.filter((d) =>
                VEHICLE_LABELS.has(d.label.toLowerCase())
            );

            if (!objectsToDetect.length) return data;

            context.log(`needProcess:${objectsToDetect.length}`);
            try {
                context.log(`Processing violation detection...`);
                const violationDetection =
                    await context.agents.parkingViolationDetector.detect({
                        timestamp: telemetryTimestamp,
                        detections: rgb.detectedObjects.map((item) => ({
                            classLabel: item.label,
                            bbox: {
                                x: item.box.xmin,
                                y: item.box.ymin,
                                w: item.box.xmax - item.box.xmin,
                                h: item.box.ymax - item.box.ymin,
                            },
                            trackingId: item.class_id,
                            confidence: item.confidence,
                        })),
                        telemetry: {
                            timestamp: telemetryTimestamp,
                            position: { lat: telemetry.lat, lng: telemetry.lon },
                            altitudeAGL: 65,
                            heading: 75,
                            pitch: 0,
                            roll: 0,
                            gimbalPitch: -85,
                            hfov: 84,
                            vfov: 63,
                        },
                    });
                // context.log(
                //   `ProcessedViolationDetection:${JSON.stringify(violationDetection)}`
                // );
                data.violationDetection = violationDetection;
                data.violationDetectionProcessed = true;
            } catch (error) {
                context.log(`[ERROR]: Failed detect violation: ${error.message}`);
                data.violationDetectionProcessed = true;
                data.violationDetectionError = error.message;
            }

            return data;
        })
    );

    context.log(`⏱ detectParkingViolations ${Date.now() - t0}ms | ${mergedRgb.length} frames`);
    return processedRGB;
}

// ─── Optimized: index lookup + mget instead of keys() + N×get ───

async function findAllFramesInWindow(missionId, streamType, targetTimestamp, cubby, context) {
    const t0 = Date.now();
    const timestamps = await getTimestamps(missionId, streamType, cubby, context);

    if (timestamps.length === 0) return [];

    const matchingTimestamps = timestamps.filter(
        ts => Math.abs(ts - targetTimestamp) <= SYNC_WINDOW_MS
    );

    if (matchingTimestamps.length === 0) return [];

    const keys = matchingTimestamps.map(ts => `mission/${missionId}/${streamType}/${ts}`);
    const framesMap = await cubby.json.mget(keys);

    const matches = [];
    for (const key of keys) {
        const frame = framesMap[key];
        if (frame) {
            const ts = parseInt(key.split('/').pop(), 10);
            frame.timeDelta = ts - targetTimestamp;
            matches.push(frame);
        }
    }

    matches.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    context.log(`⏱ findFrames(${streamType}) ${Date.now() - t0}ms | ${matches.length} matches`);
    return matches;
}

// ─── Optimized: parallel fetches in attemptSync ───

async function attemptSync(missionId, telemetryTimestamp, context, cubby) {
    const t0 = Date.now();
    try {
        const telemetryKey = `mission/${missionId}/telemetry/${telemetryTimestamp}`;
        const syncedKey = `mission/${missionId}/synced/${telemetryTimestamp}`;
        let telemetry
        let existing = null
        try{
            telemetry = await cubby.json.get(telemetryKey)
        }
        catch(error){

        }
        try{
            existing = await cubby.json.get(syncedKey)
        } catch(error){

        }

        const [rgbFrames, thermalFrames, klvPackets] = await Promise.all([
            findAllFramesInWindow(missionId, "rgb", telemetryTimestamp, cubby, context),
            findAllFramesInWindow(missionId, "thermal", telemetryTimestamp, cubby, context),
            findAllFramesInWindow(missionId, "klv", telemetryTimestamp, cubby, context),
        ]);

        if (!telemetry) return;

        const mergedRgb = rgbFrames.length > 0 ? rgbFrames : (existing?.rgb || []);
        const mergedThermal = thermalFrames.length > 0 ? thermalFrames : (existing?.thermal || []);
        const mergedKlv = klvPackets.length > 0 ? klvPackets : (existing?.klv || []);

        const hasRgb = mergedRgb.length > 0;
        const hasThermal = mergedThermal.length > 0;
        const hasKlv = mergedKlv.length > 0;
        const streamCount = [hasRgb, hasThermal, hasKlv].filter(Boolean).length;

        let syncQuality;
        if (streamCount === 3) syncQuality = "full";
        else if (streamCount === 0) syncQuality = "telemetry-only";
        else syncQuality = "partial";

        const processedRGB = await detectParkingViloations(mergedRgb, telemetryTimestamp, telemetry, context);

        // ── Buffer violations (append only, no aggregation yet) ─
        const telData = telemetry.payload || telemetry;
        const dronePosition =
            telData.lat != null && telData.lon != null
                ? { lat: telData.lat, lng: telData.lon }
                : null;

        await bufferViolations(missionId, processedRGB, dronePosition, cubby, context);

        // ── Check if 2-minute window expired → flush ────────────
        const flushed = await checkAndFlushViolations(missionId, cubby, context);

        const syncedPacket = {
            timestamp: telemetryTimestamp,
            missionId,
            droneName: telemetry.payload?.name || telemetry.droneName,
            syncQuality,
            syncedAt: Date.now(),
            telemetry: telData,
            rgb: processedRGB,
            thermal: mergedThermal,
            klv: mergedKlv.map(f =>
                f.data ? f : { data: f.klv, index: f.index, timestamp: f.timestamp, timeDelta: f.timeDelta }
            ),
        };

        // Only attach aggregatedViolations when a flush actually happened
        if (flushed) {
            //@ts-ignore
            syncedPacket.aggregatedViolations = flushed;
            //@ts-ignore
            syncedPacket.violationFlushedAt = Date.now();
        }

        const latestKey = `mission/${missionId}/synced/latest`;
        await cubby.json.set(syncedKey, syncedPacket)
        let currentLatest = null
        try{
            currentLatest = cubby.json.get(latestKey)
        } catch(error){

        }

        const qualityRank = { "telemetry-only": 0, partial: 1, full: 2 };
        if (
            !currentLatest ||
            syncedPacket.timestamp >= currentLatest.timestamp ||
            qualityRank[syncQuality] >= qualityRank[currentLatest.syncQuality || "telemetry-only"]
        ) {
            await cubby.json.set(latestKey, syncedPacket);
        }

        context.log(
            `🔗 Synced for mission ${missionId} [${syncQuality}] ` +
            `RGB: ${mergedRgb.length}, Thermal: ${mergedThermal.length}, KLV: ${mergedKlv.length} (${Date.now() - t0}ms)`
        );
    } catch (error) {
        context.log(`❌ Sync failed for mission ${missionId}: ${error.message}`);
    }
}

// ─── Optimized: index lookup instead of keys() scan ───

async function attemptSyncFromFrame(missionId, frameTimestamp, context, cubby) {
    const t0 = Date.now();
    try {
        const timestamps = await getTimestamps(missionId, 'telemetry', cubby, context);
        if (timestamps.length === 0) {
            context.log(`⏱ attemptSyncFromFrame: no telemetry timestamps yet for ${missionId} (${Date.now() - t0}ms)`);
            return;
        }

        let closestTs = null;
        let closestDelta = Infinity;

        for (const ts of timestamps) {
            const delta = Math.abs(ts - frameTimestamp);
            if (delta <= SYNC_WINDOW_MS && delta < closestDelta) {
                closestTs = ts;
                closestDelta = delta;
            }
        }
        if (closestTs !== null) {
            context.log(`⏱ attemptSyncFromFrame: matched telemetry ts=${closestTs} (delta ${closestDelta}ms) from ${timestamps.length} candidates`);
            await attemptSync(missionId, closestTs, context, cubby);
        } else {
            const nearest = timestamps.reduce((best, ts) => {
                const d = Math.abs(ts - frameTimestamp);
                return d < best.delta ? { ts, delta: d } : best;
            }, { ts: null, delta: Infinity });
            context.log(`⏱ attemptSyncFromFrame: no telemetry within ${SYNC_WINDOW_MS}ms window | nearest delta=${nearest.delta}ms (ts=${nearest.ts}), frameTs=${frameTimestamp}, ${timestamps.length} candidates`);
        }
        context.log(`⏱ attemptSyncFromFrame ${Date.now() - t0}ms`);
    } catch (error) {
        context.log(`❌ Sync from frame failed: ${error.message} (${Date.now() - t0}ms)`);
    }
}

// ─────────────────────────────────────────────────────────────
// Main Handler
// ─────────────────────────────────────────────────────────────

function bytesToString(bytes) {
    var str = "";
    for (var i = 0; i < bytes.length; i++) {
        str += String.fromCharCode(bytes[i]);
    }
    return str;
}

async function handle(event, context) {
    const cubby = await context.cubby('syncMission');
    const streamId = event.payload?.streamId || event.streamId;

    if (!streamId) {
        context.log('❌ Missing streamId in event payload');
        return;
    }

    const stream = await context.streams.subscribe(streamId);
    context.log('✅ Successfully subscribed to Stream');

    for await (const packet of stream) {
        const seqNum = packet.sequenceNum;
        const ctx = Object.create(context);
        ctx.log = (msg) => context.log(`[seq:${seqNum}] ${msg}`);

        try {
            const payloadStr = bytesToString(packet.payload);
            const data = JSON.parse(payloadStr);
            const eventType = data.event_type;
            const missionId = data.missionId || data.payload?.mission || "unknown";
            const droneName = data.name || data.payload?.name
            let timestamp = data.timestamp || Date.now();
            if (typeof timestamp === 'string') {
                timestamp = new Date(timestamp).getTime();
            }

            const tEvent = Date.now();

            if (eventType === "DRONE_TELEMETRY_DATA") {
                await registerMission(missionId, droneName, timestamp, cubby, ctx);
                await storeTelemetry(missionId, timestamp, data, ctx, cubby);
                await attemptSync(missionId, timestamp, ctx, cubby);
            } else if (eventType === "VIDEO_STREAM_DATA") {
                await storeRgbFrame(missionId, timestamp, data, ctx, cubby);
                await attemptSyncFromFrame(missionId, timestamp, ctx, cubby);
            } else if (eventType === "THERMAL_STREAM_DATA") {
                await storeThermalFrame(missionId, timestamp, data, ctx, cubby);
                await attemptSyncFromFrame(missionId, timestamp, ctx, cubby);
            } else if (eventType === "VIDEO_KLV_DATA") {
                await storeKlvData(missionId, timestamp, data, ctx, cubby);
                await attemptSyncFromFrame(missionId, timestamp, ctx, cubby);
            }

            ctx.log(`⏱ [${eventType}] total pipeline ${Date.now() - tEvent}ms`);
        } catch (error) {
            ctx.log(`Failed to process data: ${error.message}`);
        }
    }
}
