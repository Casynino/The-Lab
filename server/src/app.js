'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const logger = require('./utils/logger');
const routes = require('./routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Behind a proxy/load balancer (Render, Railway, Fly, Nginx) so rate-limit and
// req.ip see the real client address.
app.set('trust proxy', 1);

app.use(helmet());

// CORS — allow non-browser tools (no Origin) and the configured origins. A
// disallowed origin is denied CLEANLY (callback(null, false)) rather than
// throwing — throwing turned every browser request into a 500. Same-origin
// requests (the SPA + API share a domain on Vercel) always work since the
// browser doesn't enforce CORS for them. Set CLIENT_ORIGIN to "*" to allow all.
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const allowed = env.clientOrigins;
      if (allowed.includes('*') || allowed.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }),
);

app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

if (!env.isProd) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', { stream: { write: (m) => logger.info(m.trim()) } }));
}

// The page behind the QR code on the carton. Mounted at the app root rather
// than under /api so the printed address stays short — every character is QR
// modules, and modules are millimetres on a 70 x 36 mm box. It sits above the
// rate limiter deliberately: Tanzanian mobile networks put a whole market
// street behind a handful of IP addresses, and a limiter tuned for an API
// would lock all of them out of a page printed on the product.
app.use('/p', require('./routes/productPage.routes'));

// Global rate limiter (auth endpoints add a stricter one of their own).
app.use(
  rateLimit({
    windowMs: env.rateLimit.windowMs,
    max: env.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { message: 'Too many requests, slow down' } },
  }),
);

// Liveness probe (no auth, no DB).
app.get('/api/health', (_req, res) =>
  res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } }),
);

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
