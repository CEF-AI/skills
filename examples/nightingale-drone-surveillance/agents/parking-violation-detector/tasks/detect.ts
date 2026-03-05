/**
 * Parking Violation Detector — Consolidated Agent
 *
 * This file contains the complete logic for projecting drone detections to GPS,
 * querying a local parking map, and tracking violations over time.
 *
 * Optimized for Agent Runtime with embedded map data and MCP task schemas.
 */

// ─── Embedded Data (ng.geojson) ─────────────────────────────────────────────

const REGION_MAP_JSON = `{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-122.045544,37.516652],[-122.045518,37.516605],[-122.044711,37.516874],[-122.044732,37.516918],[-122.045544,37.516652]]]},"bbox":[-122.045544,37.516605,-122.044711,37.516918]},{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-122.044621,37.51693],[-122.044445,37.516597],[-122.044389,37.516615],[-122.044573,37.516948],[-122.044621,37.51693]]]},"bbox":[-122.044621,37.516597,-122.044389,37.516948]},{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-122.045407,37.516562],[-122.045383,37.516517],[-122.045212,37.516578],[-122.045227,37.516621],[-122.045407,37.516562]]]},"bbox":[-122.045407,37.516517,-122.045212,37.516621]},{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-122.044949,37.516719],[-122.044924,37.516676],[-122.044651,37.51677],[-122.044672,37.516814],[-122.044949,37.516719]]]},"bbox":[-122.044949,37.516676,-122.044651,37.516814]},{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-122.045443,37.516468],[-122.045364,37.516321],[-122.045306,37.516345],[-122.045387,37.516485],[-122.045443,37.516468]]]},"bbox":[-122.045443,37.516321,-122.045306,37.516485]},{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-122.044389,37.516491],[-122.044316,37.516353],[-122.044262,37.516369],[-122.044344,37.516505],[-122.044389,37.516491]]]},"bbox":[-122.044389,37.516353,-122.044262,37.516505]},{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-122.045734,37.516598],[-122.045574,37.516289],[-122.045508,37.516311],[-122.045668,37.516616],[-122.045734,37.516598]]]},"bbox":[-122.045734,37.516289,-122.045508,37.516616]}]}`;

// ─── Enums & Types ──────────────────────────────────────────────────────────

enum ZoneType {
    REGULAR = "regular",
    HANDICAP = "handicap",
    FIRE_LANE = "fire_lane",
    LOADING = "loading",
    NO_PARKING = "no_parking",
    ACCESS_AISLE = "access_aisle",
}

enum ViolationType {
    NONE = "none",
    OUTSIDE_SLOT = "outside_slot",
    DOUBLE_PARKED = "double_parked",
    FIRE_LANE = "fire_lane",
    HANDICAP_ZONE = "handicap_zone",
    BLOCKING_ACCESS = "blocking_access",
}

enum ViolationSeverity {
    INFO = "info",
    WARNING = "warning",
    CRITICAL = "critical",
}

interface GeoPoint { lat: number; lng: number; }
type GeoPolygon = GeoPoint[];

interface BoundingBox { x: number; y: number; w: number; h: number; }

interface Detection {
    classLabel: string;
    bbox: BoundingBox;
    confidence: number;
    trackingId?: string;
}

interface DroneTelemetry {
    timestamp: number;
    position: GeoPoint;
    altitudeAGL: number;
    heading: number;
    gimbalPitch: number;
    hfov: number;
    vfov: number;
}

interface FrameDetections {
    timestamp: number;
    detections: Detection[];
    telemetry: DroneTelemetry;
}

interface CameraIntrinsics {
    focalLengthMm: number;
    sensorWidthMm: number;
    sensorHeightMm: number;
    imageWidthPx: number;
    imageHeightPx: number;
}

interface ParkingSlot {
    id: string;
    polygon: GeoPolygon;
    zoneType: ZoneType;
    label?: string;
}

interface ViolationResult {
    detection: Detection;
    violationType: ViolationType;
    severity: ViolationSeverity;
    location: GeoPoint;
    vehicleFootprint: GeoPolygon;
    confidence: number;
    timestamp: number;
    nearestSlot?: ParkingSlot;
    distanceToNearestSlot?: number;
    shouldEscalate: boolean;
    triggerPlateRecognition: boolean;
}

interface TrackedVehicle {
    geoHash: string;
    firstSeen: number;
    lastSeen: number;
    observationCount: number;
    location: GeoPoint;
    violationType: ViolationType;
    trackingId?: string;
}

// ─── Internal Logic (Consolidated) ──────────────────────────────────────────

const EARTH_RADIUS_M = 6371000;

function degreesToRadians(deg: number): number { return (deg * Math.PI) / 180; }
function radiansToDegrees(rad: number): number { return (rad * 180) / Math.PI; }

