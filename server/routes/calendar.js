/**
 * Modul: Kalender (Calendar)
 * Zweck: REST-API-Routen für Kalendereinträge und externe Kalender-Sync
 * Abhängigkeiten: express, server/db.js, server/auth.js
 */

const express = require('express');
const router = express.Router();

// Platzhalter — wird in Phase 3 implementiert
router.get('/', (req, res) => res.json({ data: [] }));

module.exports = router;
