/**
 * Modul: Einstellungen (Settings)
 * Zweck: Benutzerkonto, Passwort, Kalender-Sync, Familienmitglieder
 * Abhängigkeiten: /api.js
 */

import { api, auth } from '/api.js';
import { t, formatDate, formatTime } from '/i18n.js';
import { esc } from '/utils/html.js';
import { showConfirm } from '/components/modal.js';
import { previewTone } from '/components/task-notifications.js';

// Registry of API-backed integrations. Each entry drives the per-user
// override UI and wiring — add a new service by appending here and the
// corresponding /{endpoint}/my-config routes on the backend.
const INTEGRATIONS = [
  {
    id: 'mealie',
    label: 'Mealie',
    endpoint: '/mealie',
    fields: [
      { key: 'url',   label: 'URL',       type: 'url',      placeholder: 'https://mealie.example.com' },
      { key: 'token', label: 'API token', type: 'password', placeholder: 'Your Mealie API token', autocomplete: 'off', hint: 'Generate a token in your Mealie account settings' },
    ],
  },
  {
    id: 'freshrss',
    label: 'FreshRSS',
    endpoint: '/freshrss',
    fields: [
      { key: 'url',      label: 'URL',      type: 'url',      placeholder: 'https://freshrss.example.com' },
      { key: 'username', label: 'Username', type: 'text',     autocomplete: 'username' },
      { key: 'password', label: 'Password', type: 'password', autocomplete: 'current-password', hint: 'Uses your FreshRSS login credentials via the Google Reader API' },
    ],
  },
  {
    id: 'linkding',
    label: 'Linkding',
    endpoint: '/linkding',
    fields: [
      { key: 'url',   label: 'URL',       type: 'url',      placeholder: 'https://linkding.example.com' },
      { key: 'token', label: 'API token', type: 'password', placeholder: 'Your Linkding API token', autocomplete: 'off', hint: 'Generate a token in your Linkding account settings' },
    ],
  },
  {
    id: 'weather',
    label: 'Weather',
    endpoint: '/weather',
    fields: [
      { key: 'city',  label: 'City',     type: 'text', placeholder: 'e.g. Berlin' },
      { key: 'units', label: 'Units',    type: 'text', placeholder: 'metric / imperial / standard' },
      { key: 'lang',  label: 'Language', type: 'text', placeholder: 'en, de, hr, …' },
    ],
  },
];

/**
 * @param {HTMLElement} container
 * @param {{ user: object }} context
 */
