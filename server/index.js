/**
 * Modul: Server Entry Point
 * Zweck: Express-App initialisieren, Middleware einbinden, Routen registrieren
 * Abhängigkeiten: express, helmet, server/db.js, server/auth.js, server/routes/*
 */

import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { createLogger } from './logger.js';
import * as db from './db.js';
import { router as authRouter, sessionMiddleware, requireAuth } from './auth.js';
import { csrfMiddleware } from './middleware/csrf.js';
import * as googleCalendar from './services/google-calendar.js';
import * as appleCalendar from './services/apple-calendar.js';
import dashboardRouter from './routes/dashboard.js';
import personalListsRouter from './routes/personal-lists.js';
import listsRouter from './routes/lists.js';
import mealsRouter from './routes/meals.js';
import calendarRouter from './routes/calendar.js';
import notesRouter from './routes/notes.js';
import notebookRouter from './routes/notebook.js';
import contactsRouter from './routes/contacts.js';
import budgetRouter from './routes/budget.js';
import weatherRouter from './routes/weather.js';
import quotesRouter from './routes/quotes.js';
import mealieRouter from './routes/mealie.js';
import freshrssRouter from './routes/freshrss.js';
import linkdingRouter from './routes/linkding.js';
import bookmarksRouter from './routes/bookmarks.js';
import fileboxRouter, { shareRouter as fileboxShareRouter, combinedShareRouter } from './routes/filebox.js';
import pushRouter from './routes/push.js';
import webviewRouter from './routes/webview.js';
import { startAlarmScheduler } from './services/alarm-scheduler.js';
import { getWebviewOrigins } from './services/webview.js';

const log     = createLogger('Server');
const logSync = createLogger('Sync');
const logPlanner = createLogger('Planner');

const app  = express();
const PORT = process.env.PORT || 3000;

// --------------------------------------------------------
// Security-Middleware
// --------------------------------------------------------
const isSecure = process.env.SESSION_SECURE !== 'false';
app.use((req, res, next) => {
  const webviewOrigins = getWebviewOrigins();
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          // Inline-Script: Theme-Detection (Flash-Prevention)
          "'sha256-vqqBNo1oitnzIntwkG83UaYqkUAnV/oZ/RkvcA41Y6A='",
          // Alpine.js CDN (optional, falls verwendet)
          'https://cdn.jsdelivr.net',
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:', 'http:'],
        connectSrc: ["'self'", 'https://api.coingecko.com'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: webviewOrigins.length ? webviewOrigins : ["'none'"],
        frameAncestors: ["'self'", "https://homarr.letsflyhi.com", "https://homarr.luka.letsflyhi.com"],
        // upgrade-insecure-requests nur mit HTTPS aktivieren
        upgradeInsecureRequests: isSecure ? [] : null,
      },
    },
    // X-Frame-Options deaktivieren — frame-ancestors in CSP übernimmt die Kontrolle
    frameguard: false,
    // HSTS nur mit HTTPS aktivieren
    hsts: isSecure ? {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    } : false,
  })(req, res, next);
});

// Trust Proxy: nur aktivieren wenn ein Reverse Proxy vorgeschaltet ist (TRUST_PROXY env var).
// Default 'loopback' akzeptiert nur X-Forwarded-For von localhost - verhindert IP-Spoofing.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

// --------------------------------------------------------
// Request-Parsing
// --------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// JSON-Parse-Fehler abfangen (gibt sonst HTML zurück)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body.', code: 400 });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large (max. 1 MB).', code: 413 });
  }
  next(err);
});

// --------------------------------------------------------
// Sessions
// --------------------------------------------------------
app.use(sessionMiddleware);

