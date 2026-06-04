const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateVendor } = require('../middleware/auth.middleware');
const { patientAction } = require('../controllers/demo.controller');

const router = express.Router();

// Only available in non-production
router.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
});

/**
 * POST /api/v1/demo/patient-action
 * Simulate patient approve/deny from vendor demo portal.
 */
router.post('/patient-action',
  authenticateVendor,
  [
    body('requestRef').notEmpty(),
    body('action').isIn(['approve', 'deny']),
    body('patientEmail').isEmail(),
    body('patientPassword').notEmpty(),
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    next();
  },
  patientAction
);

module.exports = router;
