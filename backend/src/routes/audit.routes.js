const express = require('express');
const { getMyAuditLogs, getAllAuditLogs, verifyIntegrity, getSecurityAlerts } = require('../controllers/audit.controller');
const { authenticateToken, authenticateAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

// Patient: own audit trail
router.get('/my', authenticateToken, getMyAuditLogs);

// Admin: full audit access
router.get('/all', authenticateAdmin, getAllAuditLogs);
router.get('/integrity', authenticateAdmin, verifyIntegrity);
router.get('/alerts', authenticateAdmin, getSecurityAlerts);

module.exports = router;
