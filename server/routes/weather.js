/**
 * Modul: Wetter-Proxy (Weather)
 * Zweck: Serverseitiger Proxy für OpenWeatherMap API (API-Key nie im Frontend)
 * Abhängigkeiten: express, node-fetch, dotenv
 */

'use strict';

const express = require('express');
const router  = express.Router();

// Cache: Daten für 30 Minuten halten
let cache = { data: null, ts: 0 };
const CACHE_TTL_MS = 30 * 60 * 1000;

// --------------------------------------------------------
// GET /api/v1/weather
// Gibt aktuelles Wetter + 5-Tage-Vorschau zurück.
// Erfordert OPENWEATHER_API_KEY + OPENWEATHER_CITY in .env
// Response: { data: { current, forecast } } | { data: null }
// --------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    const city   = process.env.OPENWEATHER_CITY || 'Berlin';
    const units  = process.env.OPENWEATHER_UNITS || 'metric';
    const lang   = process.env.OPENWEATHER_LANG  || 'de';

    // Kein API-Key → leere Antwort (Widget wird ausgeblendet)
    if (!apiKey) {
      return res.json({ data: null });
    }

    // Cache prüfen
    if (cache.data && Date.now() - cache.ts < CACHE_TTL_MS) {
      return res.json({ data: cache.data });
    }

    // Dynamischer Import für node-fetch (ESM)
    const { default: fetch } = await import('node-fetch');

    // Aktuelles Wetter
    const currentUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=${units}&lang=${lang}`;
    const currentRes = await fetch(currentUrl, { signal: AbortSignal.timeout(8000) });
    if (!currentRes.ok) {
      console.warn(`[Weather] API Fehler: ${currentRes.status}`);
      return res.json({ data: null });
    }
    const currentJson = await currentRes.json();

    // 5-Tage-Forecast (3h-Intervalle → wir nehmen Mittags-Werte für Tagesvorschau)
    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${apiKey}&units=${units}&lang=${lang}&cnt=40`;
    const forecastRes = await fetch(forecastUrl, { signal: AbortSignal.timeout(8000) });
    let forecastDays = [];
    if (forecastRes.ok) {
      const forecastJson = await forecastRes.json();
      // Ein Eintrag pro Tag: nächstgelegener Mittags-Wert (12:00 Uhr)
      const seen = new Set();
      for (const item of forecastJson.list ?? []) {
        const dateStr = item.dt_txt.slice(0, 10); // YYYY-MM-DD
        if (seen.has(dateStr)) continue;
        seen.add(dateStr);
        forecastDays.push({
          date:      dateStr,
          temp_min:  Math.round(item.main.temp_min),
          temp_max:  Math.round(item.main.temp_max),
          icon:      item.weather[0]?.icon,
          desc:      item.weather[0]?.description,
        });
        if (forecastDays.length >= 5) break;
      }
    }

    const data = {
      city: currentJson.name,
      current: {
        temp:       Math.round(currentJson.main.temp),
        feels_like: Math.round(currentJson.main.feels_like),
        humidity:   currentJson.main.humidity,
        icon:       currentJson.weather[0]?.icon,
        desc:       currentJson.weather[0]?.description,
        wind_speed: Math.round((currentJson.wind?.speed ?? 0) * 3.6), // m/s → km/h
      },
      forecast: forecastDays,
    };

    cache = { data, ts: Date.now() };
    res.json({ data });
  } catch (err) {
    console.warn('[Weather] Fehler:', err.message);
    res.json({ data: null }); // Fallback: Widget ausblenden, kein Error-Screen
  }
});

module.exports = router;
