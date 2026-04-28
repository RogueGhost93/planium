import express from 'express';
import { createLogger } from '../logger.js';
import { getWebviewConfig, replaceWebviewItems, setWebviewItems } from '../services/webview.js';

const router = express.Router();
const log = createLogger('Webview');

router.get('/config', (req, res) => {
  res.json(getWebviewConfig());
});

router.put('/config', (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required', code: 403 });
  }

  try {
    const items = Array.isArray(req.body?.items)
      ? replaceWebviewItems(req.body.items)
      : setWebviewItems(req.body?.url ?? '');
    res.json({ ok: true, ...getWebviewConfig(), items });
  } catch (err) {
    log.error('config PUT', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

router.delete('/config', (req, res) => {
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required', code: 403 });
  }

  try {
    setWebviewItems([]);
    res.json({ ok: true, configured: false, items: [], origins: [] });
  } catch (err) {
    log.error('config DELETE', err);
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

export default router;
