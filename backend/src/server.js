require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { logger } = require('./utils/logger');
const { connectDB } = require('./database/db');

// Route imports
const authRoutes = require('./routes/auth.routes');
const identityRoutes = require('./routes/identity.routes');
const consentRoutes = require('./routes/consent.routes');
const recordRoutes = require('./routes/record.routes');
const vendorRoutes = require('./routes/vendor.routes');
const auditRoutes = require('./routes/audit.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const demoRoutes = require('./routes/demo.routes');

const app = express();
const PORT = process.env.PORT || 5000;

// --- Security Middleware ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// CORS - allow frontend and vendor demo origins
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:5001', // vendor demo local server
];
// In development, also allow file:// (null origin) for the vendor demo HTML
if (process.env.NODE_ENV === 'development') {
  allowedOrigins.push(null);
}
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman) and allowed origins
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  credentials: true,
}));

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use(globalLimiter);

// Body parser
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// HTTP request logging (no sensitive body data)
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
}));

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'HealthSecure API' });
});

// --- API Routes ---
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/identity', identityRoutes);
app.use('/api/v1/consent', consentRoutes);
app.use('/api/v1/records', recordRoutes);
app.use('/api/v1/vendors', vendorRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/demo', demoRoutes);

// --- 404 Handler ---
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// --- Global Error Handler ---
// Avoids leaking stack traces or internal details to clients
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(err.statusCode || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// --- Start Server ---
connectDB().then(() => {
  app.listen(PORT, () => {
    logger.info(`HealthSecure backend running on port ${PORT} [${process.env.NODE_ENV}]`);
  });
}).catch((err) => {
  logger.error('Database connection failed:', err);
  process.exit(1);
});

module.exports = app;
