/**
 * Modul: Pinnwand / Notizen (Notes)
 * Zweck: REST-API-Routen für Notizen
 * Abhängigkeiten: express, server/db.js, server/auth.js
 */

const express = require('express');
const router = express.Router();

// Platzhalter — wird in Phase 3 implementiert
router.get('/', (req, res) => res.json({ data: [] }));

module.exports = router;
