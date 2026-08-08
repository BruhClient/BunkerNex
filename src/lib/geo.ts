export type LonLat = [number, number];

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/**
 * Great-circle arc between two lon/lat points, as a smooth polyline.
 *
 * These are schematic curves, not navigable sailing routes. For most port
 * pairs in this dataset the direct arc already tracks open water closely
 * enough; for the handful where it would cut across a landmass, callers
 * chain several arcs through open-water waypoints via multiPointArc (see
 * the routing table in RouteMap.tsx). Every port in this dataset sits
 * between 80E and 122E, so no antimeridian wrapping is needed and the maths
 * stays simple.
 */
export function greatCircleArc(from: LonLat, to: LonLat, steps = 64): LonLat[] {
  const lon1 = toRad(from[0]);
  const lat1 = toRad(from[1]);
  const lon2 = toRad(to[0]);
  const lat2 = toRad(to[1]);

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );

  // Coincident points (a same-port leg) have no arc to draw.
  if (!Number.isFinite(d) || d === 0) return [from, to];

  const points: LonLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);

    const x =
      a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y =
      a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);

    points.push([
      toDeg(Math.atan2(y, x)),
      toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    ]);
  }
  return points;
}

/**
 * Great-circle arc through a sequence of waypoints, e.g. [from, viaPoint,
 * to]. Each consecutive pair is arced with greatCircleArc; the shared
 * endpoint between segments is not duplicated.
 */
export function multiPointArc(points: LonLat[], stepsPerLeg = 64): LonLat[] {
  if (points.length < 2) return points;

  const out: LonLat[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const leg = greatCircleArc(points[i], points[i + 1], stepsPerLeg);
    out.push(...leg.slice(1));
  }
  return out;
}
