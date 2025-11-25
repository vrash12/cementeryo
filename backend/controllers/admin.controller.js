const pool = require("../config/database");

// Example: dashboard metrics
async function dashboardMetrics(req, res, next) {
  try {
    const sql = `
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM plots) AS plots,
        (SELECT COUNT(*) FROM graves) AS graves,
        (SELECT COUNT(*) FROM maintenance_requests WHERE status <> 'closed') AS open_maintenance
    `;
    const { rows } = await pool.query(sql);
    res.json(rows[0]);
  } catch (err) { next(err); }
}

function parseLatLngFromString(s) {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();

  // WKT: POINT (lng lat)
  const mPoint = t.match(/^POINT\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)$/i);
  if (mPoint) {
    const lng = Number(mPoint[1]);
    const lat = Number(mPoint[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }

  // "lat, lng" or "lat lng"
  const mPair = t.match(/^\s*([+-]?\d+(?:\.\d+)?)\s*,?\s+([+-]?\d+(?:\.\d+)?)\s*$/);
  if (mPair) {
    const lat = Number(mPair[1]);
    const lng = Number(mPair[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

function genUid() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function makePlotHandlers(tableName) {
  // check uid uniqueness within the table
  const isUidTaken = async (uid) => {
    const { rows } = await pool.query(`SELECT 1 FROM ${tableName} WHERE uid = $1 LIMIT 1`, [uid]);
    return rows.length > 0;
  };

const add = async (req, res, next) => {
  try {
    const actor = req.user;
    if (!actor || actor.role !== "admin") {
      return res.status(403).json({ error: "Forbidden: admin only" });
    }

      const {
        uid: uidRaw,
        plot_name,
        plot_type,
        size_sqm,
        status: statusRaw,
        latitude,
        longitude,
        coordinates: coordinatesRaw,
      } = req.body || {};

      // derive lat/lng
      let latLng = null;
      if (
        latitude != null &&
        longitude != null &&
        String(latitude).trim() !== "" &&
        String(longitude).trim() !== ""
      ) {
        const lat = Number(latitude);
        const lng = Number(longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) latLng = { lat, lng };
      }
      if (!latLng && typeof coordinatesRaw === "string" && coordinatesRaw.trim() !== "") {
        latLng = parseLatLngFromString(coordinatesRaw);
      }

      // status default
      const status = (statusRaw && String(statusRaw).trim() !== "") ? statusRaw : "available";

      // 5-char uid
      let uid = (typeof uidRaw === "string" && uidRaw.length === 5) ? uidRaw : null;
      if (uid && await isUidTaken(uid)) uid = null;
      if (!uid) {
        let attempts = 0;
        while (attempts++ < 10) {
          const cand = genUid();
          if (!(await isUidTaken(cand))) { uid = cand; break; }
        }
        if (!uid) return res.status(500).json({ error: "Failed to generate unique uid" });
      }

      // Build INSERT (geometry via ST_MakePoint)
      const cols = ["uid","plot_name", "plot_type", "size_sqm", "status", "created_at", "updated_at"];
      const vals = ["$1", "$2", "$3", "$4", "$5", "NOW()", "NOW()"];
      const params = [uid, plot_name ?? null, plot_type ?? null, size_sqm ?? null, status];

      if (latLng) {
        cols.push("coordinates");
        // 2 params for lng/lat; ST_SetSRID(ST_MakePoint($7,$8), 4326)
        vals.push("ST_SetSRID(ST_MakePoint($6, $7), 4326)");
        params.push(Number(latLng.lng), Number(latLng.lat));
      }

      const sql = `
        INSERT INTO ${tableName} (${cols.join(", ")})
        VALUES (${vals.join(", ")})
        RETURNING *
      `;
      const { rows } = await pool.query(sql, params);
      return res.status(201).json(rows[0]);
    } catch (err) { next(err); }
  };

  const edit = async (req, res, next) => {
    try {
      const id = req.body?.id ?? req.params?.id;
      if (!id) return res.status(400).json({ error: "id is required" });

      const {
        uid,
        plot_name,
        plot_type,
        size_sqm,
        status,
        latitude,
        longitude,
        coordinates: coordinatesRaw,
      } = req.body || {};

      // derive lat/lng (same logic as add)
      let latLng = null;
      if (
        latitude != null && longitude != null &&
        String(latitude).trim() !== "" && String(longitude).trim() !== ""
      ) {
        const lat = Number(latitude);
        const lng = Number(longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) latLng = { lat, lng };
      }
      if (!latLng && typeof coordinatesRaw === "string" && coordinatesRaw.trim() !== "") {
        latLng = parseLatLngFromString(coordinatesRaw);
      }

      const sets = [];
      const params = [];
      let i = 1;
      const addSet = (col, val) => {
        if (typeof val !== "undefined") {
          sets.push(`${col} = $${i++}`);
          params.push(val);
        }
      };

      addSet("uid", uid);
      addSet("plot_name", plot_name);
      addSet("plot_type", plot_type);
      addSet("size_sqm", size_sqm);
      addSet("status", status);

      if (latLng) {
        // coordinates = ST_SetSRID(ST_MakePoint($i,$i+1),4326)
        sets.push(`coordinates = ST_SetSRID(ST_MakePoint($${i}, $${i + 1}), 4326)`);
        params.push(Number(latLng.lng), Number(latLng.lat));
        i += 2;
      }

      // Always bump updated_at
      sets.push("updated_at = NOW()");

      if (sets.length === 1) {
        return res.status(400).json({ error: "No updatable fields provided" });
      }

      const sql = `UPDATE ${tableName} SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`;
      params.push(id);

      const { rows } = await pool.query(sql, params);
      if (rows.length === 0) return res.status(404).json({ error: "Not found" });
      return res.json(rows[0]);
    } catch (err) { next(err); }
  };

const del = async (req, res, next) => {
  try {
    const actor = req.user;
    if (!actor || actor.role !== "admin") {
      return res.status(403).json({ error: "Forbidden: admin only" });
    }

    const raw = req.params?.id ?? req.body?.id;
      if (!raw) return res.status(400).json({ error: "id (or uid) is required" });

      const sql = `
        DELETE FROM ${tableName}
        WHERE id::text = $1 OR uid = $1
        RETURNING id, uid, plot_name
      `;
      const { rows } = await pool.query(sql, [String(raw)]);
      if (rows.length === 0) return res.status(404).json({ error: "Not found" });

      const d = rows[0];
      return res.json({ ok: true, deleted_id: d.id, deleted_uid: d.uid, plot_name: d.plot_name });
    } catch (err) {
      if (err && err.code === "23503") {
        return res.status(409).json({
          error: "Cannot delete: referenced by other records.",
          code: "FK_CONSTRAINT",
        });
      }
      next(err);
    }
  };

  return { add, edit, del };
}

const BPlotsHandlers = makePlotHandlers("plots");
const RoadHandlers = makePlotHandlers("road_plots");
const BuildingHandlers = makePlotHandlers("building_plots");

// Expose named functions you asked for:
const addPlots = BPlotsHandlers.add;
const editPlots = BPlotsHandlers.edit;
const deletePlots = BPlotsHandlers.del;

const addRoadPlots = RoadHandlers.add;
const editRoadPlots = RoadHandlers.edit;
const deleteRoadPlots = RoadHandlers.del;

const addBuildingPlots = BuildingHandlers.add;
const editBuildingPlots = BuildingHandlers.edit;
const deleteBuildingPlots = BuildingHandlers.del;

function clean(obj) {
  // keep falsy like 0/false/''/null; drop only undefined
  return Object.fromEntries(
    Object.entries(obj || {}).filter(([, v]) => v !== undefined)
  );
}


function buildQrPayload(snapshot) {
  // Include ALL inputs you care about in the QR
  return JSON.stringify(
    clean({
      _type: "burial_record",
      id: snapshot.id,
      uid: snapshot.uid,
      plot_id: snapshot.plot_id,
      deceased_name: snapshot.deceased_name,
      birth_date: snapshot.birth_date,
      death_date: snapshot.death_date,
      burial_date: snapshot.burial_date,
      family_contact: snapshot.family_contact,
      headstone_type: snapshot.headstone_type,
      memorial_text: snapshot.memorial_text,
      is_active: snapshot.is_active,
      lat: snapshot.lat,
      lng: snapshot.lng,
      created_at: snapshot.created_at,
      updated_at: snapshot.updated_at,
    })
  );
}

async function getPlotLatLng(plotId) {
  if (!plotId) return { lat: null, lng: null };

  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(ST_Y(coordinates::geometry), NULL) AS lat,
      COALESCE(ST_X(coordinates::geometry), NULL) AS lng
    FROM plots
    WHERE id = $1
    LIMIT 1
    `,
    [plotId]
  );

  if (rows.length === 0) return { lat: null, lng: null };
  return { lat: rows[0].lat ?? null, lng: rows[0].lng ?? null };
}


async function getBurialRecords(req, res, next) {
  try {
    const limit = req.query?.limit ? Number(req.query.limit) : null;
    const offset = req.query?.offset ? Number(req.query.offset) : null;

    let sql = `
      SELECT g.*,
             u.first_name || ' ' || u.last_name AS family_contact_name
      FROM graves g
      LEFT JOIN users u ON g.family_contact = u.id
      ORDER BY g.id DESC
    `;
    const params = [];

    if (Number.isFinite(limit) && limit > 0) {
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
      if (Number.isFinite(offset) && offset >= 0) {
        params.push(offset);
        sql += ` OFFSET $${params.length}`;
      }
    }

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}


async function addBurialRecord(req, res, next) {
  const client = await pool.connect();
  try {
    const actor = req.user;
    if (!actor || actor.role !== "admin") {
      return res.status(403).json({ error: "Forbidden: admin only" });
    }
    const {
      plot_id,
      deceased_name,
      birth_date,
      death_date,
      burial_date,
      family_contact,
      headstone_type,
      memorial_text,
    } = req.body || {};

    if (!plot_id || !deceased_name) {
      return res.status(400).json({ error: "plot_id and deceased_name are required" });
    }

    // ensure plot exists + get coordinates
    const { rows: plotRows } = await pool.query(
      `
      SELECT
        id,
        COALESCE(ST_Y(coordinates::geometry), NULL) AS lat,
        COALESCE(ST_X(coordinates::geometry), NULL) AS lng
      FROM plots
      WHERE id = $1
      LIMIT 1
      `,
      [plot_id]
    );
    if (plotRows.length === 0) return res.status(404).json({ error: "Plot not found" });
    const { lat, lng } = plotRows[0];

    // fetch family_contact_name if provided
    let family_contact_name = null;
    if (family_contact) {
      const { rows: userRows } = await pool.query(
        `SELECT first_name || ' ' || last_name AS name FROM users WHERE id = $1 LIMIT 1`,
        [family_contact]
      );
      family_contact_name = userRows[0]?.name || null;
    }

    // generate UID
    const isUidTaken = async (uid) => {
      const { rows } = await pool.query(`SELECT 1 FROM graves WHERE uid = $1 LIMIT 1`, [uid]);
      return rows.length > 0;
    };
    let uid = null;
    for (let i = 0; i < 12; i++) {
      const cand = genUid();
      if (!(await isUidTaken(cand))) { uid = cand; break; }
    }
    if (!uid) return res.status(500).json({ error: "Failed to generate unique uid" });

    await client.query("BEGIN");

    await client.query(
      `UPDATE plots SET status = 'occupied', updated_at = NOW() WHERE id = $1`,
      [plot_id]
    );

    const nowIso = new Date().toISOString();
    const snapshot = {
      uid,
      plot_id,
      deceased_name,
      birth_date: birth_date || null,
      death_date: death_date || null,
      burial_date: burial_date || null,
      family_contact: family_contact || null,
      family_contact_name, 
      headstone_type: headstone_type || null,
      memorial_text: memorial_text || null,
      is_active: true,
      lat, lng,
      created_at: nowIso,
      updated_at: nowIso,
    };
    const qr_token = buildQrPayload(snapshot);

    const ins = await client.query(
      `
      INSERT INTO graves
        (uid, plot_id, deceased_name, birth_date, death_date, burial_date,
         family_contact, headstone_type, memorial_text, qr_token, is_active,
         created_at, updated_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, TRUE, NOW(), NOW())
      RETURNING *
      `,
      [
        uid,
        plot_id,
        deceased_name,
        birth_date || null,
        death_date || null,
        burial_date || null,
        family_contact || null,
        headstone_type || null,
        memorial_text || null,
        qr_token,
      ]
    );

    await client.query("COMMIT");
    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    next(err);
  } finally {
    client.release();
  }
}

// --- EDIT BURIAL RECORD ---
async function editBurialRecord(req, res, next) {
  try {
    const {
      id,
      uid,
      plot_id,
      deceased_name,
      birth_date,
      death_date,
      burial_date,
      family_contact,
      headstone_type,
      memorial_text,
      is_active,
    } = req.body || {};

    if (!id && !uid) {
      return res.status(400).json({ error: "Missing record identifier (id or uid)." });
    }

    const whereClause = id ? "id = $1" : "uid = $1";
    const { rows: foundRows } = await pool.query(
      `SELECT * FROM graves WHERE ${whereClause} LIMIT 1`,
      [id ?? uid]
    );
    if (foundRows.length === 0) {
      return res.status(404).json({ error: "Record not found." });
    }
    const existing = foundRows[0];

    // fetch family_contact_name if provided
    let family_contact_name = null;
    if (family_contact) {
      const { rows: userRows } = await pool.query(
        `SELECT first_name || ' ' || last_name AS name FROM users WHERE id = $1 LIMIT 1`,
        [family_contact]
      );
      family_contact_name = userRows[0]?.name || null;
    }

    const changes = clean({
      plot_id,
      deceased_name,
      birth_date,
      death_date,
      burial_date,
      family_contact,
      headstone_type,
      memorial_text,
      is_active,
    });
    const updatedAt = new Date();
    changes.updated_at = updatedAt;

    const merged = { ...existing, ...changes };
    const { lat, lng } = await getPlotLatLng(merged.plot_id);
    merged.lat = lat;
    merged.lng = lng;

    merged.created_at = existing.created_at?.toISOString?.() || existing.created_at || null;
    merged.updated_at = updatedAt.toISOString();

    if (family_contact_name) merged.family_contact_name = family_contact_name;

    const qr_token = buildQrPayload(merged);
    changes.qr_token = qr_token;

    const setParts = [];
    const params = [];
    Object.entries(changes).forEach(([key, value], idx) => {
      setParts.push(`${key} = $${idx + 1}`);
      params.push(value);
    });

    params.push(id ?? uid);
    const where = id ? `id = $${params.length}` : `uid = $${params.length}`;

    const sql = `UPDATE graves SET ${setParts.join(", ")} WHERE ${where} RETURNING *;`;
    const { rows } = await pool.query(sql, params);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Record not found after update." });
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}


async function deleteBurialRecord(req, res, next) {
  try {
    const identifier = req.params?.id;
    if (!identifier) {
      return res.status(400).json({ error: 'Missing record identifier.' });
    }

    // Try numeric id; if NaN, treat as uid
    const asNumber = Number(identifier);
    let sql, params;

    if (Number.isFinite(asNumber)) {
      sql = `DELETE FROM graves WHERE id = $1 RETURNING *;`;
      params = [asNumber];
    } else {
      sql = `DELETE FROM graves WHERE uid = $1 RETURNING *;`;
      params = [identifier];
    }

    const { rows } = await pool.query(sql, params);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Record not found.' });
    }

    res.json({ success: true, deleted: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function getVisitorUsers(req, res, next) {
  try {
    const { rows } = await pool.query(
      `
      SELECT id, last_name, first_name
      FROM users
      WHERE role = $1
      ORDER BY last_name ASC, first_name ASC
      `,
      ["visitor"]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  dashboardMetrics,
  addPlots,
  editPlots,
  deletePlots,
  // road_plots
  addRoadPlots,
  editRoadPlots,
  deleteRoadPlots,
  // building_plots
  addBuildingPlots,
  editBuildingPlots,
  deleteBuildingPlots,
  getBurialRecords,
  addBurialRecord, 

  editBurialRecord,
  deleteBurialRecord,
  getVisitorUsers,
};