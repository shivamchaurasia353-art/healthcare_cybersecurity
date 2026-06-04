const express = require('express');
const { createRecord, getMyRecords, getRecordById, vendorAccessRecords, uploadMyRecord, seedMyRecords } = require('../controllers/record.controller');
const { authenticateToken, authenticateVendor } = require('../middleware/auth.middleware');

const router = express.Router();

// Patient routes
router.get('/my', authenticateToken, getMyRecords);
router.get('/my/:recordId', authenticateToken, getRecordById);
router.post('/upload', authenticateToken, uploadMyRecord);
router.post('/seed-samples', authenticateToken, seedMyRecords);

// Vendor routes (requires valid consent token in request body)
router.post('/create', authenticateVendor, createRecord);
router.post('/access', authenticateVendor, vendorAccessRecords);

module.exports = router;
