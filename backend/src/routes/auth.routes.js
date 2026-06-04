const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { register, login, verifyMfa, setupMfa, confirmMfa, refreshToken, logout } = require('../controllers/auth.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

const router = express.Router();

// Strict rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  message: { error: 'Too many authentication attempts. Try again in 15 minutes.' },
});

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
};

router.post('/register',
  authLimiter,
  [
    body('fullName').trim().isLength({ min: 2, max: 150 }).escape(),
    body('dateOfBirth').isISO8601().toDate(),
    body('gender').isIn(['MALE', 'FEMALE', 'OTHER']),
    body('phone').isMobilePhone('any').trim(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 10 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/),
  ],
  validate,
  register
);

router.post('/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty().trim(),
  ],
  validate,
  login
);

router.post('/mfa/verify',
  authLimiter,
  [
    body('preAuthToken').notEmpty(),
    body('totpCode').isLength({ min: 6, max: 6 }).isNumeric(),
  ],
  validate,
  verifyMfa
);

router.post('/mfa/setup', authenticateToken, setupMfa);

router.post('/mfa/confirm',
  authenticateToken,
  [body('totpCode').isLength({ min: 6, max: 6 }).isNumeric()],
  validate,
  confirmMfa
);

router.post('/refresh',
  [body('refreshToken').notEmpty()],
  validate,
  refreshToken
);

router.post('/logout', authenticateToken, logout);

module.exports = router;
