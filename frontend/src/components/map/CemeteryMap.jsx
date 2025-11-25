// frontend/src/components/map/CemeteryMap.jsx
import { useCallback, useMemo } from "react";
import {
  GoogleMap,
  Marker,
  Polygon,
  Polyline,
  useJsApiLoader,
} from "@react-google-maps/api";

// ---- Shared cemetery geometry ----
export const CEMETERY_CENTER = {
  lat: 15.4948545,
  lng: 120.5550455,
};

/**
 * Main pedestrian / vehicle entrance to the cemetery.
 */
export const CEMETERY_ENTRANCE = {
  lat: 15.494175676617589,
  lng: 120.55463847892524,
};

/**
 * Helper: approximate meter → degree conversion
 */
const METERS_PER_DEG_LAT = 111320; // ~meters per 1° latitude
function metersPerDegLng(latDeg) {
  // longitude degree size depends on latitude
  return 111320 * Math.cos((latDeg * Math.PI) / 180);
}

/**
 * Offset a lat/lng by N meters north (+) / south (-) and east (+) / west (-).
 */
export function offsetLatLngMeters(origin, northMeters = 0, eastMeters = 0) {
  const mPerLng = metersPerDegLng(origin.lat);
  const dLat = northMeters / METERS_PER_DEG_LAT;
  const dLng = eastMeters / mPerLng;

  return {
    lat: origin.lat + dLat,
    lng: origin.lng + dLng,
  };
}

/**
 * Convenience: get a point offset from the entrance.
 * Example: offsetFromEntranceMeters(200, 0) = 200m north of the entrance.
 */
export function offsetFromEntranceMeters(northMeters = 0, eastMeters = 0) {
  return offsetLatLngMeters(CEMETERY_ENTRANCE, northMeters, eastMeters);
}

/**
 * Base/legacy geofence polygon (the original 4-corner fence),
 * converted to { lat, lng } form.
 */
export const BASE_GEOFENCE_POLYGON = [
  { lat: 15.494519, lng: 120.554952 }, // bottom right
  { lat: 15.494804, lng: 120.554709 }, // bottom left
  { lat: 15.49519, lng: 120.555092 }, // top left
  { lat: 15.494837, lng: 120.555382 }, // top right
];

/**
 * Extra polygons.
 * Order: bottom-left, bottom-right, top-right, top-left (to avoid self-cross).
 */

// Polygon 1
export const EXTRA_GEOFENCE_POLYGON_1 = [
  { lat: 15.49525, lng: 120.555145 }, // bottom left
  { lat: 15.494827, lng: 120.555488 }, // bottom right
  { lat: 15.495007, lng: 120.555737 }, // top right
  { lat: 15.495466, lng: 120.555366 }, // top left
];

// Polygon 2
export const EXTRA_GEOFENCE_POLYGON_2 = [
  { lat: 15.49551, lng: 120.555417 }, // bottom left
  { lat: 15.495057, lng: 120.555786 }, // bottom right
  { lat: 15.495091, lng: 120.555841 }, // top right
  { lat: 15.495573, lng: 120.555461 }, // top left
];

// Polygon 3
export const EXTRA_GEOFENCE_POLYGON_3 = [
  { lat: 15.494942, lng: 120.554601 }, // bottom left
  { lat: 15.49486, lng: 120.554651 }, // bottom right
  { lat: 15.495257761935207, lng: 120.55506149391522 }, // top right
  { lat: 15.49534758085077, lng: 120.55496292274269 }, // top left
];

// Polygon 4 (New)
export const EXTRA_GEOFENCE_POLYGON_4 = [
  { lat: 15.49439052807128, lng: 120.55505055792405 }, // bottom left
  { lat: 15.49422534285282, lng: 120.55517911912953 }, // bottom right
  { lat: 15.49455571315771, lng: 120.55559863464217 }, // top right
  { lat: 15.4947143776559, lng: 120.55547458435616 }, // top left
];

// Polygon 5 (New)
export const EXTRA_GEOFENCE_POLYGON_5 = [
  { lat: 15.4956272395318, lng: 120.55549939440671 }, // bottom left
  { lat: 15.495127339483549, lng: 120.55588958894263 }, // bottom right
  { lat: 15.495177329542782, lng: 120.55595274181552 }, // top right
  { lat: 15.495673969257112, lng: 120.55554337587175 }, // top left
];

/**
 * For convenience:
 * - GEOFENCE_POLYGON: base one (for backwards compatibility if imported elsewhere)
 * - GEOFENCE_POLYGONS: ALL polygons used for drawing + inside checks
 */
export const GEOFENCE_POLYGON = BASE_GEOFENCE_POLYGON;