export async function render(container, { user }) {
  // URL-Parameter auswerten (z.B. nach OAuth-Callback)
  const params   = new URLSearchParams(location.search);
  const syncOk   = params.get('sync_ok');
  const syncErr  = params.get('sync_error');

  // State für Familienmitglieder + Sync-Status
  let users        = [];
  let googleStatus = { configured: false, connected: false, lastSync: null };
  let appleStatus  = { configured: false, lastSync: null };
  let mealieStatus   = { configured: false, url: null };
  let freshrssStatus = { configured: false };
  let linkdingStatus = { configured: false, url: null };
  let weatherStatus  = { configured: false };
  let fileboxStatus  = { enabled: false };
  let taskLists      = [];
  const myConfigs    = {};

  try {
    const [usersRes, gStatus, aStatus, mStatus, fStatus, lStatus, wStatus, fbStatus, tlRes, ...myCfgRes] = await Promise.allSettled([
      user.role === 'admin' ? auth.getUsers() : Promise.resolve({ data: [] }),
      api.get('/calendar/google/status'),
      api.get('/calendar/apple/status'),
      api.get('/mealie/status'),
      api.get('/freshrss/status'),
      api.get('/linkding/status'),
      api.get('/weather/status'),
      api.get('/filebox/status'),
      api.get('/task-lists'),
      ...INTEGRATIONS.map(i => api.get(`${i.endpoint}/my-config`)),
    ]);
    if (usersRes.status === 'fulfilled')  users          = usersRes.value.data ?? [];
    if (gStatus.status  === 'fulfilled')  googleStatus   = gStatus.value;
    if (aStatus.status  === 'fulfilled')  appleStatus    = aStatus.value;
    if (mStatus.status  === 'fulfilled')  mealieStatus   = mStatus.value;
    if (fStatus.status  === 'fulfilled')  freshrssStatus = fStatus.value;
    if (lStatus.status  === 'fulfilled')  linkdingStatus = lStatus.value;
    if (wStatus.status  === 'fulfilled')  weatherStatus  = wStatus.value;
    if (fbStatus.status === 'fulfilled')  fileboxStatus  = fbStatus.value;
    if (tlRes.status    === 'fulfilled')  taskLists      = tlRes.value.data ?? [];
    INTEGRATIONS.forEach((i, idx) => {
      if (myCfgRes[idx]?.status === 'fulfilled') myConfigs[i.id] = myCfgRes[idx].value;
    });
  } catch (_) { /* non-critical */ }

  const googleStatusText = googleStatus.connected
    ? (googleStatus.lastSync ? t('settings.connectedLastSync', { date: formatDateTime(googleStatus.lastSync) }) : t('settings.connected'))
    : googleStatus.configured ? t('settings.notConnected') : t('settings.notConfigured');

  const appleStatusText = appleStatus.connected
    ? (appleStatus.lastSync ? t('settings.connectedLastSync', { date: formatDateTime(appleStatus.lastSync) }) : t('settings.connected'))
    : appleStatus.configured
      ? (appleStatus.lastSync ? t('settings.configuredLastSync', { date: formatDateTime(appleStatus.lastSync) }) : t('settings.configured'))
      : t('settings.notConnected');

  container.innerHTML = `
    <div class="page settings-page">
      <div class="page__header">
        <h1 class="page__title">${t('settings.title')}</h1>
      </div>

      ${syncOk  ? `<div class="settings-banner settings-banner--success">${syncOk === 'google' ? t('settings.syncSuccessGoogle') : t('settings.syncSuccessApple')}</div>` : ''}
      ${syncErr ? `<div class="settings-banner settings-banner--error">${syncErr === 'google' ? t('settings.syncErrorGoogle') : t('settings.syncErrorApple')}</div>` : ''}

      <!-- Design -->
      <details class="settings-section" open>
        <summary class="settings-section__title">${t('settings.sectionDesign')}</summary>
        <div class="settings-card">
          <h3 class="settings-card__title">${t('settings.cardAppearance')}</h3>
          <p class="settings-card__label" style="margin-bottom:var(--space-2)">${t('settings.themeLabel')}</p>
          <select id="theme-select" class="form-input" style="width:100%">
            <option value="light" ${currentTheme() === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${currentTheme() === 'dark' ? 'selected' : ''}>Warm Dark</option>
            <option value="obsidian" ${currentTheme() === 'obsidian' ? 'selected' : ''}>Obsidian</option>
            <option value="midnight-forest" ${currentTheme() === 'midnight-forest' ? 'selected' : ''}>Midnight Forest</option>
            <option value="noir" ${currentTheme() === 'noir' ? 'selected' : ''}>Noir</option>
            <option value="opnsense" ${currentTheme() === 'opnsense' ? 'selected' : ''}>OPNsense</option>
            <option value="deep-ocean" ${currentTheme() === 'deep-ocean' ? 'selected' : ''}>Deep Ocean</option>
            <option value="aubergine" ${currentTheme() === 'aubergine' ? 'selected' : ''}>Aubergine</option>
            <option value="parchment" ${currentTheme() === 'parchment' ? 'selected' : ''}>Parchment</option>
          </select>
          <p class="settings-card__label" style="margin-top:var(--space-4);margin-bottom:var(--space-2)">Accent color</p>
          <div class="accent-picker" id="accent-picker">
            ${ACCENT_COLORS.map((c) => `
              <button class="accent-swatch ${currentAccent() === c.id ? 'accent-swatch--active' : ''}"
                      data-accent="${c.id}" aria-label="${c.label}" title="${c.label}"
                      style="background-color:${c.light}">
              </button>`).join('')}
          </div>
          <div class="settings-toggle-row" style="margin-top:var(--space-3)">
            <label class="settings-toggle-label" for="daily-accent">Rotate accent color daily <span class="form-hint" style="display:inline;margin:0">(this device only)</span></label>
            <label class="toggle-switch">
              <input type="checkbox" id="daily-accent" ${localStorage.getItem('planium-daily-accent') === 'true' ? 'checked' : ''} />
              <span class="toggle-switch__slider"></span>
            </label>
          </div>

          <p class="settings-card__label" style="margin-top:var(--space-4);margin-bottom:var(--space-2)">${t('settings.priorityAppearanceLabel')} <span class="form-hint" style="display:inline;margin:0">(this device only)</span></p>
          <select id="priority-appearance" class="form-input" style="width:100%">
            <option value="accent" ${currentPriorityAppearance() === 'accent' ? 'selected' : ''}>${t('settings.priorityAppearanceAccent')}</option>
            <option value="flags" ${currentPriorityAppearance() === 'flags' ? 'selected' : ''}>${t('settings.priorityAppearanceFlags')}</option>
            <option value="both" ${currentPriorityAppearance() === 'both' ? 'selected' : ''}>${t('settings.priorityAppearanceBoth')}</option>
          </select>
          <span class="form-hint">${t('settings.priorityAppearanceHelp')}</span>

          <p class="settings-card__label" style="margin-top:var(--space-4);margin-bottom:var(--space-2)">Quick link <span class="form-hint" style="display:inline;margin:0">(this device only)</span></p>
          <div class="settings-quick-link" style="display:flex;gap:var(--space-2)">
            <input class="form-input" type="url" id="quick-link-input"
                   placeholder="https://example.com"
                   value="${esc(user?.quick_link || '')}" />
            <button class="btn btn--primary" id="quick-link-save">Save</button>
          </div>
          <span class="form-hint">Tap the greeting bar on the dashboard to open this link</span>

          <div class="settings-toggle-row" style="margin-top:var(--space-4)">
            <label class="settings-toggle-label" for="show-quotes">${t('settings.showQuotesLabel')} <span class="form-hint" style="display:inline;margin:0">(this device only)</span></label>
            <label class="toggle-switch">
              <input type="checkbox" id="show-quotes" ${localStorage.getItem('planium-show-quotes') !== 'false' ? 'checked' : ''} />
              <span class="toggle-switch__slider"></span>
            </label>
          </div>

          <div class="settings-toggle-row">
            <label class="settings-toggle-label" for="show-tickers">Show price tickers in greeting bar <span class="form-hint" style="display:inline;margin:0">(this device only)</span></label>
            <label class="toggle-switch">
              <input type="checkbox" id="show-tickers" ${localStorage.getItem('planium-show-tickers') !== 'false' ? 'checked' : ''} />
              <span class="toggle-switch__slider"></span>
            </label>
          </div>
          <p class="settings-card__label" style="margin-top:var(--space-4);margin-bottom:var(--space-2)">BTC ticker link <span class="form-hint" style="display:inline;margin:0">(this device only)</span></p>
          <div class="settings-quick-link" style="display:flex;gap:var(--space-2)">
            <input class="form-input" type="url" id="ticker-link-input"
                   placeholder="https://bitbo.io/"
                   value="${esc(localStorage.getItem('planium-ticker-btc-href') || '')}" />
            <button class="btn btn--primary" id="ticker-link-save">Save</button>
          </div>
          <span class="form-hint">Leave empty to use the default (bitbo.io)</span>

          <p class="settings-card__label" style="margin-top:var(--space-4);margin-bottom:var(--space-2)">Background image <span class="form-hint" style="display:inline;margin:0">(this device only)</span></p>
          <div id="bg-upload-row" style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-2)">
            <img id="bg-preview-img" src="${esc(localStorage.getItem('planium-bg') || '')}"
                 style="width:80px;height:50px;object-fit:cover;border-radius:var(--radius-sm);border:1px solid var(--color-border);${localStorage.getItem('planium-bg') ? '' : 'display:none'}"
                 alt="Background preview" />
            <div style="display:flex;gap:var(--space-2)">
              <label class="btn btn--secondary" style="cursor:pointer" aria-label="Upload background photo">
                Upload photo
                <input type="file" id="bg-upload" accept="image/*" style="display:none">
              </label>
              <button class="btn btn--danger-outline" id="bg-remove" ${localStorage.getItem('planium-bg') ? '' : 'hidden'}>Remove</button>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-3)">
            <label class="settings-card__label" for="bg-dim" style="white-space:nowrap;margin:0">Dim</label>
            <input type="range" id="bg-dim" min="0" max="0.6" step="0.05"
                   value="${localStorage.getItem('planium-bg-dim') ?? '0.2'}"
                   style="flex:1">
            <span id="bg-dim-val" style="font-size:var(--text-sm);color:var(--color-text-secondary);min-width:2.5em;text-align:right">${Math.round(parseFloat(localStorage.getItem('planium-bg-dim') ?? '0.2') * 100)}%</span>
          </div>

        </div>
      </details>

      <!-- Notifications -->
      <details class="settings-section">
        <summary class="settings-section__title">${t('settings.sectionNotifications')}</summary>
        <div class="settings-card">
          <h3 class="settings-card__title">${t('settings.notificationsCardTitle')}</h3>

          <div class="settings-toggle-row">
            <label class="settings-toggle-label" for="notify-popup">${t('settings.notifyPopupLabel')}</label>
            <label class="toggle-switch">
              <input type="checkbox" id="notify-popup" ${user?.notify_popup ? 'checked' : ''} />
              <span class="toggle-switch__slider"></span>
            </label>
          </div>

          <div class="settings-toggle-row">
            <label class="settings-toggle-label" for="notify-sound">${t('settings.notifySoundLabel')}</label>
            <label class="toggle-switch">
              <input type="checkbox" id="notify-sound" ${user?.notify_sound ? 'checked' : ''} />
              <span class="toggle-switch__slider"></span>
            </label>
          </div>

          <div class="form-group" style="margin-top:var(--space-3)">
            <label class="form-label" for="notify-time">${t('settings.notifyTimeLabel')}</label>
            <input class="form-input" type="time" id="notify-time" value="${esc(user?.notify_time || '09:00')}" style="max-width:140px" />
          </div>

          <div class="form-group" style="margin-top:var(--space-3)">
            <label class="form-label" for="notify-interval">${t('settings.notifyIntervalLabel')}</label>
            <select class="form-input" id="notify-interval" style="max-width:180px">
              ${[1,2,3,4,6,8,12].map(h => `<option value="${h}" ${(user?.notify_interval || 4) === h ? 'selected' : ''}>${h} ${h === 1 ? t('settings.notifyIntervalHour') : t('settings.notifyIntervalHours')}</option>`).join('')}
            </select>
            <span class="form-hint">${t('settings.notifyIntervalHint')}</span>
          </div>

          <div class="form-group" style="margin-top:var(--space-3)">
            <label class="form-label" for="notify-tone">${t('settings.notifyToneLabel')}</label>
            <div style="display:flex;gap:var(--space-2);align-items:center">
              <select class="form-input" id="notify-tone" style="max-width:180px">
                <option value="short"   ${(user?.notify_tone || 'default') === 'short'   ? 'selected' : ''}>${t('settings.notifyToneShort')}</option>
                <option value="default" ${(user?.notify_tone || 'default') === 'default' ? 'selected' : ''}>${t('settings.notifyToneDefault')}</option>
                <option value="long"    ${(user?.notify_tone || 'default') === 'long'    ? 'selected' : ''}>${t('settings.notifyToneLong')}</option>
                <option value="gentle"  ${(user?.notify_tone || 'default') === 'gentle'  ? 'selected' : ''}>${t('settings.notifyToneGentle')}</option>
                <option value="alert"   ${(user?.notify_tone || 'default') === 'alert'   ? 'selected' : ''}>${t('settings.notifyToneAlert')}</option>
              </select>
              <button class="btn btn--secondary btn--icon" id="notify-tone-preview" type="button" title="${t('settings.notifyTonePreview')}" aria-label="${t('settings.notifyTonePreview')}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </button>
            </div>
          </div>
        </div>
      </details>

      <!-- Mein Konto -->
      <details class="settings-section">
        <summary class="settings-section__title">${t('settings.sectionAccount')}</summary>

        <div class="settings-card">
          <div class="settings-user-info">
            <div class="settings-avatar" style="background:${esc(user?.avatar_color) || '#007AFF'}">
              ${esc(initials(user?.display_name))}
            </div>
            <div>
              <div class="settings-user-info__name">${esc(user?.display_name)}</div>
              <div class="settings-user-info__username">@${esc(user?.username)}</div>
            </div>
          </div>
        </div>

        <div class="settings-card">
          <h3 class="settings-card__title">${t('settings.changePassword')}</h3>
          <form id="password-form" class="settings-form">
            <div class="form-group">
              <label class="form-label" for="current-password">${t('settings.currentPasswordLabel')}</label>
              <input class="form-input" type="password" id="current-password" autocomplete="current-password" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-password">${t('settings.newPasswordLabel')}</label>
              <input class="form-input" type="password" id="new-password" autocomplete="new-password" minlength="8" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="confirm-password">${t('settings.confirmPasswordLabel')}</label>
              <input class="form-input" type="password" id="confirm-password" autocomplete="new-password" minlength="8" required />
            </div>
            <div id="password-error" class="form-error" hidden></div>
            <button type="submit" class="btn btn--primary">${t('settings.savePassword')}</button>
          </form>
        </div>
      </details>

      <!-- Filebox (per-user opt-in) -->
      <details class="settings-section">
        <summary class="settings-section__title">Filebox</summary>
        <div class="settings-card">
          <h3 class="settings-card__title">File sharing</h3>
          <p class="settings-card__label" style="margin-bottom:var(--space-3)">
            Adds a page for uploading, downloading and sharing files. A shared
            global folder is visible to everyone; your private folder is only
            visible to you. Leave this off if you don't need it.
          </p>
          <div class="settings-toggle-row">
            <label class="settings-toggle-label" for="filebox-enabled">Enable Filebox for my account</label>
            <label class="toggle-switch">
              <input type="checkbox" id="filebox-enabled" ${fileboxStatus?.enabled ? 'checked' : ''} />
              <span class="toggle-switch__slider"></span>
            </label>
          </div>
        </div>
      </details>

      <!-- Kalender-Synchronisation -->
      <details class="settings-section">
        <summary class="settings-section__title">${t('settings.sectionCalendarSync')}</summary>

        <!-- Google Calendar -->
        <div class="settings-card">
          <div class="settings-sync-header">
            <div class="settings-sync-logo settings-sync-logo--google">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            </div>
            <div class="settings-sync-info">
              <div class="settings-sync-info__name">${t('settings.googleCalendar')}</div>
              <div class="settings-sync-info__status ${googleStatus.connected ? 'settings-sync-info__status--connected' : ''}">
                ${googleStatusText}
              </div>
            </div>
          </div>
          ${googleStatus.configured ? `
            <div class="settings-sync-actions">
              ${googleStatus.connected ? `
                <button class="btn btn--secondary" id="google-sync-btn">${t('settings.syncNow')}</button>
                ${user?.role === 'admin' ? `<button class="btn btn--danger-outline" id="google-disconnect-btn">${t('settings.disconnect')}</button>` : ''}
              ` : `
                ${user?.role === 'admin' ? `<a href="/api/v1/calendar/google/auth" class="btn btn--primary">${t('settings.connectGoogle')}</a>` : `<span class="form-hint">${t('settings.googleOnlyAdmin')}</span>`}
              `}
            </div>
          ` : ''}
        </div>

        <!-- Apple Calendar -->
        <div class="settings-card">
          <div class="settings-sync-header">
            <div class="settings-sync-logo settings-sync-logo--apple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
              </svg>
            </div>
            <div class="settings-sync-info">
              <div class="settings-sync-info__name">${t('settings.appleCalendar')}</div>
              <div class="settings-sync-info__status ${appleStatus.configured ? 'settings-sync-info__status--connected' : ''}">
                ${appleStatusText}
              </div>
            </div>
          </div>
          ${appleStatus.configured ? `
            <div class="settings-sync-actions">
              <button class="btn btn--secondary" id="apple-sync-btn">${t('settings.syncNow')}</button>
              ${appleStatus.connected && user?.role === 'admin' ? `<button class="btn btn--danger-outline" id="apple-disconnect-btn">${t('settings.disconnect')}</button>` : ''}
            </div>
          ` : user?.role === 'admin' ? `
            <form id="apple-connect-form" class="settings-form settings-form--compact">
              <div class="form-group">
                <label class="form-label" for="apple-caldav-url">${t('settings.caldavUrlLabel')}</label>
                <input class="form-input" type="url" id="apple-caldav-url" placeholder="${t('settings.caldavUrlPlaceholder')}" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="apple-username">${t('settings.appleIdLabel')}</label>
                <input class="form-input" type="email" id="apple-username" autocomplete="username" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="apple-password">${t('settings.applePasswordLabel')}</label>
                <input class="form-input" type="password" id="apple-password" autocomplete="current-password" required />
                <span class="form-hint">${t('settings.applePasswordHint')}</span>
              </div>
              <div id="apple-connect-error" class="form-error" hidden></div>
              <button type="submit" class="btn btn--primary" id="apple-connect-btn">${t('settings.appleConnectBtn')}</button>
            </form>
          ` : `<span class="form-hint">${t('settings.appleOnlyAdmin')}</span>`}
        </div>
      </details>

      <!-- Mealie Integration -->
      <details class="settings-section">
        <summary class="settings-section__title">${t('settings.sectionMealie')}</summary>
        <div class="settings-card" id="mealie-card">
          <div class="settings-sync-header">
            <div class="settings-sync-logo settings-sync-logo--mealie">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 11h.01"/><path d="M11 15h.01"/><path d="M16 16h.01"/><path d="m2 16 20 6-6-20A20 20 0 0 0 2 16"/><path d="M5.71 17.11a17.04 17.04 0 0 1 11.4-11.4"/></svg>
            </div>
            <div class="settings-sync-info">
              <div class="settings-sync-info__name">Mealie</div>
              <div class="settings-sync-info__status ${mealieStatus?.configured ? 'settings-sync-info__status--connected' : ''}" id="mealie-status-text">
                ${mealieStatus?.configured ? t('settings.mealieConnected') : t('settings.mealieNotConnected')}
              </div>
            </div>
          </div>
          ${mealieStatus?.configured ? `
            <div style="margin-top:var(--space-4);display:flex;align-items:center;gap:var(--space-3)">
              <button class="btn btn--secondary" id="mealie-test-btn">Test connection</button>
              <span id="mealie-test-result" style="font-size:var(--text-sm)"></span>
            </div>
            ${user?.role === 'admin' ? `
            <div class="settings-sync-actions" style="margin-top:var(--space-3)">
              <button class="btn btn--danger-outline" id="mealie-disconnect-btn">${t('settings.mealieDisconnectBtn')}</button>
            </div>` : ''}
          ` : user?.role === 'admin' ? `
            <form id="mealie-connect-form" class="settings-form settings-form--compact">
              <div class="form-group">
                <label class="form-label" for="mealie-url">${t('settings.mealieUrlLabel')}</label>
                <input class="form-input" type="url" id="mealie-url" placeholder="${t('settings.mealieUrlPlaceholder')}" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="mealie-token">${t('settings.mealieTokenLabel')}</label>
                <input class="form-input" type="password" id="mealie-token" placeholder="${t('settings.mealieTokenPlaceholder')}" autocomplete="off" required />
                <span class="form-hint">${t('settings.mealieTokenHint')}</span>
              </div>
              <div id="mealie-connect-error" class="form-error" hidden></div>
              <button type="submit" class="btn btn--primary" id="mealie-connect-btn">${t('settings.mealieSaveBtn')}</button>
            </form>
          ` : ''}
          ${renderPersonalOverride(INTEGRATIONS[0], myConfigs.mealie)}
        </div>
      </details>

      <!-- FreshRSS Integration -->
      <details class="settings-section">
        <summary class="settings-section__title">FreshRSS</summary>
        <div class="settings-card" id="freshrss-card">
          <div class="settings-sync-header">
            <div class="settings-sync-logo settings-sync-logo--mealie">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
            </div>
            <div class="settings-sync-info">
              <div class="settings-sync-info__name">FreshRSS</div>
              <div class="settings-sync-info__status ${freshrssStatus?.configured ? 'settings-sync-info__status--connected' : ''}" id="freshrss-status-text">
                ${freshrssStatus?.configured ? 'Connected' : 'Not connected'}
              </div>
            </div>
          </div>
          ${freshrssStatus?.configured ? `
            <div class="settings-toggle-row" style="margin-top:var(--space-4)">
              <label class="settings-toggle-label" for="show-news">Show headlines in greeting bar <span class="form-hint" style="display:inline;margin:0">(this device only)</span></label>
              <label class="toggle-switch">
                <input type="checkbox" id="show-news" ${localStorage.getItem('planium-show-news') === 'true' ? 'checked' : ''} />
                <span class="toggle-switch__slider"></span>
              </label>
            </div>
            <div style="margin-top:var(--space-3);display:flex;align-items:center;gap:var(--space-3)">
              <button class="btn btn--secondary" id="freshrss-test-btn">Test connection</button>
              <span id="freshrss-test-result" style="font-size:var(--text-sm)"></span>
            </div>
            ${user?.role === 'admin' ? `
            <div class="settings-sync-actions" style="margin-top:var(--space-3)">
              <button class="btn btn--danger-outline" id="freshrss-disconnect-btn">Disconnect</button>
            </div>` : ''}
          ` : user?.role === 'admin' ? `
            <form id="freshrss-connect-form" class="settings-form settings-form--compact">
              <div class="form-group">
                <label class="form-label" for="freshrss-url">FreshRSS URL</label>
                <input class="form-input" type="url" id="freshrss-url" placeholder="https://freshrss.example.com" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="freshrss-username">Username</label>
                <input class="form-input" type="text" id="freshrss-username" autocomplete="username" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="freshrss-password">Password</label>
                <input class="form-input" type="password" id="freshrss-password" autocomplete="current-password" required />
                <span class="form-hint">Uses your FreshRSS login credentials via the Google Reader API</span>
              </div>
              <div id="freshrss-connect-error" class="form-error" hidden></div>
              <button type="submit" class="btn btn--primary" id="freshrss-connect-btn">Save</button>
            </form>
          ` : ''}
          ${renderPersonalOverride(INTEGRATIONS[1], myConfigs.freshrss)}
        </div>
      </details>

      <!-- Linkding Integration -->
      <details class="settings-section">
        <summary class="settings-section__title">Linkding</summary>
        <div class="settings-card" id="linkding-card">
          <div class="settings-sync-header">
            <div class="settings-sync-logo settings-sync-logo--mealie">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            </div>
            <div class="settings-sync-info">
              <div class="settings-sync-info__name">Linkding</div>
              <div class="settings-sync-info__status ${linkdingStatus?.configured ? 'settings-sync-info__status--connected' : ''}" id="linkding-status-text">
                ${linkdingStatus?.configured ? 'Connected' : 'Not connected'}
              </div>
            </div>
          </div>
          ${linkdingStatus?.configured ? `
            <div style="margin-top:var(--space-4);display:flex;align-items:center;gap:var(--space-3)">
              <button class="btn btn--secondary" id="linkding-test-btn">Test connection</button>
              <span id="linkding-test-result" style="font-size:var(--text-sm)"></span>
            </div>
            ${user?.role === 'admin' ? `
            <div class="settings-sync-actions" style="margin-top:var(--space-3)">
              <button class="btn btn--danger-outline" id="linkding-disconnect-btn">Disconnect</button>
            </div>` : ''}
          ` : user?.role === 'admin' ? `
            <form id="linkding-connect-form" class="settings-form settings-form--compact">
              <div class="form-group">
                <label class="form-label" for="linkding-url">Linkding URL</label>
                <input class="form-input" type="url" id="linkding-url" placeholder="https://linkding.example.com" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="linkding-token">API Token</label>
                <input class="form-input" type="password" id="linkding-token" placeholder="Your Linkding API token" autocomplete="off" required />
                <span class="form-hint">Generate a token in your Linkding account settings</span>
              </div>
              <div id="linkding-connect-error" class="form-error" hidden></div>
              <button type="submit" class="btn btn--primary" id="linkding-connect-btn">Save</button>
            </form>
          ` : ''}
          ${renderPersonalOverride(INTEGRATIONS[2], myConfigs.linkding)}
        </div>
      </details>

      <!-- Weather Integration -->
      <details class="settings-section">
        <summary class="settings-section__title">Weather</summary>
        <div class="settings-card" id="weather-card">
          <div class="settings-sync-header">
            <div class="settings-sync-logo settings-sync-logo--mealie">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
            </div>
            <div class="settings-sync-info">
              <div class="settings-sync-info__name">Weather</div>
              <div class="settings-sync-info__status ${weatherStatus?.configured ? 'settings-sync-info__status--connected' : ''}" id="weather-status-text">
                ${weatherStatus?.configured ? `Connected — ${esc(weatherStatus.city ?? '')}` : 'Not connected'}
              </div>
            </div>
          </div>
          ${weatherStatus?.configured ? `
            ${user?.role === 'admin' ? `
            <div class="settings-sync-actions" style="margin-top:var(--space-4)">
              <button class="btn btn--danger-outline" id="weather-disconnect-btn">Disconnect</button>
            </div>` : ''}
          ` : user?.role === 'admin' ? `
            <form id="weather-connect-form" class="settings-form settings-form--compact">
              <div class="form-group">
                <label class="form-label" for="weather-api-key">OpenWeatherMap API key</label>
                <input class="form-input" type="password" id="weather-api-key" autocomplete="off" required />
                <span class="form-hint">Get a free key at openweathermap.org</span>
              </div>
              <div class="form-group">
                <label class="form-label" for="weather-city">Default city</label>
                <input class="form-input" type="text" id="weather-city" placeholder="e.g. Berlin" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="weather-units">Units</label>
                <input class="form-input" type="text" id="weather-units" placeholder="metric / imperial / standard" value="metric" />
              </div>
              <div class="form-group">
                <label class="form-label" for="weather-lang">Language</label>
                <input class="form-input" type="text" id="weather-lang" placeholder="en, de, hr, …" value="en" />
              </div>
              <div id="weather-connect-error" class="form-error" hidden></div>
              <button type="submit" class="btn btn--primary" id="weather-connect-btn">Save</button>
            </form>
          ` : ''}
          ${renderPersonalOverride(INTEGRATIONS[3], myConfigs.weather)}
        </div>
      </details>

      <!-- Familienmitglieder (nur Admin) -->
      ${user?.role === 'admin' ? `
      <details class="settings-section">
        <summary class="settings-section__title">${t('settings.sectionFamily')}</summary>
        <div class="settings-card" id="members-card">
          <ul class="settings-members" id="members-list">
            ${users.map(memberHtml).join('')}
          </ul>
          <button class="btn btn--primary settings-add-btn" id="add-member-btn">${t('settings.addMember')}</button>
        </div>

        <div class="settings-card settings-card--hidden" id="add-member-form-card">
          <h3 class="settings-card__title">${t('settings.newMemberTitle')}</h3>
          <form id="add-member-form" class="settings-form">
            <div class="form-group">
              <label class="form-label" for="new-username">${t('settings.usernameLabel')}</label>
              <input class="form-input" type="text" id="new-username" required autocomplete="off" />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-display-name">${t('settings.displayNameLabel')}</label>
              <input class="form-input" type="text" id="new-display-name" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-member-password">${t('settings.memberPasswordLabel')}</label>
              <input class="form-input" type="password" id="new-member-password" minlength="8" required autocomplete="new-password" />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-avatar-color">${t('settings.colorLabel')}</label>
              <input class="form-input form-input--color" type="color" id="new-avatar-color" value="#007AFF" />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-role">${t('settings.roleLabel')}</label>
              <select class="form-input" id="new-role">
                <option value="member">${t('settings.roleMember')}</option>
                <option value="admin">${t('settings.roleAdmin')}</option>
              </select>
            </div>
            <div id="member-error" class="form-error" hidden></div>
            <div class="settings-form-actions">
              <button type="submit" class="btn btn--primary">${t('settings.createMember')}</button>
              <button type="button" class="btn btn--secondary" id="cancel-add-member">${t('settings.cancelAddMember')}</button>
            </div>
          </form>
        </div>
      </details>
      ` : ''}

      <!-- Abmelden -->
      <section class="settings-section">
        <button class="btn btn--danger-outline settings-logout-btn" id="logout-btn">${t('settings.logout')}</button>
      </section>
    </div>
  `;

  bindEvents(container, user);
}

