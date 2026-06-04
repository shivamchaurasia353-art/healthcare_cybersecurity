const express = require('express');
const { getMyIdentity, lookupByHealthId, updateProfile, getMyVendorRelationships } = require('../controllers/identity.controller');
const { authenticateToken, authenticateVendor } = require('../middleware/auth.middleware');

const router = express.Router();

// Patient routes
router.get('/me', authenticateToken, getMyIdentity);
router.put('/me', authenticateToken, updateProfile);
router.get('/me/vendors', authenticateToken, getMyVendorRelationships);

// Vendor routes (vendor API key required)
router.get('/lookup/:healthId', authenticateVendor, lookupByHealthId);

module.exports = router;