function haversineDistance(a: GeoPoint, b: GeoPoint): number {
    const dLat = degreesToRadians(b.lat - a.lat);
    const dLng = degreesToRadians(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(degreesToRadians(a.lat)) * Math.cos(degreesToRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
    return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function offsetToGeoPoint(origin: GeoPoint, dx: number, dy: number): GeoPoint {
    const latMeters = (Math.PI / 180) * EARTH_RADIUS_M;
    const lngMeters = latMeters * Math.cos(degreesToRadians(origin.lat));
    return { lat: origin.lat + dy / latMeters, lng: origin.lng + dx / lngMeters };
}

function pointInPolygon(p: GeoPoint, poly: GeoPolygon): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const intersect = ((poly[i].lat > p.lat) !== (poly[j].lat > p.lat)) &&
            (p.lng < (poly[j].lng - poly[i].lng) * (p.lat - poly[i].lat) / (poly[j].lat - poly[i].lat) + poly[i].lng);
        if (intersect) inside = !inside;
    }
    return inside;
}

function polygonsOverlap(polyA: GeoPolygon, polyB: GeoPolygon): boolean {
    for (const v of polyA) if (pointInPolygon(v, polyB)) return true;
    for (const v of polyB) if (pointInPolygon(v, polyA)) return true;
    return false;
}

function polygonCentroid(poly: GeoPolygon): GeoPoint {
    let lat = 0, lng = 0;
    for (const p of poly) { lat += p.lat; lng += p.lng; }
    return { lat: lat / poly.length, lng: lng / poly.length };
}

function simpleGeoHash(p: GeoPoint): string {
    return `${Math.round(p.lat * 10000) / 10000}_${Math.round(p.lng * 10000) / 10000}`;
}

// ─── Geo Projector ──────────────────────────────────────────────────────────

class InternalGeoProjector {
    calculateGSD(altitude: number, intrinsics: CameraIntrinsics): number {
        return (altitude * intrinsics.sensorWidthMm) / (intrinsics.focalLengthMm * intrinsics.imageWidthPx);
    }

    projectBboxToGeo(bbox: BoundingBox, tel: DroneTelemetry, intrinsics: CameraIntrinsics) {
        const gsd = this.calculateGSD(tel.altitudeAGL, intrinsics);
        const cx = intrinsics.imageWidthPx / 2;
        const cy = intrinsics.imageHeightPx / 2;
        const headingRad = degreesToRadians(tel.heading);
        const pitchRad = degreesToRadians(Math.abs(tel.gimbalPitch));
        const pitchScale = (pitchRad > 0 && pitchRad < Math.PI / 2) ? 1 / Math.cos(Math.PI / 2 - pitchRad) : 1;

        const project = (px: number, py: number) => {
            let dx = (px - cx) * gsd;
            let dy = -(py - cy) * gsd * pitchScale;
            const rdx = dx * Math.cos(headingRad) + dy * Math.sin(headingRad);
            const rdy = -dx * Math.sin(headingRad) + dy * Math.cos(headingRad);
            return offsetToGeoPoint(tel.position, rdx, rdy);
        };

        const center = project(bbox.x + bbox.w / 2, bbox.y + bbox.h / 2);
        const corners = [
            project(bbox.x, bbox.y), project(bbox.x + bbox.w, bbox.y),
            project(bbox.x + bbox.w, bbox.y + bbox.h), project(bbox.x, bbox.y + bbox.h)
        ];
        corners.push({ ...corners[0] });
        return { center, corners };
    }
}

// ─── Parking Map Service ────────────────────────────────────────────────────

class InternalMapService {
    private slots: ParkingSlot[] = [];

    load(geojson: any) {
        this.slots = geojson.features.map((f: any, i: number) => ({
            id: f.id || `slot-${i}`,
            polygon: f.geometry.coordinates[0].map(([lng, lat]: number[]) => ({ lat, lng })),
            zoneType: this.inferZone(f.properties),
            label: f.properties.name || ""
        }));
    }

    private inferZone(props: any): ZoneType {
        if (props.fire_lane === "yes" || props.parking === "fire_lane") return ZoneType.FIRE_LANE;
        if (props.access === "disabled" || props.parking === "disabled") return ZoneType.HANDICAP;
        if (props.parking === "no" || props.parking === "no_parking") return ZoneType.NO_PARKING;
        return ZoneType.REGULAR;
    }

    getZoneAt(p: GeoPoint) { return this.slots.find(s => pointInPolygon(p, s.polygon)); }
    findNearest(p: GeoPoint) {
        let nearest = null, minDist = Infinity;
        for (const s of this.slots) {
            const d = haversineDistance(p, polygonCentroid(s.polygon));
            if (d < minDist) { minDist = d; nearest = s; }
        }
        return nearest ? { slot: nearest, distance: minDist } : null;
    }
    getOverlapping(poly: GeoPolygon) { return this.slots.filter(s => polygonsOverlap(poly, s.polygon)); }
    getSlots() { return this.slots; }
}

// ─── Temporal Tracker ───────────────────────────────────────────────────────

class InternalTracker {
    private tracked = new Map<string, TrackedVehicle>();
    private escalationMs = 5 * 60 * 1000;
    private plateMs = 3 * 60 * 1000;

    record(loc: GeoPoint, type: ViolationType, ts: number, tid?: string) {
        const hash = simpleGeoHash(loc);
        let vehicle = tid ? Array.from(this.tracked.values()).find(v => v.trackingId === tid) : null;
        if (!vehicle) {
            for (const v of this.tracked.values()) {
                if (haversineDistance(loc, v.location) < 5) { vehicle = v; break; }
            }
        }

        if (vehicle) {
            vehicle.lastSeen = ts;
            vehicle.observationCount++;
            vehicle.location = loc;
            vehicle.violationType = type;
        } else {
            vehicle = { geoHash: hash, firstSeen: ts, lastSeen: ts, observationCount: 1, location: loc, violationType: type, trackingId: tid };
            this.tracked.set(`${hash}_${ts}`, vehicle);
        }
        return vehicle;
    }

    shouldEscalate(v: TrackedVehicle) { return (v.lastSeen - v.firstSeen >= this.escalationMs) && v.violationType !== ViolationType.NONE; }
    shouldPlate(v: TrackedVehicle) { return (v.lastSeen - v.firstSeen >= this.plateMs) && v.violationType !== ViolationType.NONE; }
}

// ─── Violation Engine ───────────────────────────────────────────────────────

class ViolationEngine {
    private projector = new InternalGeoProjector();
    private map = new InternalMapService();
    private tracker = new InternalTracker();
    private intrinsics: CameraIntrinsics = { focalLengthMm: 12.29, sensorWidthMm: 17.3, sensorHeightMm: 13.0, imageWidthPx: 5280, imageHeightPx: 3956 };

    constructor() {
        this.map.load(JSON.parse(REGION_MAP_JSON));
    }

    updateIntrinsics(i: Partial<CameraIntrinsics>) { this.intrinsics = { ...this.intrinsics, ...i }; }

    process(frame: FrameDetections): ViolationResult[] {
        return frame.detections
            .filter(d => ["car", "truck", "van", "bus"].includes(d.classLabel.toLowerCase()) && d.confidence >= 0.5)
            .map(d => {
                const { center, corners } = this.projector.projectBboxToGeo(d.bbox, frame.telemetry, this.intrinsics);
                let vType = ViolationType.NONE;
                const zone = this.map.getZoneAt(center);
                const overlapping = this.map.getOverlapping(corners);
                const nearest = this.map.findNearest(center);

                if (zone?.zoneType === ZoneType.FIRE_LANE) vType = ViolationType.FIRE_LANE;
                else if (zone?.zoneType === ZoneType.HANDICAP) vType = ViolationType.HANDICAP_ZONE;
                else if (overlapping.length >= 2) vType = ViolationType.DOUBLE_PARKED;
                else if (!zone) vType = ViolationType.OUTSIDE_SLOT;

                const tracked = this.tracker.record(center, vType, frame.timestamp, d.trackingId);

                return {
                    detection: d, violationType: vType, location: center, vehicleFootprint: corners,
                    confidence: d.confidence, timestamp: frame.timestamp,
                    severity: vType === ViolationType.NONE ? ViolationSeverity.INFO : (vType === ViolationType.FIRE_LANE ? ViolationSeverity.CRITICAL : ViolationSeverity.WARNING),
                    nearestSlot: nearest?.slot, distanceToNearestSlot: nearest?.distance,
                    shouldEscalate: this.tracker.shouldEscalate(tracked),
                    triggerPlateRecognition: this.tracker.shouldPlate(tracked)
                };
            });
    }

    getStats() { return { region: "Newark Waterfront", slotCount: this.map.getSlots().length }; }
}

// ─── MCP Tasks ──────────────────────────────────────────────────────────────

const engine = new ViolationEngine();

/**
 * @task detect_violations
 * @description Analyzes a frame of detections and telemetry to classify parking violations.
 * @input {FrameDetections} frame - The telemetry and bounding boxes from the current frame.
 * @output {ViolationResult[]} Results for each detected vehicle.
 */
async function handle(event, ctx): Promise<ViolationResult[]> {
    ctx.log(`[VIOLATION DETECTOR RECEVIED EVENT] ${JSON.stringify(event)}`)
    const frame = event.payload as FrameDetections
    const engine = new ViolationEngine();
    const result = engine.process(frame);
    ctx.log(`[VioladtionDetectionResult]:${JSON.stringify(result)}`)
    return result
}

/**
 * @task get_agent_info
 * @description Returns operational status and region information.
 */
async function get_agent_info() {
    return {
        ...engine.getStats(),
        capabilities: ["Geographic Projection", "Parking Map Query", "Temporal Tracking", "Violation Classification"],
        version: "1.0.0-ng"
    };
}
