const express = require('express');
const { body } = require('express-validator');
const {
  requestConsent, getMyConsentRequests, approveConsent, denyConsent,
  revokeConsent, getMyActiveConsents, validateConsentToken,
  getRequestStatusByRef, getTokenForApprovedRequest,
} = require('../controllers/consent.controller');
const { authenticateToken, authenticateVendor, requireMfaVerified } = require('../middleware/auth.middleware');

const router = express.Router();

// Patient routes
router.get('/my/requests', authenticateToken, getMyConsentRequests);
router.get('/my/active', authenticateToken, getMyActiveConsents);
router.post('/requests/:requestId/approve', authenticateToken, approveConsent);
router.post('/requests/:requestId/deny', authenticateToken, denyConsent);
router.post('/tokens/:tokenRef/revoke', authenticateToken, revokeConsent);

// Vendor routes
router.post('/request',
  authenticateVendor,
  [
    body('healthId').notEmpty().trim(),
    body('purpose').notEmpty(),
    body('requestedDataTypes').isArray({ min: 1 }),
  ],
  requestConsent
);
router.post('/validate', authenticateVendor, validateConsentToken);
router.get('/request-status/:requestRef', authenticateVendor, getRequestStatusByRef);
router.get('/my-token/:requestId', authenticateVendor, getTokenForApprovedRequest);

module.exports = router;
