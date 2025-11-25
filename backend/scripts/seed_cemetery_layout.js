// backend/scripts/seed_cemetery_layout.js
// Seed 95 GRAVE RECTANGLES (S1–S96 but skipping one) +
// 7 vertical "yellow road" LineStrings + 1 "snake" path
// perfectly INSIDE the BASE_GEOFENCE_POLYGON from CemeteryMap.jsx.

const path = require("path");
const pool = require(path.join(__dirname, "..", "config", "database"));

// ---- BASE GEOFENCE: same 4 corners as in CemeteryMap.jsx ----
// BASE_GEOFENCE_POLYGON = [
//   { lat: 15.494519, lng: 120.554952 }, // bottom right
//   { lat: 15.494804, lng: 120.554709 }, // bottom left
//   { lat: 15.495190, lng: 120.555092 }, // top left
//   { lat: 15.494837, lng: 120.555382 }, // top right
// ];

const BR = { lat: 15.494519, lng: 120.554952 }; // bottom right
const BL = { lat: 15.494804, lng: 120.554709 }; // bottom left
const TL = { lat: 15.495190, lng: 120.555092 }; // top left
const TR = { lat: 15.494837, lng: 120.555382 }; // top right

// Grid spec: 12x8 with 7 vertical roads between columns
const ROWS = 12;        // from top (row 0) to bottom (row 11)
const GRAVE_COLS = 8;   // S1–S96 columns
const ROAD_COUNT = 7;
const GRAVE_TOTAL = ROWS * GRAVE_COLS;

// We will intentionally SKIP this grave (central gap for cross-aisle)
const SKIP_PLOTS = new Set(["S40"]); // column 4, row index 6 (rough center)

const fix = (n) => Number(n.toFixed(8));

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function interp(p0, p1, t) {
  return {
    lat: lerp(p0.lat, p1.lat, t),
    lng: lerp(p0.lng, p1.lng, t),
  };
}

/**
 * Map (u, v) in [0,1]x[0,1] into the base quadrilateral:
 *  - v: 0 bottom, 1 top
 *  - u: 0 left,   1 right
 */
function positionAt(u, vBottomToTop) {
  const left = interp(BL, TL, vBottomToTop);
  const right = interp(BR, TR, vBottomToTop);
  return {
    lat: left.lat + (right.lat - left.lat) * u,
    lng: left.lng + (right.lng - left.lng) * u,
  };
}

// ---------- name mapping (matches your S1–S96 spec) ----------
function graveNameFor(col, row) {
  // col = 1..8, row = 0..11 (top to bottom)
  if (col >= 1 && col <= 6) {
    // Column 1: S1, S7, S13, ..., S67
    // Column 2: S2, S8, S14, ..., S68
    // ...
    // Column 6: S6, S12, S18, ..., S72
    return `S${col + 6 * row}`;
  }
  if (col === 7) {
    // Column 7: S73..S84
    return `S${72 + (row + 1)}`;
  }
  if (col === 8) {
    // Column 8: S85..S96
    return `S${84 + (row + 1)}`;
  }
  throw new Error(`Invalid grave column index: ${col}`);
}

// ---------- horizontal boundaries (u in [0,1]) ----------
function buildHorizontalBoundaries() {
  const boundaries = [0]; // u = 0 at left edge

  for (let gridCol = 0; gridCol < 15; gridCol++) {
    // 15 grid columns = 8 grave + 7 road
    const widthUnits = gridCol % 2 === 0 ? 2 : 1; // even = grave, odd = road
    boundaries.push(boundaries[boundaries.length - 1] + widthUnits / 23);
  }

  // boundaries.length should be 16; last should be ~1
  return boundaries;
}

// Grave column center unit positions (just for reference):
// centers at units 1,4,7,10,13,16,19,22 => (1+3*k)/23
function uForGraveColumnCenter(col) {
  const k = col - 1; // 0-based
  const pos = 1 + 3 * k;
  return pos / 23;
}

