/**
 * Module: Price Tickers
 * Purpose: Render one or more live price tickers (e.g. BTC) inside the greeting widget.
 *          Few tickers sit side-by-side; many rotate one at a time.
 * Dependencies: /utils/html.js
 *
 * To add a ticker, append an entry to the TICKERS array below.
 */

import { esc } from '/utils/html.js';

const TICKERS = [
  { id: 'bitcoin', label: 'BTC', coingeckoId: 'bitcoin', defaultHref: 'https://bitbo.io/' },
];

const MAX_SIDE_BY_SIDE = 3;
const REFRESH_INTERVAL = 10 * 60 * 1000;
const ROTATE_INTERVAL  = 5 * 1000;

export function renderPriceTickers() {
  if (TICKERS.length === 0) return '';
  const mode = TICKERS.length <= MAX_SIDE_BY_SIDE ? 'static' : 'rotate';
  const items = TICKERS.map((ticker) => {
    const href = localStorage.getItem('planner-ticker-btc-href') || ticker.defaultHref;
    const inner = `<span class="price-ticker__label">${esc(ticker.label)}</span><span class="price-ticker__value">…</span><span class="price-ticker__change"></span>`;
    return href
      ? `<a class="price-ticker" data-ticker-id="${esc(ticker.id)}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
      : `<span class="price-ticker" data-ticker-id="${esc(ticker.id)}">${inner}</span>`;
  }).join('');
  return `
    <div class="widget-greeting__tickers" data-mode="${mode}" aria-live="polite">
      ${items}
    </div>
  `;
}

function formatPrice(n) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

async function fetchPrices() {
  const ids = TICKERS.map((t) => t.coingeckoId).join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('coingecko: ' + res.status);
  return res.json();
}

async function fetchWithRetry(attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchPrices();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
}

function applyPrices(container, data) {
  TICKERS.forEach((ticker) => {
    const el = container.querySelector(`.price-ticker[data-ticker-id="${CSS.escape(ticker.id)}"]`);
    if (!el) return;
    const valueEl  = el.querySelector('.price-ticker__value');
    const changeEl = el.querySelector('.price-ticker__change');
    const info = data?.[ticker.coingeckoId];
    if (!info || typeof info.usd !== 'number') {
      valueEl.textContent  = '—';
      changeEl.textContent = '';
      changeEl.className   = 'price-ticker__change';
      return;
    }
    valueEl.textContent = formatPrice(info.usd);
    const change = info.usd_24h_change;
    if (typeof change === 'number') {
      const sign = change >= 0 ? '+' : '';
      changeEl.textContent = sign + change.toFixed(1) + '%';
      changeEl.className = 'price-ticker__change '
        + (change >= 0 ? 'price-ticker__change--up' : 'price-ticker__change--down');
    } else {
      changeEl.textContent = '';
      changeEl.className   = 'price-ticker__change';
    }
  });
}

export function wirePriceTickers(container, signal) {
  const tickerContainer = container.querySelector('.widget-greeting__tickers');
  if (!tickerContainer || TICKERS.length === 0) return;

  async function update() {
    try {
      const data = await fetchWithRetry(3);
      if (signal?.aborted) return;
      applyPrices(tickerContainer, data);
    } catch (err) {
      console.warn('[PriceTickers] fetch failed:', err.message);
      if (!signal?.aborted) applyPrices(tickerContainer, {});
    }
  }

  update();
  const refreshTimer = setInterval(update, REFRESH_INTERVAL);
  signal?.addEventListener('abort', () => clearInterval(refreshTimer));

  if (tickerContainer.dataset.mode === 'rotate') {
    const items = Array.from(tickerContainer.querySelectorAll('.price-ticker'));
    if (items.length > 1) {
      items.forEach((el, i) => el.classList.toggle('price-ticker--hidden', i !== 0));
      let idx = 0;
      const rotateTimer = setInterval(() => {
        items[idx].classList.add('price-ticker--hidden');
        idx = (idx + 1) % items.length;
        items[idx].classList.remove('price-ticker--hidden');
      }, ROTATE_INTERVAL);
      signal?.addEventListener('abort', () => clearInterval(rotateTimer));
    }
  }
}
