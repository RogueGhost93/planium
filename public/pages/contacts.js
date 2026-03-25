/**
 * Modul: Kontakte (Contacts)
 * Zweck: Kontaktliste mit Kategorie-Filter, Suche, CRUD, tel:/mailto:/maps-Links
 * Abhängigkeiten: /api.js, /router.js (window.oikos)
 */

import { api } from '/api.js';

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const CATEGORIES = ['Arzt', 'Schule/Kita', 'Behörde', 'Versicherung',
                    'Handwerker', 'Notfall', 'Sonstiges'];

const CATEGORY_ICONS = {
  'Arzt':         '🏥',
  'Schule/Kita':  '🏫',
  'Behörde':      '🏛️',
  'Versicherung': '🛡️',
  'Handwerker':   '🔧',
  'Notfall':      '🚨',
  'Sonstiges':    '📋',
};

// --------------------------------------------------------
// State
// --------------------------------------------------------

let state = {
  contacts:       [],
  activeCategory: null,
  searchQuery:    '',
};
let _container = null;

// --------------------------------------------------------
// Entry Point
// --------------------------------------------------------

export async function render(container, { user }) {
  _container = container;
  container.innerHTML = `
    <div class="contacts-page">
      <div class="contacts-toolbar">
        <div class="contacts-toolbar__search">
          <i data-lucide="search" class="contacts-toolbar__search-icon"></i>
          <input type="search" class="contacts-toolbar__search-input"
                 id="contacts-search" placeholder="Name, Telefon oder E-Mail suchen…"
                 autocomplete="off">
        </div>
        <button class="btn btn--primary" id="contacts-add-btn">
          <i data-lucide="plus" style="width:16px;height:16px;margin-right:4px;"></i>
          Neu
        </button>
      </div>
      <div class="contacts-filters" id="contacts-filters">
        <button class="contact-filter-chip contact-filter-chip--active" data-cat="">Alle</button>
        ${CATEGORIES.map((c) => `
          <button class="contact-filter-chip" data-cat="${escHtml(c)}">${CATEGORY_ICONS[c] || ''} ${escHtml(c)}</button>
        `).join('')}
      </div>
      <div id="contacts-list" class="contacts-list"></div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  const res        = await api.get('/contacts');
  state.contacts   = res.data;
  renderList();

  // Suche
  let searchTimer;
  _container.querySelector('#contacts-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      renderList();
    }, 200);
  });

  // Kategorie-Filter
  _container.querySelector('#contacts-filters').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    _container.querySelectorAll('.contact-filter-chip').forEach((c) =>
      c.classList.toggle('contact-filter-chip--active', c === chip)
    );
    state.activeCategory = chip.dataset.cat || null;
    renderList();
  });

  // Neu
  _container.querySelector('#contacts-add-btn').addEventListener('click', () =>
    openModal({ mode: 'create' })
  );
}

// --------------------------------------------------------
// Liste rendern
// --------------------------------------------------------

function filterContacts() {
  let list = state.contacts;

  if (state.activeCategory) {
    list = list.filter((c) => c.category === state.activeCategory);
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.phone  && c.phone.toLowerCase().includes(q)) ||
      (c.email  && c.email.toLowerCase().includes(q))
    );
  }

  return list;
}

function renderList() {
  const container = _container.querySelector('#contacts-list');
  if (!container) return;

  const contacts = filterContacts();

  if (!contacts.length) {
    container.innerHTML = `
      <div class="contacts-empty">
        <i data-lucide="users" style="width:48px;height:48px;color:var(--color-text-disabled);margin-bottom:var(--space-3);"></i>
        <div style="font-size:var(--text-base);font-weight:600;">Keine Kontakte gefunden</div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Nach Kategorie gruppieren
  const groups = {};
  for (const c of contacts) {
    if (!groups[c.category]) groups[c.category] = [];
    groups[c.category].push(c);
  }

  container.innerHTML = Object.entries(groups)
    .sort(([a], [b]) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b))
    .map(([cat, items]) => `
      <div class="contact-group">
        <div class="contact-group__header">${CATEGORY_ICONS[cat] || ''} ${escHtml(cat)}</div>
        ${items.map((c) => renderContactItem(c)).join('')}
      </div>
    `).join('');

  if (window.lucide) lucide.createIcons();

  // Event-Delegation
  container.addEventListener('click', async (e) => {
    if (e.target.closest('[data-action="delete"]')) {
      const id = parseInt(e.target.closest('[data-action="delete"]').dataset.id, 10);
      await deleteContact(id);
      return;
    }
    const item = e.target.closest('.contact-item[data-id]');
    if (item && !e.target.closest('a') && !e.target.closest('[data-action]')) {
      const c = state.contacts.find((c) => c.id === parseInt(item.dataset.id, 10));
      if (c) openModal({ mode: 'edit', contact: c });
    }
  });
}

function renderContactItem(c) {
  const phone   = c.phone  ? `<a href="tel:${escHtml(c.phone)}"   class="contact-action-btn contact-action-btn--call"  title="Anrufen"><i data-lucide="phone" style="width:16px;height:16px;"></i></a>` : '';
  const email   = c.email  ? `<a href="mailto:${escHtml(c.email)}" class="contact-action-btn contact-action-btn--mail"  title="E-Mail"><i data-lucide="mail" style="width:16px;height:16px;"></i></a>` : '';
  const maps    = c.address ? `<a href="https://maps.google.com/?q=${encodeURIComponent(c.address)}" target="_blank" rel="noopener" class="contact-action-btn contact-action-btn--maps" title="In Maps öffnen"><i data-lucide="map-pin" style="width:16px;height:16px;"></i></a>` : '';
  const meta    = [c.phone, c.email].filter(Boolean).join(' · ');

  return `
    <div class="contact-item" data-id="${c.id}">
      <div class="contact-item__icon">${CATEGORY_ICONS[c.category] || '📋'}</div>
      <div class="contact-item__body">
        <div class="contact-item__name">${escHtml(c.name)}</div>
        ${meta ? `<div class="contact-item__meta">${escHtml(meta)}</div>` : ''}
      </div>
      <div class="contact-item__actions">
        ${phone}${email}${maps}
        <button class="contact-action-btn" data-action="delete" data-id="${c.id}" title="Löschen">
          <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
        </button>
      </div>
    </div>
  `;
}