// Road center positions between columns
function uForRoadCenter(i) {
  const pos = 2.5 + 3 * i; // i = 0..6
  return pos / 23;
}

// Helper: v for the CENTER of a row (row 0 = top, 11 = bottom)
function vForRowCenter(row) {
  const vBottom = (ROWS - (row + 1)) / ROWS;
  const vTop = (ROWS - row) / ROWS;
  return (vBottom + vTop) / 2;
}

// ---------- build rectangular grave polygons ----------
function buildGravePlots() {
  const graves = [];
  const boundaries = buildHorizontalBoundaries();

  for (let col = 1; col <= GRAVE_COLS; col++) {
    // each grave column is at gridCol = 2*(col-1)
    const gridCol = 2 * (col - 1);
    const uLeft = boundaries[gridCol];
    const uRight = boundaries[gridCol + 1];

    for (let row = 0; row < ROWS; row++) {
      // row 0 is TOP, row 11 is BOTTOM
      // v is bottom→top, so bottom boundary for row is (ROWS-(row+1))/ROWS
      // and top boundary is (ROWS-row)/ROWS
      const vBottom = (ROWS - (row + 1)) / ROWS;
      const vTop = (ROWS - row) / ROWS;

      const plotName = graveNameFor(col, row);

      // Skip a single grave to create a small "gap" / cross-aisle
      if (SKIP_PLOTS.has(plotName)) {
        continue;
      }

      // corners in uv-space mapped into the geofence quad:
      const pTL = positionAt(uLeft, vTop);
      const pTR = positionAt(uRight, vTop);
      const pBR = positionAt(uRight, vBottom);
      const pBL = positionAt(uLeft, vBottom);

      const wkt = `POLYGON((${[
        `${fix(pTL.lng)} ${fix(pTL.lat)}`,
        `${fix(pTR.lng)} ${fix(pTR.lat)}`,
        `${fix(pBR.lng)} ${fix(pBR.lat)}`,
        `${fix(pBL.lng)} ${fix(pBL.lat)}`,
        `${fix(pTL.lng)} ${fix(pTL.lat)}`, // close ring
      ].join(", ")}))`;

      graves.push({
        uid: `S${String(plotName.slice(1)).padStart(4, "0")}`, // S0001..S0096
        plot_name: plotName,
        plot_type: "grave_double",
        size_sqm: null,
        status: "available",
        wkt,
      });
    }
  }

  const expected = GRAVE_TOTAL - SKIP_PLOTS.size;
  if (graves.length !== expected) {
    throw new Error(`Expected ${expected} grave rectangles, got ${graves.length}`);
  }

  return graves;
}

// ---------- build 7 vertical road LineStrings ----------
function makeRoadLineWkt(u) {
  const bottom = positionAt(u, 0); // v=0 bottom edge
  const top = positionAt(u, 1);    // v=1 top edge
  const x1 = fix(bottom.lng);
  const y1 = fix(bottom.lat);
  const x2 = fix(top.lng);
  const y2 = fix(top.lat);
  return `LINESTRING(${x1} ${y1}, ${x2} ${y2})`;
}

function buildRoadPlots() {
  const roads = [];

  for (let i = 0; i < ROAD_COUNT; i++) {
    const u = uForRoadCenter(i);
    const wkt = makeRoadLineWkt(u);
    const index = i + 1;

    roads.push({
      uid: `R${String(index).padStart(4, "0")}`, // R0001..R0007
      plot_name: `ROAD_${index}`,
      plot_type: "road_vertical",
      size_sqm: null,
      status: "available",
      wkt,
    });
  }

  if (roads.length !== ROAD_COUNT) {
    throw new Error(`Expected ${ROAD_COUNT} roads, got ${roads.length}`);
  }

  return roads;
}

