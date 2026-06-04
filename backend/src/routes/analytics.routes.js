const express = require('express');
const { runAnomalyDetection, getRiskDashboard, getVendorAccessStats } = require('../controllers/analytics.controller');
const { authenticateAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/dashboard', authenticateAdmin, getRiskDashboard);
router.get('/anomalies', authenticateAdmin, runAnomalyDetection);
router.get('/vendor-stats', authenticateAdmin, getVendorAccessStats);

module.exports = router;
