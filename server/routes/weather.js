/**
 * Modul: Wetter-Proxy (Weather)
 * Zweck: Serverseitiger Proxy für OpenWeatherMap API (API-Key nie im Frontend)
 * Abhängigkeiten: express, node-fetch, dotenv
 */

const express = require('express');
const router = express.Router();

// Platzhalter — wird in Phase 4 implementiert
router.get('/', (req, res) => res.json({ data: null }));

module.exports = router;
