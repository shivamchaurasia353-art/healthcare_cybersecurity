const express = require('express');
const { query } = require('../database/db');
const { authenticateAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

// List all approved vendors (public)
router.get('/', async (req, res) => {
  const result = await query(
    'SELECT id, vendor_code, name, vendor_type, contact_email, created_at FROM vendors WHERE is_active = TRUE AND is_approved = TRUE ORDER BY name'
  );
  res.json({ vendors: result.rows });
});

// Admin: approve a vendor
router.post('/:vendorId/approve', authenticateAdmin, async (req, res) => {
  const result = await query(
    'UPDATE vendors SET is_approved = TRUE, approved_at = NOW(), approved_by = $1 WHERE id = $2 RETURNING id, name',
    [req.admin.userId, req.params.vendorId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Vendor not found' });
  res.json({ message: 'Vendor approved', vendor: result.rows[0] });
});

module.exports = router;