export const GEOFENCE_POLYGONS = [
  BASE_GEOFENCE_POLYGON,
  EXTRA_GEOFENCE_POLYGON_1,
  EXTRA_GEOFENCE_POLYGON_2,
  EXTRA_GEOFENCE_POLYGON_3,
  EXTRA_GEOFENCE_POLYGON_4,
  EXTRA_GEOFENCE_POLYGON_5,
];

// Compute bounds from ALL polygons (still exported if you need it elsewhere)
const ALL_POINTS = GEOFENCE_POLYGONS.reduce(
  (acc, poly) => acc.concat(poly),
  []
);

const lats = ALL_POINTS.map((p) => p.lat);
const lngs = ALL_POINTS.map((p) => p.lng);

export const CEMETERY_BOUNDS = {
  north: Math.max(...lats),
  south: Math.min(...lats),
  east: Math.max(...lngs),
  west: Math.min(...lngs),
};

// ---- Initial measured road lines (basis for road_plots) ----
export const INITIAL_ROAD_SEGMENTS = [
  {
    id: "ROAD_1",
    from: { lat: 15.49423, lng: 120.55465 },
    to: { lat: 15.494851206432488, lng: 120.55545625024631 },
  },
  {
    id: "ROAD_2",
    from: { lat: 15.49417149934942, lng: 120.55467753150333 },
    to: { lat: 15.495244159989573, lng: 120.55609373789545 },
  },
  {
    id: "ROAD_3",
    from: { lat: 15.494965010286581, lng: 120.5545487854677 },
    to: { lat: 15.494166329887069, lng: 120.55517105797331 },
  },
];

// Ready-to-use polylines for the map
export const INITIAL_ROAD_POLYLINES = INITIAL_ROAD_SEGMENTS.map((seg) => ({
  id: seg.id,
  path: [seg.from, seg.to],
  options: {
    strokeColor: "#facc15", // yellow
    strokeOpacity: 1,
    strokeWeight: 4,
  },
}));

// Ray-casting point-in-polygon (single polygon)
function isInsideSinglePolygon(lat, lng, polygon) {
  const x = lng;
  const y = lat;
  const poly = polygon.map((p) => ({ x: p.lng, y: p.lat }));
  let inside = false;

  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * isInsideGeofence: point is valid if it's inside ANY of the polygons
 */
export function isInsideGeofence(lat, lng, polygons = GEOFENCE_POLYGONS) {
  return polygons.some((poly) => isInsideSinglePolygon(lat, lng, poly));
}

const containerStyle = {
  width: "100%",
  height: "100%",
};

/**
 * Reusable cemetery map component using Google Maps.
 * This is the single base map for:
 *  - burial plots (polygons)
 *  - road plots (polylines)
 *  - markers (only where you explicitly pass them)
 */
export default function CemeteryMap({
  center = CEMETERY_CENTER,
  zoom = 19,
  clickable = true,
  showGeofence = true,
  markers = [],
  polylines = [],
  polygons = [],
  onCoordinatePick,
  restrictToGeofence = false,
  onClickOutsideGeofence,
  children,
}) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "cemetery-map-script",
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  });

  const handleClick = useCallback(
    (ev) => {
      if (!clickable || !onCoordinatePick) return;

      const lat = ev.latLng.lat();
      const lng = ev.latLng.lng();

      if (restrictToGeofence) {
        const inside = isInsideGeofence(lat, lng);
        if (!inside) {
          onClickOutsideGeofence?.({ lat, lng });
          return;
        }
      }

      onCoordinatePick({ lat, lng });
    },
    [clickable, onCoordinatePick, restrictToGeofence, onClickOutsideGeofence]
  );

  const options = useMemo(
    () => ({
      clickableIcons: false,
      fullscreenControl: true,
      streetViewControl: false,
      mapTypeControl: true,
      zoomControl: true,
      gestureHandling: "greedy",
    }),
    []
  );

  if (loadError) {
    return (
      <div className="text-sm text-destructive">
        Failed to load Google Maps.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading map…
      </div>
    );
  }

  return (
    <GoogleMap
      mapContainerStyle={containerStyle}
      center={center}
      zoom={zoom}
      options={options}
      onClick={handleClick}
    >
      {showGeofence &&
        GEOFENCE_POLYGONS.map((poly, idx) => (
          <Polygon
            key={idx}
            path={poly}
            options={{
              strokeColor: "#22c55e",
              strokeWeight: 2,
              fillOpacity: 0.03,
            }}
          />
        ))}

      {polygons.map((poly, idx) => (
        <Polygon key={poly.id || idx} path={poly.path} options={poly.options} />
      ))}

      {markers.map((m) => (
        <Marker
          key={m.id || `${m.position.lat}-${m.position.lng}`}
          position={m.position}
          title={m.title}
          label={m.label}
        />
      ))}

      {polylines.map((line, idx) => (
        <Polyline
          key={line.id || idx}
          path={line.path}
          options={line.options}
        />
      ))}

      {children}
    </GoogleMap>
  );
}
