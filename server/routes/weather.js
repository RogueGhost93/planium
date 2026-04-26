import { createLogger } from '../logger.js';
import express from 'express';
import * as db from '../db.js';

const log = createLogger('Weather');
const router = express.Router();

const cache = new Map(); // key: "city:units:lang" → { data, ts }
const CACHE_TTL_MS = 30 * 60 * 1000;
let envSeeded = false;

// One-time migration: seed app_settings from .env if not yet configured
function seedFromEnv() {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const city   = process.env.OPENWEATHER_CITY;
  if (!apiKey || !city) return;
  const existing = db.get().prepare(
    "SELECT value FROM app_settings WHERE key = 'weather_api_key'"
  ).get();
  if (existing) return;
  const upsert = db.get().prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  db.get().transaction(() => {
    upsert.run('weather_api_key', apiKey);
    upsert.run('weather_city',    city);
    upsert.run('weather_units',   process.env.OPENWEATHER_UNITS || 'metric');
    upsert.run('weather_lang',    process.env.OPENWEATHER_LANG  || 'en');
  })();
  log.info('Migrated weather config from .env to app_settings');
}

function getGlobalConfig() {
  if (!envSeeded) { envSeeded = true; seedFromEnv(); }
  const rows = db.get().prepare(
    'SELECT key, value FROM app_settings WHERE key IN (?, ?, ?, ?)'
  ).all('weather_api_key', 'weather_city', 'weather_units', 'weather_lang');
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    apiKey: map.weather_api_key || null,
    city:   map.weather_city   || null,
    units:  map.weather_units  || 'metric',
    lang:   map.weather_lang   || 'en',
  };
}

function getUserOverride(userId) {
  if (!userId) return { useGlobal: true, city: null, units: null, lang: null };
  const rows = db.get().prepare(
    'SELECT key, value FROM user_settings WHERE user_id = ? AND key IN (?, ?, ?, ?)'
  ).all(userId, 'weather_use_global', 'weather_city', 'weather_units', 'weather_lang');
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    useGlobal: map.weather_use_global !== '0',
    city:      map.weather_city  || null,
    units:     map.weather_units || null,
    lang:      map.weather_lang  || null,
  };
}

function resolveConfig(userId) {
  const global   = getGlobalConfig();
  const override = getUserOverride(userId);
  if (override.useGlobal) return { ...global };
  return {
    apiKey: global.apiKey,
    city:   override.city  ?? global.city,
    units:  override.units ?? global.units,
    lang:   override.lang  ?? global.lang,
  };
}

