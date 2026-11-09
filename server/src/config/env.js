'use strict';

const dotenv = require('dotenv');
const path = require('path');

// Load .env from the server root regardless of where node is invoked from.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(key) {
  const value = process.env[key];
  if (value === undefined || value === null || value === '') {
    // Fail fast on boot rather than at first query.
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key, fallback) {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function int(key, fallback) {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  isProd: optional('NODE_ENV', 'development') === 'production',
  port: int('PORT', 4000),

  databaseUrl: required('DATABASE_URL'),

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '7d'),
    refreshSecret: optional('JWT_REFRESH_SECRET', optional('JWT_SECRET', 'refresh-secret')),
    refreshExpiresIn: optional('JWT_REFRESH_EXPIRES_IN', '30d'),
  },

  bcryptSaltRounds: int('BCRYPT_SALT_ROUNDS', 10),

  // CORS origins: comma separated.
  clientOrigins: optional('CLIENT_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  rateLimit: {
    windowMs: int('API_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    max: int('API_RATE_LIMIT_MAX', 500),
  },

  logLevel: optional('LOG_LEVEL', 'info'),

  // The public origin this deployment is reached at. Used to build the signed
  // links in WhatsApp reports and the footer of generated PDFs. Set
  // PUBLIC_APP_URL in the host's env vars; renaming the deployment then needs
  // no code change. Trailing slashes are stripped so links never double up.
  // The business is ZELab and the site is www.zelab.site (10 Nov 2026) — the
  // fallback follows; the value that counts in production is the variable.
  appUrl: String(optional('PUBLIC_APP_URL', 'https://www.zelab.site')).replace(/\/+$/, ''),

  business: {
    currency: optional('CURRENCY', 'TZS'),
    locale: optional('LOCALE', 'en-TZ'),
    defaultCreditTermDays: int('DEFAULT_CREDIT_TERM_DAYS', 30),
    reorderLookbackDays: int('REORDER_LOOKBACK_DAYS', 30),
  },

  seed: {
    adminName: optional('SEED_ADMIN_NAME', 'System Administrator'),
    adminEmail: optional('SEED_ADMIN_EMAIL', 'admin@example.com'),
    // NO DEFAULT on purpose: a published fallback password would let anyone
    // who reads this repo sign in to any deployment seeded without the var.
    // The seed script must refuse to run rather than use a known value.
    adminPassword: optional('SEED_ADMIN_PASSWORD', null),
  },
};

module.exports = env;
