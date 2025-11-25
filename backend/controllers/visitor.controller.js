//backend/controllers/visitor.controller.js
const pool = require('../config/database');

// Utility for errors
function sendBadRequest(res, message = 'Invalid request') {
  return res.status(400).json({ success: false, message });
}

/**
 * POST /visitor/request-burial
 * Body: { deceased_name, birth_date, death_date, burial_date, family_contact }
 */
async function createBurialRequest(req, res) {
  try {
    const { deceased_name, birth_date, death_date, burial_date, family_contact } = req.body;

    if (!deceased_name || !birth_date || !death_date || !burial_date || !family_contact) {
      return sendBadRequest(
        res,
        'All fields are required: deceased_name, birth_date, death_date, burial_date, family_contact'
      );
    }

    const sql = `
      INSERT INTO burial_requests
        (deceased_name, birth_date, death_date, burial_date, family_contact, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *;
    `;
    const values = [deceased_name, birth_date, death_date, burial_date, family_contact];

    const { rows } = await pool.query(sql, values);
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('createBurialRequest error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/**
 * POST /visitor/request-maintenance
 * Body: { deceased_name, family_contact }
 */
async function createMaintenanceRequest(req, res) {
  try {
    const { deceased_name, family_contact } = req.body;

    if (!deceased_name || !family_contact) {
      return sendBadRequest(res, 'All fields are required: deceased_name, family_contact');
    }

    const sql = `
      INSERT INTO maintenance_requests
        (deceased_name, family_contact, status)
      VALUES ($1, $2, 'pending')
      RETURNING *;
    `;
    const values = [deceased_name, family_contact];

    const { rows } = await pool.query(sql, values);
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('createMaintenanceRequest error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/**
 * GET /visitor/requests/burial/:family_contact
 */
async function getBurialRequests(req, res) {
  try {
    const { family_contact } = req.params;
    if (!family_contact) return sendBadRequest(res, 'family_contact is required');

    const sql = `SELECT * FROM burial_requests WHERE family_contact = $1 ORDER BY created_at DESC`;
    const { rows } = await pool.query(sql, [family_contact]);

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getBurialRequests error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/**
 * GET /visitor/requests/maintenance/:family_contact
 */
async function getMaintenanceRequests(req, res) {
  try {
    const { family_contact } = req.params;
    if (!family_contact) return sendBadRequest(res, 'family_contact is required');

    const sql = `SELECT * FROM maintenance_requests WHERE family_contact = $1 ORDER BY created_at DESC`;
    const { rows } = await pool.query(sql, [family_contact]);

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getMaintenanceRequests error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/**
 * PATCH /visitor/request-burial/cancel/:id
 */
async function cancelBurialRequest(req, res) {
  try {
    const { id } = req.params;
    if (!id) return sendBadRequest(res, 'id is required');

    const sql = `
      UPDATE burial_requests
      SET status = 'canceled'
      WHERE id = $1
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [id]);
    if (!rows.length) return sendBadRequest(res, 'Request not found');

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('cancelBurialRequest error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

/**
 * PATCH /visitor/request-maintenance/cancel/:id
 */
async function cancelMaintenanceRequest(req, res) {
  try {
    const { id } = req.params;
    if (!id) return sendBadRequest(res, 'id is required');

    const sql = `
      UPDATE maintenance_requests
      SET status = 'cancelled'
      WHERE id = $1
      RETURNING *;
    `;
    const { rows } = await pool.query(sql, [id]);
    if (!rows.length) return sendBadRequest(res, 'Request not found');

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('cancelMaintenanceRequest error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

module.exports = {
  createBurialRequest,
  createMaintenanceRequest,
  getBurialRequests,
  getMaintenanceRequests,
  cancelBurialRequest,
  cancelMaintenanceRequest,
};