// --------------------------------------------------------
// GET /api/v1/weather
// --------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { apiKey, city, units, lang } = resolveConfig(req.session?.userId);

    if (!apiKey || !city) return res.json({ data: null });

    const cacheKey = `${city}:${units}:${lang}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return res.json({ data: cached.data });
    }

    const { default: fetch } = await import('node-fetch');

    const currentUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=${units}&lang=${lang}`;
    const currentRes = await fetch(currentUrl, { signal: AbortSignal.timeout(8000) });
    if (!currentRes.ok) {
      log.warn(`API error: ${currentRes.status}`);
      return res.json({ data: null });
    }
    const currentJson = await currentRes.json();

    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${apiKey}&units=${units}&lang=${lang}&cnt=40`;
    const forecastRes = await fetch(forecastUrl, { signal: AbortSignal.timeout(8000) });
    let forecastDays = [];
    if (forecastRes.ok) {
      const forecastJson = await forecastRes.json();
      const buckets = new Map();
      for (const item of forecastJson.list ?? []) {
        const dateStr = item.dt_txt.slice(0, 10);
        const hour    = parseInt(item.dt_txt.slice(11, 13), 10);
        let bucket = buckets.get(dateStr);
        if (!bucket) {
          bucket = { date: dateStr, min: Infinity, max: -Infinity, noon: null, noonDist: Infinity };
          buckets.set(dateStr, bucket);
        }
        bucket.min = Math.min(bucket.min, item.main.temp_min);
        bucket.max = Math.max(bucket.max, item.main.temp_max);
        const dist = Math.abs(hour - 12);
        if (dist < bucket.noonDist) { bucket.noon = item; bucket.noonDist = dist; }
      }
      for (const bucket of buckets.values()) {
        forecastDays.push({
          date:     bucket.date,
          temp_min: Math.round(bucket.min),
          temp_max: Math.round(bucket.max),
          icon:     bucket.noon.weather[0]?.icon,
          desc:     bucket.noon.weather[0]?.description,
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
        wind_speed: Math.round((currentJson.wind?.speed ?? 0) * 3.6),
      },
      forecast: forecastDays,
    };

    cache.set(cacheKey, { data, ts: Date.now() });
    res.json({ data });
  } catch (err) {
    log.warn('Error:', err.message);
    res.json({ data: null });
  }
});

// --------------------------------------------------------
// GET /api/v1/weather/status
// --------------------------------------------------------
router.get('/status', (req, res) => {
  const { apiKey, city } = getGlobalConfig();
  res.json({ configured: !!(apiKey && city), city });
});

// --------------------------------------------------------
// POST /api/v1/weather/config  (Admin only)
// Body: { api_key, city, units?, lang? }
// --------------------------------------------------------
router.post('/config', (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required', code: 403 });
  }
  const { api_key, city, units, lang } = req.body ?? {};
  if (!api_key?.trim()) return res.status(400).json({ error: 'api_key is required', code: 400 });
  if (!city?.trim())    return res.status(400).json({ error: 'city is required', code: 400 });

  try {
    const upsert = db.get().prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    db.get().transaction(() => {
      upsert.run('weather_api_key', api_key.trim());
      upsert.run('weather_city',    city.trim());
      upsert.run('weather_units',   units?.trim() || 'metric');
      upsert.run('weather_lang',    lang?.trim()  || 'en');
    })();
    cache.clear();
    res.json({ ok: true });
  } catch (err) {
    log.error('config POST', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/weather/config  (Admin only)
// --------------------------------------------------------
router.delete('/config', (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required', code: 403 });
  }
  try {
    db.get().prepare(
      "DELETE FROM app_settings WHERE key IN ('weather_api_key', 'weather_city', 'weather_units', 'weather_lang')"
    ).run();
    cache.clear();
    res.json({ ok: true });
  } catch (err) {
    log.error('config DELETE', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/weather/my-config
// --------------------------------------------------------
router.get('/my-config', (req, res) => {
  try {
    const override = getUserOverride(req.session?.userId);
    const global   = getGlobalConfig();
    res.json({
      useGlobal:        override.useGlobal,
      city:             override.city,
      units:            override.units,
      lang:             override.lang,
      globalConfigured: !!(global.apiKey && global.city),
      globalUrl:        global.city, // used by renderPersonalOverride as the label
    });
  } catch (err) {
    log.error('my-config GET', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// PUT /api/v1/weather/my-config
// Body: { useGlobal, city?, units?, lang? }
// --------------------------------------------------------
router.put('/my-config', (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in', code: 401 });

  const { useGlobal, city, units, lang } = req.body ?? {};

  try {
    const upsert = db.get().prepare(`
      INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
    `);
    db.get().transaction(() => {
      upsert.run(userId, 'weather_use_global', useGlobal === false ? '0' : '1');
      if (city  != null && String(city).trim())  upsert.run(userId, 'weather_city',  String(city).trim());
      if (units != null && String(units).trim()) upsert.run(userId, 'weather_units', String(units).trim());
      if (lang  != null && String(lang).trim())  upsert.run(userId, 'weather_lang',  String(lang).trim());
    })();
    res.json({ ok: true });
  } catch (err) {
    log.error('my-config PUT', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// DELETE /api/v1/weather/my-config
// --------------------------------------------------------
router.delete('/my-config', (req, res) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not logged in', code: 401 });
  try {
    db.get().prepare(
      "DELETE FROM user_settings WHERE user_id = ? AND key IN ('weather_use_global', 'weather_city', 'weather_units', 'weather_lang')"
    ).run(userId);
    res.json({ ok: true });
  } catch (err) {
    log.error('my-config DELETE', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// --------------------------------------------------------
// GET /api/v1/weather/icon/:code
// Proxy for OpenWeatherMap icons
// --------------------------------------------------------
router.get('/icon/:code', async (req, res) => {
  const { code } = req.params;
  if (!/^[a-zA-Z0-9]{2,4}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid icon code.', code: 400 });
  }

  try {
    const { default: fetch } = await import('node-fetch');
    const url = `https://openweathermap.org/img/wn/${code}@2x.png`;
    const upstream = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!upstream.ok) {
      return res.status(502).json({ error: 'Icon not available.', code: 502 });
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    upstream.body.pipe(res);
  } catch (err) {
    log.warn('Icon proxy error:', err.message);
    res.status(502).json({ error: 'Icon proxy failed.', code: 502 });
  }
});

export default router;