// ---------- extra: one "snake" path like in the mockup image ----------
function buildMainPathRoad() {
  // use grave column centers so the path visually lines up with aisles
  const uCol2 = uForGraveColumnCenter(2);
  const uCol4 = uForGraveColumnCenter(4);
  const uCol6 = uForGraveColumnCenter(6);

  // mid-row that roughly matches the screenshot (and passes through S40)
  const vMid = vForRowCenter(6); // row index 6

  const ptsUV = [
    [uCol4, 0.02],      // bottom, a bit inside
    [uCol4, vMid],      // go up through the central column (over the missing grave)
    [uCol2, vMid],      // jog left
    [uCol2, 0.80],      // up on the left
    [uCol6, 0.88],      // cross to the right near the top
    [uCol6, 0.98],      // exit near top-right
  ];

  const coords = ptsUV.map(([u, v]) => {
    const p = positionAt(u, v);
    return `${fix(p.lng)} ${fix(p.lat)}`;
  });

  const wkt = `LINESTRING(${coords.join(", ")})`;

  return {
    uid: `R${String(ROAD_COUNT + 1).padStart(4, "0")}`, // R0008
    plot_name: `ROAD_${ROAD_COUNT + 1}`,
    plot_type: "road_snake",
    size_sqm: null,
    status: "available",
    wkt,
  };
}

// ---------- SQL helpers (revert + reseed) ----------

// Remove only our S* plots and ROAD_* roads → "revert earlier seeded data"
async function clearExisting() {
  await pool.query("BEGIN");
  try {
    await pool.query(
      "DELETE FROM road_plots WHERE uid LIKE 'R____' OR plot_name LIKE 'ROAD_%'"
    );
    await pool.query("DELETE FROM plots WHERE plot_name LIKE 'S%'");
    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }
}

// insert rectangles into plots.coordinates (Polygon)
async function insertGraves(graves) {
  const sql = `
    INSERT INTO plots (
      uid,
      plot_name,
      plot_type,
      size_sqm,
      status,
      created_at,
      updated_at,
      coordinates
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      NOW(),
      NOW(),
      ST_SetSRID(ST_GeomFromText($6), 4326)
    )
  `;

  for (const g of graves) {
    await pool.query(sql, [
      g.uid,
      g.plot_name,
      g.plot_type,
      g.size_sqm,
      g.status,
      g.wkt,
    ]);
  }
}

// insert LineStrings into road_plots.coordinates
async function insertRoads(roads) {
  const sql = `
    INSERT INTO road_plots (
      uid,
      plot_code,
      plot_name,
      plot_type,
      size_sqm,
      status,
      created_at,
      updated_at,
      coordinates
    )
    VALUES (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      NOW(),
      NOW(),
      ST_SetSRID(ST_GeomFromText($7), 4326)
    )
  `;

  for (const r of roads) {
    await pool.query(sql, [
      r.uid,         // uid: R0001..R0008
      r.plot_name,   // plot_code: reuse "ROAD_x"
      r.plot_name,   // plot_name
      r.plot_type,   // "road_vertical" / "road_snake"
      r.size_sqm,    // null
      r.status,      // "available"
      r.wkt,         // LINESTRING WKT
    ]);
  }
}

// ---------- main ----------

async function main() {
  try {
    console.log("Building rectangular grave + road geometry inside BASE_GEOFENCE_POLYGON…");
    const graves = buildGravePlots();
    const verticalRoads = buildRoadPlots();
    const snakeRoad = buildMainPathRoad();
    const roads = [...verticalRoads, snakeRoad];

    console.log(`Generated ${graves.length} grave rectangles & ${roads.length} roads.`);
    console.log("Clearing existing S* plots and ROAD_* roads…");
    await clearExisting();

    console.log("Inserting rectangular graves into plots…");
    await insertGraves(graves);

    console.log("Inserting roads into road_plots…");
    await insertRoads(roads);

    console.log("✅ Seeding complete.");
  } catch (err) {
    console.error("❌ Seeding failed:", err);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().then(() => process.exit(0));
}