// --------------------------------------------------------
// API-Antworten: kein Browser-Caching (Sicherheit + Aktualität)
// --------------------------------------------------------
app.use('/api/', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// --------------------------------------------------------
// Statische Dateien (Frontend) - differenzierte Caching-Strategie
//
// HTML + JS + CSS: no-cache (Browser revalidiert via ETag/304, kein stale Content
//   nach Deployment). Bei unverändertem File → 304 Not Modified ohne Übertragung.
// Bilder + Icons + Fonts: 30 Tage immutable (ändern sich praktisch nie).
// manifest.json + sw.js: no-cache (PWA-Updates sollen sofort greifen).
// --------------------------------------------------------
app.use(express.static(path.join(import.meta.dirname, '..', 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const isPwaIcon = /\/icons\/(icon-|apple-touch-icon|favicon)/.test(filePath);
    if (isPwaIcon) {
      // PWA-Icons müssen bei Deployments sofort aktualisiert werden
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (['.png', '.jpg', '.jpeg', '.ico', '.svg', '.webp', '.woff2', '.woff'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable'); // 30 Tage
    } else {
      // HTML, JS, CSS, JSON, manifest, sw - immer revalidieren
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
    // manifest.json: korrekter MIME-Type für PWA-Erkennung durch Chrome/Android
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
  },
}));

// --------------------------------------------------------
// Globaler API-Rate-Limiter (Schritt 29)
// Verhindert Brute-Force und DoS auf allen API-Endpunkten.
// Login hat einen eigenen, strengeren Limiter (auth.js).
// --------------------------------------------------------
const apiLimiter = rateLimit({
  windowMs: 60_000,         // 1 Minute
  max: 300,                 // 300 Requests/Minute pro IP (großzügig für Familien-App)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment.', code: 429 },
  skip: (req) => req.path === '/health', // Health-Check ausgenommen
});
app.use('/api/', apiLimiter);

// --------------------------------------------------------
// API-Routen
// --------------------------------------------------------
app.use('/api/v1/auth', authRouter);

// Web Share Target endpoints — mounted OUTSIDE /api/v1 (no CSRF header from
// Android share intents). Origin check inside provides CSRF protection.
// /share      = new combined router: links → tasks, files → filebox
// /filebox/share = legacy path kept for existing PWA installs
app.use('/share', combinedShareRouter);
app.use('/filebox/share', fileboxShareRouter);

// Alle weiteren API-Routen erfordern Authentifizierung + CSRF-Schutz
app.use('/api/v1', requireAuth);
app.use('/api/v1', csrfMiddleware);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/personal-lists', personalListsRouter);
app.use('/api/v1/lists', listsRouter);
app.use('/api/v1/meals', mealsRouter);
app.use('/api/v1/calendar', calendarRouter);
app.use('/api/v1/notes', notesRouter);
app.use('/api/v1/notebook', notebookRouter);
app.use('/api/v1/contacts', contactsRouter);
app.use('/api/v1/budget', budgetRouter);
app.use('/api/v1/weather', weatherRouter);
app.use('/api/v1/quotes', quotesRouter);
app.use('/api/v1/mealie', mealieRouter);
app.use('/api/v1/freshrss', freshrssRouter);
app.use('/api/v1/linkding', linkdingRouter);
app.use('/api/v1/filebox', fileboxRouter);
app.use('/api/v1', bookmarksRouter);
app.use('/api/v1/push', pushRouter);
app.use('/api/v1/webview', webviewRouter);

// --------------------------------------------------------
// Health-Check (für Docker)
// --------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --------------------------------------------------------
// Rate-Limiter für SPA-Fallback (verhindert Dateisystem-Hammering)
// --------------------------------------------------------
const spaLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment.', code: 429 },
});

// --------------------------------------------------------
// SPA Fallback: Alle nicht-API-Routen → index.html
// --------------------------------------------------------
app.get('*', spaLimiter, (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Nicht gefunden.', code: 404 });
  }
  res.sendFile(path.join(import.meta.dirname, '..', 'public', 'index.html'));
});

// --------------------------------------------------------
// Globaler Error-Handler
// --------------------------------------------------------
app.use((err, req, res, _next) => {
  log.error('Unbehandelter Fehler:', err);
  res.status(500).json({ error: 'Interner Serverfehler.', code: 500 });
});

// --------------------------------------------------------
// Auto-Sync Scheduler (Google + Apple Calendar)
// --------------------------------------------------------

const SYNC_INTERVAL_MS = (parseInt(process.env.SYNC_INTERVAL_MINUTES, 10) || 15) * 60_000;

async function runSync() {
  const { connected: googleConnected } = googleCalendar.getStatus();
  if (googleConnected) {
    googleCalendar.sync().catch((e) => logSync.error('Google Fehler:', e.message));
  }

  const { configured: appleConfigured } = appleCalendar.getStatus();
  if (appleConfigured) {
    appleCalendar.sync().catch((e) => logSync.error('Apple Fehler:', e.message));
  }
}

// --------------------------------------------------------
// Server starten
// --------------------------------------------------------
app.listen(PORT, () => {
  logPlanner.info(`Server laeuft auf Port ${PORT}`);
  logPlanner.info(`Umgebung: ${process.env.NODE_ENV || 'development'}`);

  startAlarmScheduler();

  // Erster Sync nach 10 Sekunden (warten bis DB vollständig initialisiert)
  setTimeout(() => {
    runSync();
    setInterval(runSync, SYNC_INTERVAL_MS);
    logSync.info(`Auto-Sync alle ${SYNC_INTERVAL_MS / 60_000} Minuten aktiv.`);
  }, 10_000);
});

export default app;
