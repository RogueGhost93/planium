/**
 * Modul: Quotes
 * Zweck: Liefert ein Zitat des Tages basierend auf dem aktuellen Datum
 * Abhängigkeiten: express, server/data/quotes.json
 */

import express from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const quotesData = require('../data/quotes.json');
const quotes = quotesData.quotes;

const router = express.Router();

/**
 * GET /api/v1/quotes/today
 * Returns a deterministic quote-of-the-day based on the current date.
 */
router.get('/today', (_req, res) => {
  const now = new Date();
  const dayOfYear = Math.floor(
    (now - new Date(now.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24)
  );
  const index = dayOfYear % quotes.length;
  res.json(quotes[index]);
});

export default router;
