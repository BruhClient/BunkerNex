export type LonLat = [number, number];

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/**
 * Great-circle arc between two lon/lat points, as a smooth polyline.
 *
 * On its own this is just the curve between two points, and would happily be
 * drawn across a continent. Legs are routed through water first: searoutes.ts
 * returns a chain of open-water waypoints, which callers pass to
 * multiPointArc. greatCircleArc is only used directly for a port pair the
 * sea-lane graph does not cover. Every port in this dataset sits between 80E
 * and 130E, so no antimeridian wrapping is needed and the maths stays simple.
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

/**
 * Position and heading at fraction `t` (0..1) along a polyline, measured by
 * cumulative length rather than by vertex count.
 *
 * The distinction matters: arcs from multiPointArc are denser near waypoints
 * than in open water, so stepping by index would make a vessel crawl through
 * the straits and sprint across open sea. Walking by distance keeps the
 * apparent speed even.
 *
 * Segment lengths use planar deltas with a cos(lat) correction on longitude.
 * Over a single leg that is well inside the error the schematic arcs already
 * carry, and it avoids a haversine per segment on every scrub tick.
 */
export function pointAlong(
  coords: LonLat[],
  t: number,
): { position: LonLat; bearing: number } {
  if (coords.length === 0) return { position: [0, 0], bearing: 0 };
  if (coords.length === 1) return { position: coords[0], bearing: 0 };

  const segLength = (a: LonLat, b: LonLat) => {
    const dx = (b[0] - a[0]) * Math.cos(toRad((a[1] + b[1]) / 2));
    const dy = b[1] - a[1];
    return Math.hypot(dx, dy);
  };

  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = segLength(coords[i], coords[i + 1]);
    lengths.push(d);
    total += d;
  }

  // A zero-length path (both endpoints the same port) has no direction to give.
  if (total === 0) return { position: coords[0], bearing: 0 };

  const target = Math.min(Math.max(t, 0), 1) * total;
  let walked = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (walked + lengths[i] >= target) {
      const a = coords[i];
      const b = coords[i + 1];
      const f = lengths[i] === 0 ? 0 : (target - walked) / lengths[i];
      return {
        position: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
        bearing: bearingBetween(a, b),
      };
    }
    walked += lengths[i];
  }

  const last = coords.length - 1;
  return {
    position: coords[last],
    bearing: bearingBetween(coords[last - 1], coords[last]),
  };
}

/** Initial great-circle bearing in degrees clockwise from north. */
function bearingBetween(from: LonLat, to: LonLat): number {
  const lat1 = toRad(from[1]);
  const lat2 = toRad(to[1]);
  const dLon = toRad(to[0] - from[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
