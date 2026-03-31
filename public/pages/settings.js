/**
 * Modul: Einstellungen (Settings)
 * Zweck: Benutzerkonto, Passwort, Kalender-Sync, Familienmitglieder
 * Abhängigkeiten: /api.js
 */

import { api, auth } from '/api.js';

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

  try {
    const [usersRes, gStatus, aStatus] = await Promise.allSettled([
      user.role === 'admin' ? auth.getUsers() : Promise.resolve({ data: [] }),
      api.get('/calendar/google/status'),
      api.get('/calendar/apple/status'),
    ]);
    if (usersRes.status === 'fulfilled')  users        = usersRes.value.data  ?? [];
    if (gStatus.status  === 'fulfilled')  googleStatus = gStatus.value;
    if (aStatus.status  === 'fulfilled')  appleStatus  = aStatus.value;
  } catch (_) { /* non-critical */ }

  container.innerHTML = `
    <div class="page settings-page">
      <div class="page__header">
        <h1 class="page__title">Einstellungen</h1>
      </div>

      ${syncOk  ? `<div class="settings-banner settings-banner--success">Kalender-Sync mit ${syncOk === 'google' ? 'Google' : 'Apple'} erfolgreich verbunden.</div>` : ''}
      ${syncErr ? `<div class="settings-banner settings-banner--error">Verbindung mit ${syncErr === 'google' ? 'Google' : 'Apple'} fehlgeschlagen. Bitte erneut versuchen.</div>` : ''}

      <!-- Design -->
      <section class="settings-section">
        <h2 class="settings-section__title">Design</h2>
        <div class="settings-card">
          <h3 class="settings-card__title">Darstellung</h3>
          <div class="theme-toggle" id="theme-toggle">
            <button class="theme-toggle__btn ${currentTheme() === 'system' ? 'theme-toggle__btn--active' : ''}" data-theme-value="system" aria-label="System-Einstellung verwenden">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              System
            </button>
            <button class="theme-toggle__btn ${currentTheme() === 'light' ? 'theme-toggle__btn--active' : ''}" data-theme-value="light" aria-label="Helles Design">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              Hell
            </button>
            <button class="theme-toggle__btn ${currentTheme() === 'dark' ? 'theme-toggle__btn--active' : ''}" data-theme-value="dark" aria-label="Dunkles Design">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              Dunkel
            </button>
          </div>
        </div>
      </section>

      <!-- Mein Konto -->
      <section class="settings-section">
        <h2 class="settings-section__title">Mein Konto</h2>

        <div class="settings-card">
          <div class="settings-user-info">
            <div class="settings-avatar" style="background:${user?.avatar_color ?? '#007AFF'}">
              ${initials(user?.display_name)}
            </div>
            <div>
              <div class="settings-user-info__name">${user?.display_name ?? ''}</div>
              <div class="settings-user-info__username">@${user?.username ?? ''}</div>
            </div>
          </div>
        </div>

        <div class="settings-card">
          <h3 class="settings-card__title">Passwort ändern</h3>
          <form id="password-form" class="settings-form">
            <div class="form-group">
              <label class="form-label" for="current-password">Aktuelles Passwort</label>
              <input class="form-input" type="password" id="current-password" autocomplete="current-password" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-password">Neues Passwort</label>
              <input class="form-input" type="password" id="new-password" autocomplete="new-password" minlength="8" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="confirm-password">Neues Passwort bestätigen</label>
              <input class="form-input" type="password" id="confirm-password" autocomplete="new-password" minlength="8" required />
            </div>
            <div id="password-error" class="form-error" hidden></div>
            <button type="submit" class="btn btn--primary">Passwort speichern</button>
          </form>
        </div>
      </section>

      <!-- Kalender-Synchronisation -->
      <section class="settings-section">
        <h2 class="settings-section__title">Kalender-Synchronisation</h2>

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
              <div class="settings-sync-info__name">Google Calendar</div>
              <div class="settings-sync-info__status ${googleStatus.connected ? 'settings-sync-info__status--connected' : ''}">
                ${googleStatus.connected
                  ? `Verbunden${googleStatus.lastSync ? ` · Zuletzt: ${formatDate(googleStatus.lastSync)}` : ''}`
                  : googleStatus.configured ? 'Nicht verbunden' : 'Nicht konfiguriert (fehlende .env-Variablen)'}
              </div>
            </div>
          </div>
          ${googleStatus.configured ? `
            <div class="settings-sync-actions">
              ${googleStatus.connected ? `
                <button class="btn btn--secondary" id="google-sync-btn">Jetzt synchronisieren</button>
                ${user?.role === 'admin' ? `<button class="btn btn--danger-outline" id="google-disconnect-btn">Verbindung trennen</button>` : ''}
              ` : `
                ${user?.role === 'admin' ? `<a href="/api/v1/calendar/google/auth" class="btn btn--primary">Mit Google verbinden</a>` : '<span class="form-hint">Nur Admin kann Google Calendar verbinden.</span>'}
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
              <div class="settings-sync-info__name">Apple Calendar (iCloud)</div>
              <div class="settings-sync-info__status ${appleStatus.configured ? 'settings-sync-info__status--connected' : ''}">
                ${appleStatus.connected
                  ? `Verbunden${appleStatus.lastSync ? ` · Zuletzt: ${formatDate(appleStatus.lastSync)}` : ''}`
                  : appleStatus.configured
                    ? `Konfiguriert (via .env)${appleStatus.lastSync ? ` · Zuletzt: ${formatDate(appleStatus.lastSync)}` : ''}`
                    : 'Nicht verbunden'}
              </div>
            </div>
          </div>
          ${appleStatus.configured ? `
            <div class="settings-sync-actions">
              <button class="btn btn--secondary" id="apple-sync-btn">Jetzt synchronisieren</button>
              ${appleStatus.connected && user?.role === 'admin' ? `<button class="btn btn--danger-outline" id="apple-disconnect-btn">Verbindung trennen</button>` : ''}
            </div>
          ` : user?.role === 'admin' ? `
            <form id="apple-connect-form" class="settings-form settings-form--compact">
              <div class="form-group">
                <label class="form-label" for="apple-caldav-url">CalDAV-Server-URL</label>
                <input class="form-input" type="url" id="apple-caldav-url" placeholder="https://caldav.icloud.com" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="apple-username">Apple-ID (E-Mail)</label>
                <input class="form-input" type="email" id="apple-username" autocomplete="username" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="apple-password">App-spezifisches Passwort</label>
                <input class="form-input" type="password" id="apple-password" autocomplete="current-password" required />
                <span class="form-hint">Passwort unter <strong>appleid.apple.com → Sicherheit</strong> erstellen.</span>
              </div>
              <div id="apple-connect-error" class="form-error" hidden></div>
              <button type="submit" class="btn btn--primary" id="apple-connect-btn">Verbinden &amp; testen</button>
            </form>
          ` : '<span class="form-hint">Nur Admin kann Apple Calendar verbinden.</span>'}
        </div>
      </section>

      <!-- Familienmitglieder (nur Admin) -->
      ${user?.role === 'admin' ? `
      <section class="settings-section">
        <h2 class="settings-section__title">Familienmitglieder</h2>
        <div class="settings-card" id="members-card">
          <ul class="settings-members" id="members-list">
            ${users.map(memberHtml).join('')}
          </ul>
          <button class="btn btn--primary settings-add-btn" id="add-member-btn">+ Mitglied hinzufügen</button>
        </div>

        <div class="settings-card settings-card--hidden" id="add-member-form-card">
          <h3 class="settings-card__title">Neues Familienmitglied</h3>
          <form id="add-member-form" class="settings-form">
            <div class="form-group">
              <label class="form-label" for="new-username">Benutzername</label>
              <input class="form-input" type="text" id="new-username" required autocomplete="off" />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-display-name">Anzeigename</label>
              <input class="form-input" type="text" id="new-display-name" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-member-password">Passwort</label>
              <input class="form-input" type="password" id="new-member-password" minlength="8" required autocomplete="new-password" />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-avatar-color">Farbe</label>
              <input class="form-input form-input--color" type="color" id="new-avatar-color" value="#007AFF" />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-role">Rolle</label>
              <select class="form-input" id="new-role">
                <option value="member">Mitglied</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div id="member-error" class="form-error" hidden></div>
            <div class="settings-form-actions">
              <button type="submit" class="btn btn--primary">Erstellen</button>
              <button type="button" class="btn btn--secondary" id="cancel-add-member">Abbrechen</button>
            </div>
          </form>
        </div>
      </section>
      ` : ''}

      <!-- Abmelden -->
      <section class="settings-section">
        <button class="btn btn--danger-outline settings-logout-btn" id="logout-btn">Abmelden</button>
      </section>
    </div>
  `;

  bindEvents(container, user);
}