// --------------------------------------------------------
// Modal
// --------------------------------------------------------

function openModal({ mode, contact = null }) {
  document.querySelector('#contact-modal-overlay')?.remove();

  const isEdit = mode === 'edit';
  const v      = (field) => escHtml(isEdit && contact[field] ? contact[field] : '');

  const catOpts = CATEGORIES.map((c) =>
    `<option value="${c}" ${isEdit && contact.category === c ? 'selected' : ''}>${c}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.id        = 'contact-modal-overlay';
  overlay.className = 'contact-modal-overlay';
  overlay.innerHTML = `
    <div class="contact-modal" role="dialog" aria-modal="true">
      <div class="contact-modal__header">
        <h2 class="contact-modal__title">${isEdit ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}</h2>
        <button class="contact-modal__close" id="cm-close" aria-label="Schließen">
          <i data-lucide="x" style="width:16px;height:16px;"></i>
        </button>
      </div>
      <div class="contact-modal__body">
        <div class="form-group">
          <label class="form-label" for="cm-name">Name *</label>
          <input type="text" class="form-input" id="cm-name" placeholder="Vollständiger Name" value="${v('name')}">
        </div>
        <div class="form-group">
          <label class="form-label" for="cm-category">Kategorie</label>
          <select class="form-input" id="cm-category">${catOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label" for="cm-phone">Telefon</label>
          <input type="tel" class="form-input" id="cm-phone" placeholder="+49 …" value="${v('phone')}">
        </div>
        <div class="form-group">
          <label class="form-label" for="cm-email">E-Mail</label>
          <input type="email" class="form-input" id="cm-email" placeholder="name@beispiel.de" value="${v('email')}">
        </div>
        <div class="form-group">
          <label class="form-label" for="cm-address">Adresse</label>
          <input type="text" class="form-input" id="cm-address" placeholder="Straße, PLZ Ort" value="${v('address')}">
        </div>
        <div class="form-group">
          <label class="form-label" for="cm-notes">Notizen</label>
          <textarea class="form-input" id="cm-notes" rows="2" placeholder="Optional…">${v('notes')}</textarea>
        </div>
      </div>
      <div class="contact-modal__footer">
        ${isEdit ? `<button class="btn btn--danger btn--icon" id="cm-delete" title="Löschen">
          <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
        </button>` : '<div></div>'}
        <div style="display:flex;gap:var(--space-3);">
          <button class="btn btn--secondary" id="cm-cancel">Abbrechen</button>
          <button class="btn btn--primary" id="cm-save">${isEdit ? 'Speichern' : 'Erstellen'}</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  if (window.lucide) lucide.createIcons();

  overlay.querySelector('#cm-close').addEventListener('click',  () => overlay.remove());
  overlay.querySelector('#cm-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#cm-delete')?.addEventListener('click', async () => {
    if (!confirm(`"${contact.name}" wirklich löschen?`)) return;
    overlay.remove();
    await deleteContact(contact.id);
  });

  overlay.querySelector('#cm-save').addEventListener('click', async () => {
    const saveBtn  = overlay.querySelector('#cm-save');
    const name     = overlay.querySelector('#cm-name').value.trim();
    const category = overlay.querySelector('#cm-category').value;
    const phone    = overlay.querySelector('#cm-phone').value.trim() || null;
    const email    = overlay.querySelector('#cm-email').value.trim() || null;
    const address  = overlay.querySelector('#cm-address').value.trim() || null;
    const notes    = overlay.querySelector('#cm-notes').value.trim() || null;

    if (!name) { window.oikos?.showToast('Name ist erforderlich', 'error'); return; }

    saveBtn.disabled    = true;
    saveBtn.textContent = '…';

    try {
      const body = { name, category, phone, email, address, notes };
      if (mode === 'create') {
        const res = await api.post('/contacts', body);
        state.contacts.push(res.data);
        state.contacts.sort((a, b) =>
          CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) ||
          a.name.localeCompare(b.name)
        );
      } else {
        const res = await api.put(`/contacts/${contact.id}`, body);
        const idx = state.contacts.findIndex((c) => c.id === contact.id);
        if (idx !== -1) state.contacts[idx] = res.data;
      }
      overlay.remove();
      renderList();
      window.oikos?.showToast(mode === 'create' ? 'Kontakt gespeichert' : 'Kontakt aktualisiert', 'success');
    } catch (err) {
      window.oikos?.showToast(err.data?.error ?? 'Fehler', 'error');
      saveBtn.disabled    = false;
      saveBtn.textContent = isEdit ? 'Speichern' : 'Erstellen';
    }
  });

  overlay.querySelector('#cm-name').focus();
}

async function deleteContact(id) {
  if (!confirm('Kontakt wirklich löschen?')) return;
  try {
    await api.delete(`/contacts/${id}`);
    state.contacts = state.contacts.filter((c) => c.id !== id);
    renderList();
    window.oikos?.showToast('Kontakt gelöscht', 'success');
  } catch (err) {
    window.oikos?.showToast(err.data?.error ?? 'Fehler', 'error');
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