// --------------------------------------------------------
// Event-Binding
// --------------------------------------------------------

function bindEvents(container, user) {
  // Theme select dropdown
  const themeSelect = container.querySelector('#theme-select');
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      applyTheme(themeSelect.value);
    });
  }

  // Accent color picker
  const accentPicker = container.querySelector('#accent-picker');
  if (accentPicker) {
    accentPicker.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-accent]');
      if (!btn) return;
      applyAccent(btn.dataset.accent);
      accentPicker.querySelectorAll('.accent-swatch').forEach(b => b.classList.remove('accent-swatch--active'));
      btn.classList.add('accent-swatch--active');
    });
  }

  // Daily accent rotation toggle
  const dailyAccent = container.querySelector('#daily-accent');
  if (dailyAccent) {
    dailyAccent.addEventListener('change', () => {
      localStorage.setItem('planium-daily-accent', dailyAccent.checked ? 'true' : 'false');
      if (!dailyAccent.checked) {
        localStorage.removeItem('planium-daily-accent-date');
      }
    });
  }

  // Quote of the Day toggle (localStorage only)
  const showQuotes = container.querySelector('#show-quotes');
  if (showQuotes) {
    showQuotes.addEventListener('change', () => {
      localStorage.setItem('planium-show-quotes', showQuotes.checked ? 'true' : 'false');
    });
  }

  // News headlines toggle (localStorage only)
  const showNews = container.querySelector('#show-news');
  if (showNews) {
    showNews.addEventListener('change', () => {
      localStorage.setItem('planium-show-news', showNews.checked ? 'true' : 'false');
    });
  }

  // Price tickers toggle (localStorage only)
  const showTickers = container.querySelector('#show-tickers');
  if (showTickers) {
    showTickers.addEventListener('change', () => {
      localStorage.setItem('planium-show-tickers', showTickers.checked ? 'true' : 'false');
    });
  }

  const priorityAppearance = container.querySelector('#priority-appearance');
  if (priorityAppearance) {
    priorityAppearance.addEventListener('change', () => {
      localStorage.setItem('planium-priority-appearance', priorityAppearance.value);
      window.planium?.showToast(t('settings.priorityAppearanceSavedToast'), 'success');
    });
  }

  // Quick Link
  const quickLinkSave = container.querySelector('#quick-link-save');
  if (quickLinkSave) {
    quickLinkSave.addEventListener('click', async () => {
      const input = container.querySelector('#quick-link-input');
      const url = input.value.trim();
      quickLinkSave.disabled = true;
      try {
        await api.patch('/auth/me/preferences', { quick_link: url });
        window.planium?.showToast('Quick link saved', 'success');
      } catch (err) {
        window.planium?.showToast(err.message, 'danger');
      } finally {
        quickLinkSave.disabled = false;
      }
    });
  }

  // BTC ticker link
  const tickerLinkSave = container.querySelector('#ticker-link-save');
  if (tickerLinkSave) {
    tickerLinkSave.addEventListener('click', () => {
      const input = container.querySelector('#ticker-link-input');
      const url = input.value.trim();
      if (url) {
        localStorage.setItem('planium-ticker-btc-href', url);
      } else {
        localStorage.removeItem('planium-ticker-btc-href');
      }
      window.planium?.showToast('Ticker link saved', 'success');
    });
  }

  // Background image upload
  const bgUpload = container.querySelector('#bg-upload');
  if (bgUpload) {
    bgUpload.addEventListener('change', () => {
      const file = bgUpload.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1920;
          let { width, height } = img;
          if (width > MAX || height > MAX) {
            const scale = Math.min(MAX / width, MAX / height);
            width  = Math.round(width  * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width  = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          try {
            localStorage.setItem('planium-bg', dataUrl);
          } catch {
            window.planium?.showToast('Image too large to store', 'danger');
            return;
          }
          const preview = container.querySelector('#bg-preview-img');
          if (preview) { preview.src = dataUrl; preview.style.display = ''; }
          const removeBtn = container.querySelector('#bg-remove');
          if (removeBtn) removeBtn.hidden = false;
          window.planium?.applyBackground();
          window.planium?.showToast('Background saved', 'success');
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const bgRemove = container.querySelector('#bg-remove');
  if (bgRemove) {
    bgRemove.addEventListener('click', () => {
      localStorage.removeItem('planium-bg');
      window.planium?.applyBackground();
      const preview = container.querySelector('#bg-preview-img');
      if (preview) { preview.src = ''; preview.style.display = 'none'; }
      bgRemove.hidden = true;
      window.planium?.showToast('Background removed', 'default');
    });
  }

  const bgDim = container.querySelector('#bg-dim');
  const bgDimVal = container.querySelector('#bg-dim-val');
  if (bgDim) {
    bgDim.addEventListener('input', () => {
      const v = bgDim.value;
      localStorage.setItem('planium-bg-dim', v);
      if (bgDimVal) bgDimVal.textContent = `${Math.round(parseFloat(v) * 100)}%`;
      window.planium?.applyBackground();
    });
  }

  // Notification settings - auto-save on change
  for (const id of ['notify-popup', 'notify-sound', 'notify-time', 'notify-interval', 'notify-tone']) {
    const el = container.querySelector(`#${id}`);
    if (!el) continue;
    el.addEventListener('change', async () => {
      const payload = {};
      if (id === 'notify-popup')    payload.notify_popup    = el.checked;
      if (id === 'notify-sound')    payload.notify_sound    = el.checked;
      if (id === 'notify-time')     payload.notify_time     = el.value;
      if (id === 'notify-interval') payload.notify_interval = parseInt(el.value, 10);
      if (id === 'notify-tone') {
        payload.notify_tone = el.value;
        previewTone(el.value);
      }
      try {
        await api.patch('/auth/me/preferences', payload);
        window.planium?.showToast(t('settings.notifySavedToast'), 'success');
      } catch (err) {
        window.planium?.showToast(err.message, 'danger');
      }
    });
  }

  // Tone preview button
  const tonePreviewBtn = container.querySelector('#notify-tone-preview');
  const toneSelect     = container.querySelector('#notify-tone');
  tonePreviewBtn?.addEventListener('click', () => {
    previewTone(toneSelect?.value || 'default');
  });

  // Passwort ändern
  const passwordForm = container.querySelector('#password-form');
  if (passwordForm) {
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPw  = container.querySelector('#current-password').value;
      const newPw      = container.querySelector('#new-password').value;
      const confirmPw  = container.querySelector('#confirm-password').value;
      const errorEl    = container.querySelector('#password-error');

      errorEl.hidden = true;

      if (newPw !== confirmPw) {
        showError(errorEl, t('settings.passwordMismatch'));
        return;
      }

      const btn = passwordForm.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await api.patch('/auth/me/password', { current_password: currentPw, new_password: newPw });
        passwordForm.reset();
        window.planium?.showToast(t('settings.passwordSavedToast'), 'success');
      } catch (err) {
        showError(errorEl, err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Google Sync
  const googleSyncBtn = container.querySelector('#google-sync-btn');
  if (googleSyncBtn) {
    googleSyncBtn.addEventListener('click', async () => {
      googleSyncBtn.disabled = true;
      googleSyncBtn.textContent = t('settings.synchronizing');
      try {
        await api.post('/calendar/google/sync', {});
        window.planium?.showToast(t('settings.syncSuccess', { provider: 'Google Calendar' }), 'success');
      } catch (err) {
        window.planium?.showToast(err.message, 'danger');
      } finally {
        googleSyncBtn.disabled = false;
        googleSyncBtn.textContent = t('settings.syncNow');
      }
    });
  }

  // Google Disconnect (Admin)
  const googleDisconnectBtn = container.querySelector('#google-disconnect-btn');
  if (googleDisconnectBtn) {
    googleDisconnectBtn.addEventListener('click', async () => {
      if (!await showConfirm(t('settings.googleDisconnectConfirm'), { danger: true })) return;
      try {
        await api.delete('/calendar/google/disconnect');
        window.planium?.showToast(t('settings.disconnectedToast', { provider: 'Google Calendar' }), 'default');
        window.planium?.navigate('/settings');
      } catch (err) {
        window.planium?.showToast(err.message, 'danger');
      }
    });
  }

  // Apple Sync
  const appleSyncBtn = container.querySelector('#apple-sync-btn');
  if (appleSyncBtn) {
    appleSyncBtn.addEventListener('click', async () => {
      appleSyncBtn.disabled = true;
      appleSyncBtn.textContent = t('settings.synchronizing');
      try {
        await api.post('/calendar/apple/sync', {});
        window.planium?.showToast(t('settings.syncSuccess', { provider: 'Apple Calendar' }), 'success');
      } catch (err) {
        window.planium?.showToast(err.message, 'danger');
      } finally {
        appleSyncBtn.disabled = false;
        appleSyncBtn.textContent = t('settings.syncNow');
      }
    });
  }

  // Apple Disconnect (Admin)
  const appleDisconnectBtn = container.querySelector('#apple-disconnect-btn');
  if (appleDisconnectBtn) {
    appleDisconnectBtn.addEventListener('click', async () => {
      if (!await showConfirm(t('settings.appleDisconnectConfirm'), { danger: true })) return;
      try {
        await api.delete('/calendar/apple/disconnect');
        window.planium?.showToast(t('settings.disconnectedToast', { provider: 'Apple Calendar' }), 'default');
        window.planium?.navigate('/settings');
      } catch (err) {
        window.planium?.showToast(err.message, 'danger');
      }
    });
  }

  // Apple Connect-Formular (Admin)
  const appleConnectForm = container.querySelector('#apple-connect-form');
  if (appleConnectForm) {
    appleConnectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = container.querySelector('#apple-connect-error');
      errorEl.hidden = true;

      const url      = container.querySelector('#apple-caldav-url').value.trim();
      const username = container.querySelector('#apple-username').value.trim();
      const password = container.querySelector('#apple-password').value;
      const btn      = container.querySelector('#apple-connect-btn');

      btn.disabled = true;
      btn.textContent = t('settings.appleConnecting');
      try {
        await api.post('/calendar/apple/connect', { url, username, password });
        window.planium?.showToast(t('settings.appleConnectedToast'), 'success');
        window.planium?.navigate('/settings');
      } catch (err) {
        showError(errorEl, err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = t('settings.appleConnectBtn');
      }
    });
  }

  // Mealie test connection
  const mealieTestBtn = container.querySelector('#mealie-test-btn');
  if (mealieTestBtn) {
    mealieTestBtn.addEventListener('click', async () => {
      const resultEl = container.querySelector('#mealie-test-result');
      mealieTestBtn.disabled = true;
      resultEl.textContent = 'Testing…';
      resultEl.style.color = '';
      try {
        const res = await api.get('/mealie/test');
        if (res.ok) {
          resultEl.textContent = `✓ Connected — ${res.count} recipe${res.count !== 1 ? 's' : ''} found`;
          resultEl.style.color = 'var(--color-success)';
        } else {
          resultEl.textContent = `✗ ${res.error}`;
          resultEl.style.color = 'var(--color-danger)';
        }
      } catch (err) {
        resultEl.textContent = `✗ ${err.data?.error ?? err.message}`;
        resultEl.style.color = 'var(--color-danger)';
      } finally {
        mealieTestBtn.disabled = false;
      }
    });
  }

  // Mealie Connect (Admin)
  const mealieConnectForm = container.querySelector('#mealie-connect-form');
  if (mealieConnectForm) {
    mealieConnectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = container.querySelector('#mealie-connect-error');
      errorEl.hidden = true;

      const url   = container.querySelector('#mealie-url').value.trim();
      const token = container.querySelector('#mealie-token').value.trim();
      const btn   = container.querySelector('#mealie-connect-btn');

      btn.disabled    = true;
      btn.textContent = '…';
      try {
        await api.post('/mealie/config', { url, token });
        window.planium?.showToast(t('settings.mealieSavedToast'), 'success');
        window.planium?.navigate('/settings');
      } catch (err) {
        showError(errorEl, err.data?.error ?? err.message);
      } finally {
        btn.disabled    = false;
        btn.textContent = t('settings.mealieSaveBtn');
      }
    });
  }

  // Mealie Disconnect (Admin)
  const mealieDisconnectBtn = container.querySelector('#mealie-disconnect-btn');
  if (mealieDisconnectBtn) {
    mealieDisconnectBtn.addEventListener('click', async () => {
      if (!await showConfirm(t('settings.mealieDisconnectConfirm'), { danger: true })) return;
      try {
        await api.delete('/mealie/config');
        window.planium?.showToast(t('settings.mealieDisconnectedToast'), 'default');
        window.planium?.navigate('/settings');
      } catch (err) {
        window.planium?.showToast(err.data?.error ?? err.message, 'danger');
      }
    });
  }

  // FreshRSS test connection
  const freshrssTestBtn = container.querySelector('#freshrss-test-btn');
  if (freshrssTestBtn) {
    freshrssTestBtn.addEventListener('click', async () => {
      const resultEl = container.querySelector('#freshrss-test-result');
      freshrssTestBtn.disabled = true;
      resultEl.textContent = 'Testing…';
      resultEl.style.color = '';
      try {
        const res = await api.get('/freshrss/test');
        if (res.ok) {
          resultEl.textContent = `✓ Connected — ${res.count} article${res.count !== 1 ? 's' : ''} fetched`;
          resultEl.style.color = 'var(--color-success)';
        } else {
          resultEl.textContent = `✗ ${res.error}`;
          resultEl.style.color = 'var(--color-danger)';
        }
      } catch (err) {
        resultEl.textContent = `✗ ${err.data?.error ?? err.message}`;
        resultEl.style.color = 'var(--color-danger)';
      } finally {
        freshrssTestBtn.disabled = false;
      }
    });
  }

  // FreshRSS connect
  const freshrssConnectForm = container.querySelector('#freshrss-connect-form');
  if (freshrssConnectForm) {
    freshrssConnectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl  = container.querySelector('#freshrss-connect-error');
      errorEl.hidden = true;
      const url      = container.querySelector('#freshrss-url').value.trim();
      const username = container.querySelector('#freshrss-username').value.trim();
      const password = container.querySelector('#freshrss-password').value.trim();
      const btn      = container.querySelector('#freshrss-connect-btn');
      btn.disabled   = true;
      try {
        await api.post('/freshrss/config', { url, username, password });
        window.planium?.showToast('FreshRSS connected', 'success');
        window.planium?.refreshOptionalNavItems?.();
        window.planium?.navigate('/settings');
      } catch (err) {
        errorEl.textContent = err.data?.error ?? err.message ?? 'Connection failed';
        errorEl.hidden = false;
        btn.disabled   = false;
      }
    });
  }

  // FreshRSS disconnect
  const freshrssDisconnectBtn = container.querySelector('#freshrss-disconnect-btn');
  if (freshrssDisconnectBtn) {
    freshrssDisconnectBtn.addEventListener('click', async () => {
      if (!await showConfirm('Disconnect FreshRSS?', { danger: true })) return;
      try {
        await api.delete('/freshrss/config');
        window.planium?.showToast('FreshRSS disconnected', 'default');
        window.planium?.refreshOptionalNavItems?.();
        window.planium?.navigate('/settings');
      } catch (err) {
        window.planium?.showToast(err.data?.error ?? err.message, 'danger');
      }
    });
  }

  // Linkding test connection
  const linkdingTestBtn = container.querySelector('#linkding-test-btn');
  if (linkdingTestBtn) {
    linkdingTestBtn.addEventListener('click', async () => {
      const resultEl = container.querySelector('#linkding-test-result');
      linkdingTestBtn.disabled = true;
      resultEl.textContent = 'Testing…';
      resultEl.style.color = '';
      try {
        const res = await api.get('/linkding/test');
        if (res.ok) {
          resultEl.textContent = `✓ Connected — ${res.count} bookmark${res.count !== 1 ? 's' : ''} found`;
          resultEl.style.color = 'var(--color-success)';
        } else {
          resultEl.textContent = `✗ ${res.error}`;
          resultEl.style.color = 'var(--color-danger)';
        }
      } catch (err) {
        resultEl.textContent = `✗ ${err.data?.error ?? err.message}`;
        resultEl.style.color = 'var(--color-danger)';
      } finally {
        linkdingTestBtn.disabled = false;
      }
    });
  }

  // Linkding connect
  const linkdingConnectForm = container.querySelector('#linkding-connect-form');
  if (linkdingConnectForm) {
    linkdingConnectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = container.querySelector('#linkding-connect-error');
      errorEl.hidden = true;
      const url   = container.querySelector('#linkding-url').value.trim();
      const token = container.querySelector('#linkding-token').value.trim();
      const btn   = container.querySelector('#linkding-connect-btn');
      btn.disabled = true;
      try {
        await api.post('/linkding/config', { url, token });
        window.planium?.showToast('Linkding connected', 'success');
        window.planium?.navigate('/settings');
      } catch (err) {
        errorEl.textContent = err.data?.error ?? err.message ?? 'Connection failed';
        errorEl.hidden = false;
        btn.disabled = false;
      }
    });
  }

  // Linkding disconnect
  const linkdingDisconnectBtn = container.querySelector('#linkding-disconnect-btn');
  if (linkdingDisconnectBtn) {
    linkdingDisconnectBtn.addEventListener('click', async () => {
      if (!await showConfirm('Disconnect Linkding?', { danger: true })) return;
      try {
        await api.delete('/linkding/config');
        window.planium?.showToast('Linkding disconnected', 'default');
        window.planium?.navigate('/settings');
      } catch (err) {
        window.planium?.showToast(err.data?.error ?? err.message, 'danger');
      }
    });
  }

  // Weather connect
  const weatherConnectForm = container.querySelector('#weather-connect-form');
  if (weatherConnectForm) {
    weatherConnectForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = container.querySelector('#weather-connect-error');
      errorEl.hidden = true;
      const api_key = container.querySelector('#weather-api-key').value.trim();
      const city    = container.querySelector('#weather-city').value.trim();
      const units   = container.querySelector('#weather-units').value.trim();
      const lang    = container.querySelector('#weather-lang').value.trim();
      const btn     = container.querySelector('#weather-connect-btn');
      btn.disabled  = true;
      try {
        await api.post('/weather/config', { api_key, city, units, lang });
        window.planium?.showToast('Weather connected', 'success');
        window.planium?.navigate('/settings');
      } catch (err) {
        errorEl.textContent = err.data?.error ?? err.message ?? 'Failed to save';
        errorEl.hidden = false;
        btn.disabled = false;
      }
    });
  }

  // Weather disconnect
  const weatherDisconnectBtn = container.querySelector('#weather-disconnect-btn');
  if (weatherDisconnectBtn) {
    weatherDisconnectBtn.addEventListener('click', async () => {
      if (!await showConfirm('Disconnect Weather?', { danger: true })) return;
      try {
        await api.delete('/weather/config');
        window.planium?.showToast('Weather disconnected', 'default');
        window.planium?.navigate('/settings');
      } catch (err) {
        window.planium?.showToast(err.data?.error ?? err.message, 'danger');
      }
    });
  }

  // Mitglied hinzufügen (Admin)
  const addMemberBtn = container.querySelector('#add-member-btn');
  if (addMemberBtn) {
    addMemberBtn.addEventListener('click', () => {
      container.querySelector('#add-member-form-card').classList.remove('settings-card--hidden');
      addMemberBtn.hidden = true;
    });
  }

  const cancelAddMember = container.querySelector('#cancel-add-member');
  if (cancelAddMember) {
    cancelAddMember.addEventListener('click', () => {
      container.querySelector('#add-member-form-card').classList.add('settings-card--hidden');
      container.querySelector('#add-member-btn').hidden = false;
      container.querySelector('#add-member-form').reset();
      container.querySelector('#member-error').hidden = true;
    });
  }

  const addMemberForm = container.querySelector('#add-member-form');
  if (addMemberForm) {
    addMemberForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = container.querySelector('#member-error');
      errorEl.hidden = true;

      const data = {
        username:     container.querySelector('#new-username').value.trim(),
        display_name: container.querySelector('#new-display-name').value.trim(),
        password:     container.querySelector('#new-member-password').value,
        avatar_color: container.querySelector('#new-avatar-color').value,
        role:         container.querySelector('#new-role').value,
      };

      const btn = addMemberForm.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const res  = await auth.createUser(data);
        const list = container.querySelector('#members-list');
        list.insertAdjacentHTML('beforeend', memberHtml(res.user));
        addMemberForm.reset();
        container.querySelector('#add-member-form-card').classList.add('settings-card--hidden');
        container.querySelector('#add-member-btn').hidden = false;
        window.planium?.showToast(t('settings.memberAddedToast', { name: res.user.display_name }), 'success');
        bindDeleteButtons(container, user);
      } catch (err) {
        showError(errorEl, err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  bindDeleteButtons(container, user);

  // Per-user integration overrides (data-driven from INTEGRATIONS)
  INTEGRATIONS.forEach((i) => bindPersonalOverrideEvents(container, i));

  // Filebox per-user opt-in toggle
  const fileboxToggle = container.querySelector('#filebox-enabled');
  if (fileboxToggle) {
    fileboxToggle.addEventListener('change', async () => {
      try {
        await api.post('/filebox/settings', { enabled: fileboxToggle.checked });
        window.planium?.refreshOptionalNavItems?.();
        window.planium?.showToast(
          fileboxToggle.checked ? 'Filebox enabled' : 'Filebox disabled',
          'success',
        );
      } catch (err) {
        fileboxToggle.checked = !fileboxToggle.checked;
        window.planium?.showToast(err.message ?? 'Failed to update', 'danger');
      }
    });
  }

  // Abmelden
  const logoutBtn = container.querySelector('#logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await auth.logout();
      } finally {
        window.location.href = '/login';
      }
    });
  }
}