// --------------------------------------------------------
// Event-Binding
// --------------------------------------------------------

function bindEvents(container, user) {
  // Theme-Toggle
  const themeToggle = container.querySelector('#theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme-value]');
      if (!btn) return;
      const value = btn.dataset.themeValue;
      applyTheme(value);
      themeToggle.querySelectorAll('.theme-toggle__btn').forEach(b => b.classList.remove('theme-toggle__btn--active'));
      btn.classList.add('theme-toggle__btn--active');
    });
  }

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
        showError(errorEl, 'Passwörter stimmen nicht überein.');
        return;
      }

      const btn = passwordForm.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        await api.patch('/auth/me/password', { current_password: currentPw, new_password: newPw });
        passwordForm.reset();
        window.oikos?.showToast('Passwort erfolgreich geändert.', 'success');
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
      googleSyncBtn.textContent = 'Synchronisiere…';
      try {
        await api.post('/calendar/google/sync', {});
        window.oikos?.showToast('Google Calendar synchronisiert.', 'success');
      } catch (err) {
        window.oikos?.showToast(err.message, 'danger');
      } finally {
        googleSyncBtn.disabled = false;
        googleSyncBtn.textContent = 'Jetzt synchronisieren';
      }
    });
  }

  // Google Disconnect (Admin)
  const googleDisconnectBtn = container.querySelector('#google-disconnect-btn');
  if (googleDisconnectBtn) {
    googleDisconnectBtn.addEventListener('click', async () => {
      if (!confirm('Google Calendar-Verbindung trennen?')) return;
      try {
        await api.delete('/calendar/google/disconnect');
        window.oikos?.showToast('Google Calendar getrennt.', 'default');
        window.oikos?.navigate('/settings');
      } catch (err) {
        window.oikos?.showToast(err.message, 'danger');
      }
    });
  }

  // Apple Sync
  const appleSyncBtn = container.querySelector('#apple-sync-btn');
  if (appleSyncBtn) {
    appleSyncBtn.addEventListener('click', async () => {
      appleSyncBtn.disabled = true;
      appleSyncBtn.textContent = 'Synchronisiere…';
      try {
        await api.post('/calendar/apple/sync', {});
        window.oikos?.showToast('Apple Calendar synchronisiert.', 'success');
      } catch (err) {
        window.oikos?.showToast(err.message, 'danger');
      } finally {
        appleSyncBtn.disabled = false;
        appleSyncBtn.textContent = 'Jetzt synchronisieren';
      }
    });
  }

  // Apple Disconnect (Admin)
  const appleDisconnectBtn = container.querySelector('#apple-disconnect-btn');
  if (appleDisconnectBtn) {
    appleDisconnectBtn.addEventListener('click', async () => {
      if (!confirm('Apple Calendar-Verbindung trennen?')) return;
      try {
        await api.delete('/calendar/apple/disconnect');
        window.oikos?.showToast('Apple Calendar getrennt.', 'default');
        window.oikos?.navigate('/settings');
      } catch (err) {
        window.oikos?.showToast(err.message, 'danger');
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
      btn.textContent = 'Verbinde…';
      try {
        await api.post('/calendar/apple/connect', { url, username, password });
        window.oikos?.showToast('Apple Calendar verbunden.', 'success');
        window.oikos?.navigate('/settings');
      } catch (err) {
        showError(errorEl, err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Verbinden & testen';
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
        window.oikos?.showToast(`${res.user.display_name} hinzugefügt.`, 'success');
        bindDeleteButtons(container, user);
      } catch (err) {
        showError(errorEl, err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  bindDeleteButtons(container, user);

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
      if (!confirm(`${name} wirklich löschen?`)) return;
      try {
        await auth.deleteUser(id);
        btn.closest('.settings-member').remove();
        window.oikos?.showToast(`${name} gelöscht.`, 'default');
      } catch (err) {
        window.oikos?.showToast(err.message, 'danger');
      }
    });
  });
}

// --------------------------------------------------------
// Helfer
// --------------------------------------------------------

function memberHtml(u) {
  return `
    <li class="settings-member" data-id="${u.id}">
      <div class="settings-avatar settings-avatar--sm" style="background:${u.avatar_color}">${initials(u.display_name)}</div>
      <div class="settings-member__info">
        <span class="settings-member__name">${u.display_name}</span>
        <span class="settings-member__meta">@${u.username} · ${u.role === 'admin' ? 'Admin' : 'Mitglied'}</span>
      </div>
      <button class="btn btn--icon btn--danger-outline" data-delete-user="${u.id}" data-name="${u.display_name}" aria-label="${u.display_name} löschen" title="Löschen">
        <i data-lucide="trash-2" aria-hidden="true"></i>
      </button>
    </li>
  `;
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function currentTheme() {
  return localStorage.getItem('oikos-theme') || 'system';
}

function applyTheme(value) {
  localStorage.setItem('oikos-theme', value);
  if (value === 'light' || value === 'dark') {
    document.documentElement.setAttribute('data-theme', value);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function showError(el, msg) {
  el.textContent = msg;
  el.hidden = false;
}