function bindDeleteButtons(container, user) {
  container.querySelectorAll('[data-delete-user]').forEach((btn) => {
    btn.replaceWith(btn.cloneNode(true)); // Doppelte Listener vermeiden
  });
  container.querySelectorAll('[data-delete-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id   = parseInt(btn.dataset.deleteUser, 10);
      const name = btn.dataset.name;
      if (!await showConfirm(t('settings.deleteMemberConfirm', { name }), { danger: true })) return;
      try {
        await auth.deleteUser(id);
        btn.closest('.settings-member').remove();
        window.planium?.showToast(t('settings.memberDeletedToast', { name }), 'default');
      } catch (err) {
        window.planium?.showToast(err.message, 'danger');
      }
    });
  });
}


function memberHtml(u) {
  return `
    <li class="settings-member" data-id="${u.id}">
      <div class="settings-avatar settings-avatar--sm" style="background:${esc(u.avatar_color)}">${initials(u.display_name)}</div>
      <div class="settings-member__info">
        <span class="settings-member__name">${esc(u.display_name)}</span>
        <span class="settings-member__meta">@${esc(u.username)} · ${u.role === 'admin' ? t('settings.roleAdmin') : t('settings.roleMember')}</span>
      </div>
      <button class="btn btn--icon btn--danger-outline" data-delete-user="${u.id}" data-name="${esc(u.display_name)}" aria-label="${esc(u.display_name)} ${t('settings.deleteMemberLabel')}" title="${t('settings.deleteMemberLabel')}">
        <i data-lucide="trash-2" aria-hidden="true"></i>
      </button>
    </li>
  `;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${formatDate(d)} ${formatTime(d)}`.trim();
}

function currentTheme() {
  return localStorage.getItem('planium-theme') || 'light';
}

function applyTheme(value) {
  localStorage.setItem('planium-theme', value);
  const VALID = ['light','dark','obsidian','midnight-forest','noir','opnsense','deep-ocean','aubergine','parchment'];
  if (VALID.includes(value)) {
    document.documentElement.setAttribute('data-theme', value);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  api.patch('/auth/me/preferences', { theme: value }).catch(() => {});
}

const ACCENT_COLORS = [
  { id: 'blue',   label: 'Blue',   light: '#2563EB', dark: '#60A5FA' },
  { id: 'indigo', label: 'Indigo', light: '#4338CA', dark: '#818CF8' },
  { id: 'violet', label: 'Violet', light: '#6D28D9', dark: '#C4B5FD' },
  { id: 'purple', label: 'Purple', light: '#7C3AED', dark: '#A78BFA' },
  { id: 'pink',   label: 'Pink',   light: '#DB2777', dark: '#F472B6' },
  { id: 'rose',   label: 'Rose',   light: '#E11D48', dark: '#FB7185' },
  { id: 'red',    label: 'Red',    light: '#DC2626', dark: '#F87171' },
  { id: 'orange', label: 'Orange', light: '#EA580C', dark: '#FB923C' },
  { id: 'amber',  label: 'Amber',  light: '#D97706', dark: '#FCD34D' },
  { id: 'gold',   label: 'Gold',   light: '#B45309', dark: '#FCD34D' },
  { id: 'lime',   label: 'Lime',   light: '#4D7C0F', dark: '#A3E635' },
  { id: 'green',  label: 'Green',  light: '#16A34A', dark: '#4ADE80' },
  { id: 'teal',   label: 'Teal',   light: '#0D9488', dark: '#2DD4BF' },
  { id: 'cyan',   label: 'Cyan',   light: '#0E7490', dark: '#22D3EE' },
  { id: 'sky',    label: 'Sky',    light: '#0369A1', dark: '#38BDF8' },
  { id: 'slate',  label: 'Slate',  light: '#475569', dark: '#94A3B8' },
];

function currentAccent() {
  return localStorage.getItem('planium-accent') || 'blue';
}

function currentPriorityAppearance() {
  const value = localStorage.getItem('planium-priority-appearance');
  return value === 'flags' || value === 'both' ? value : 'accent';
}

function applyAccent(id) {
  localStorage.setItem('planium-accent', id);
  if (id === 'blue') {
    document.documentElement.removeAttribute('data-accent');
  } else {
    document.documentElement.setAttribute('data-accent', id);
  }
  api.patch('/auth/me/preferences', { accent: id }).catch(() => {});
}

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}

// --------------------------------------------------------
// Per-user integration override UI
// --------------------------------------------------------
// Renders a toggle + override-fields block driven by an INTEGRATIONS
// entry. The backend exposes GET/PUT/DELETE /{endpoint}/my-config.
// Password-type fields never echo the stored value; a hint signals
// that a saved secret will be preserved if left blank.
function renderPersonalOverride(integration, myConfig) {
  const cfg              = myConfig ?? { useGlobal: true, globalConfigured: false };
  const useGlobal        = cfg.useGlobal !== false;
  const globalConfigured = !!cfg.globalConfigured;
  const globalLabel      = globalConfigured
    ? (cfg.globalUrl ? `Shared: ${esc(cfg.globalUrl)}` : 'Shared connection available')
    : 'No shared connection configured';

  const fieldsHtml = integration.fields.map((f) => {
    const rawVal     = cfg[f.key];
    const isPassword = f.type === 'password';
    const hasStored  = isPassword && rawVal; // '••••••' from backend
    const inputVal   = !isPassword && typeof rawVal === 'string' ? rawVal : '';
    return `
      <div class="form-group">
        <label class="form-label" for="${integration.id}-override-${f.key}">${esc(f.label)}</label>
        <input class="form-input" type="${f.type}" id="${integration.id}-override-${f.key}"
               ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}
               ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}
               value="${esc(inputVal)}" />
        ${f.hint ? `<span class="form-hint">${esc(f.hint)}</span>` : ''}
        ${hasStored ? '<span class="form-hint">A value is saved — leave blank to keep it.</span>' : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="settings-override-block" data-integration="${integration.id}"
         style="margin-top:var(--space-4);padding-top:var(--space-4);border-top:1px solid var(--color-border)">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-3)">
        <h4 class="settings-card__title" style="margin:0;font-size:var(--text-sm)">Your ${esc(integration.label)} connection</h4>
        <span class="form-hint" style="margin:0">${globalLabel}</span>
      </div>
      <div class="settings-toggle-row">
        <label class="settings-toggle-label" for="${integration.id}-use-global">
          Use the shared connection
          ${globalConfigured ? '' : '<span class="form-hint" style="display:inline;margin:0">(not available)</span>'}
        </label>
        <label class="toggle-switch">
          <input type="checkbox" id="${integration.id}-use-global"
                 ${useGlobal ? 'checked' : ''} ${globalConfigured ? '' : 'disabled'} />
          <span class="toggle-switch__slider"></span>
        </label>
      </div>
      <div id="${integration.id}-override-fields" style="margin-top:var(--space-3)" ${useGlobal && globalConfigured ? 'hidden' : ''}>
        ${fieldsHtml}
        <div id="${integration.id}-override-error" class="form-error" hidden></div>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          <button class="btn btn--primary"   id="${integration.id}-override-save"  type="button">Save</button>
          <button class="btn btn--secondary" id="${integration.id}-override-clear" type="button">Clear override</button>
        </div>
      </div>
    </div>
  `;
}

function bindPersonalOverrideEvents(container, integration) {
  const { id, endpoint, fields, label } = integration;
  const root = container.querySelector(`.settings-override-block[data-integration="${id}"]`);
  if (!root) return;

  const toggle   = root.querySelector(`#${id}-use-global`);
  const fieldsEl = root.querySelector(`#${id}-override-fields`);
  const saveBtn  = root.querySelector(`#${id}-override-save`);
  const clearBtn = root.querySelector(`#${id}-override-clear`);
  const errorEl  = root.querySelector(`#${id}-override-error`);

  const syncVisibility = () => { fieldsEl.hidden = toggle.checked && !toggle.disabled; };

  toggle?.addEventListener('change', async () => {
    errorEl.hidden = true;
    syncVisibility();
    try {
      await api.put(`${endpoint}/my-config`, { useGlobal: toggle.checked });
      window.planium?.showToast(
        toggle.checked ? `${label}: using shared connection` : `${label}: using your override`,
        'default',
      );
    } catch (err) {
      showError(errorEl, err.data?.error ?? err.message ?? 'Failed to update');
      toggle.checked = !toggle.checked;
      syncVisibility();
    }
  });

  saveBtn?.addEventListener('click', async () => {
    errorEl.hidden = true;
    const body = { useGlobal: false };
    for (const f of fields) {
      const v = root.querySelector(`#${id}-override-${f.key}`).value.trim();
      if (v) body[f.key] = v;
    }
    saveBtn.disabled = true;
    try {
      await api.put(`${endpoint}/my-config`, body);
      window.planium?.showToast(`${label}: override saved`, 'success');
      window.planium?.navigate('/settings');
    } catch (err) {
      showError(errorEl, err.data?.error ?? err.message ?? 'Failed to save');
      saveBtn.disabled = false;
    }
  });

  clearBtn?.addEventListener('click', async () => {
    if (!await showConfirm(`Clear your ${label} override and use the shared connection?`)) return;
    try {
      await api.delete(`${endpoint}/my-config`);
      window.planium?.showToast(`${label}: override cleared`, 'default');
      window.planium?.navigate('/settings');
    } catch (err) {
      showError(errorEl, err.data?.error ?? err.message);
    }
  });

  syncVisibility();
}
