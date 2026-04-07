/**
 * Modul: Kontakte (Contacts)
 * Zweck: Kontaktliste mit Kategorie-Filter, Suche, CRUD, tel:/mailto:/maps-Links
 * Abhängigkeiten: /api.js, /router.js (window.planner)
 */

import { api } from '/api.js';
import { openModal as openSharedModal, closeModal } from '/components/modal.js';
import { stagger, vibrate } from '/utils/ux.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';

// --------------------------------------------------------
// Konstanten
// --------------------------------------------------------

const CATEGORIES = ['Doctor', 'School/Nursery', 'Authority', 'Insurance',
                    'Tradesperson', 'Emergency', 'Other'];

const CATEGORY_ICONS = {
  'Doctor':        '🏥',
  'School/Nursery':'🏫',
  'Authority':     '🏛️',
  'Insurance':     '🛡️',
  'Tradesperson':  '🔧',
  'Emergency':     '🚨',
  'Other':         '📋',
};

function CATEGORY_LABELS() {
  return {
    'Doctor':        t('contacts.categoryDoctor'),
    'School/Nursery':t('contacts.categorySchool'),
    'Authority':     t('contacts.categoryAuthority'),
    'Insurance':     t('contacts.categoryInsurance'),
    'Tradesperson':  t('contacts.categoryCraftsman'),
    'Emergency':     t('contacts.categoryEmergency'),
    'Other':         t('contacts.categoryOther'),
  };
}

// --------------------------------------------------------
// State
// --------------------------------------------------------

let state = {
  contacts:       [],
  activeCategory: null,
  searchQuery:    '',
  selectMode:     false,
  selected:       new Set(),
};
let _container = null;

// --------------------------------------------------------
// Entry Point
// --------------------------------------------------------

export async function render(container, { user }) {
  _container = container;
  container.innerHTML = `
    <div class="contacts-page">
      <h1 class="sr-only">${t('contacts.title')}</h1>
      <div class="contacts-toolbar">
        <div class="contacts-toolbar__search">
          <i data-lucide="search" class="contacts-toolbar__search-icon" aria-hidden="true"></i>
          <input type="search" class="contacts-toolbar__search-input"
                 id="contacts-search" placeholder="${t('contacts.searchPlaceholder')}"
                 autocomplete="off">
        </div>
        <label class="btn btn--secondary" title="${t('contacts.importTooltip')}" aria-label="${t('contacts.importLabel')}">
          <i data-lucide="upload" style="width:16px;height:16px;margin-right:4px;" aria-hidden="true"></i>
          ${t('contacts.importButton')}
          <input type="file" id="contacts-import-input" accept=".vcf,text/vcard" style="display:none">
        </label>
        <button class="btn btn--secondary" id="contacts-select-btn">
          <i data-lucide="check-square" style="width:16px;height:16px;margin-right:4px;" aria-hidden="true"></i>
          Select
        </button>
        <button class="btn btn--primary" id="contacts-add-btn">
          <i data-lucide="plus" style="width:16px;height:16px;margin-right:4px;" aria-hidden="true"></i>
          ${t('contacts.addButton')}
        </button>
      </div>
      <div class="contacts-filters" id="contacts-filters">
        <button class="contact-filter-chip contact-filter-chip--active" data-cat="">${t('contacts.filterAll')}</button>
        ${CATEGORIES.map((c) => `
          <button class="contact-filter-chip" data-cat="${esc(c)}">${CATEGORY_ICONS[c] || ''} ${CATEGORY_LABELS()[c] || esc(c)}</button>
        `).join('')}
      </div>
      <div id="contacts-list" class="contacts-list"></div>
      <button class="page-fab" id="fab-new-contact" aria-label="${t('contacts.newContactLabel')}">
        <i data-lucide="plus" style="width:24px;height:24px" aria-hidden="true"></i>
      </button>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  const res        = await api.get('/contacts');
  state.contacts   = res.data;
  renderList();

  // Single delegated click handler for the contacts list — attached once per page load
  _container.querySelector('#contacts-list').addEventListener('click', async (e) => {
    const item = e.target.closest('.contact-item[data-id]');

    if (state.selectMode) {
      if (!item) return;
      const id = parseInt(item.dataset.id, 10);
      if (state.selected.has(id)) state.selected.delete(id);
      else state.selected.add(id);
      // Re-render this item so the lucide icon updates correctly
      const c = state.contacts.find((c) => c.id === id);
      if (c) {
        item.outerHTML = renderContactItem(c);
        if (window.lucide) lucide.createIcons();
      }
      renderSelectBar();
      return;
    }

    if (e.target.closest('[data-action="delete"]')) {
      const id = parseInt(e.target.closest('[data-action="delete"]').dataset.id, 10);
      if (!confirm(t('contacts.deleteConfirm'))) return;
      await deleteContact(id);
      return;
    }
    if (item && !e.target.closest('a') && !e.target.closest('[data-action]')) {
      const c = state.contacts.find((c) => c.id === parseInt(item.dataset.id, 10));
      if (c) openContactModal({ mode: 'edit', contact: c });
    }
  });

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
  const addHandler = () => openContactModal({ mode: 'create' });
  _container.querySelector('#contacts-add-btn').addEventListener('click', addHandler);
  _container.querySelector('#fab-new-contact').addEventListener('click', addHandler);

  // Select mode
  _container.querySelector('#contacts-select-btn').addEventListener('click', () => {
    state.selectMode = true;
    state.selected   = new Set();
    renderList();
    renderSelectBar();
  });

  // vCard-Import
  _container.querySelector('#contacts-import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text   = await file.text();
      // Split multi-contact VCF into individual vCard blocks
      const blocks = text.split(/(?=BEGIN:VCARD)/i).map((b) => b.trim()).filter((b) => b);
      const contacts = blocks.map(parseVCard).filter((c) => c.name);

      if (!contacts.length) { window.planner?.showToast(t('contacts.vcardNoName'), 'warning'); return; }

      let imported = 0;
      for (const contact of contacts) {
        const res = await api.post('/contacts', contact);
        state.contacts.push(res.data);
        imported++;
      }
      renderList();
      window.planner?.showToast(
        imported === 1
          ? t('contacts.importedToast', { name: contacts[0].name })
          : `${imported} contacts imported`,
        'success'
      );
    } catch (err) {
      window.planner?.showToast(t('contacts.importError', { error: err.message }), 'danger');
    }
  });
}

// --------------------------------------------------------
// Select-Modus
// --------------------------------------------------------

function renderSelectBar() {
  let bar = _container.querySelector('#contacts-select-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'contacts-select-bar';
    bar.className = 'contacts-select-bar';
    _container.querySelector('.contacts-page').prepend(bar);
  }

  const n = state.selected.size;
  const total = filterContacts().length;

  bar.innerHTML = `
    <button class="btn btn--secondary btn--sm" id="csb-cancel">Cancel</button>
    <span class="contacts-select-bar__count">${n} selected</span>
    <button class="btn btn--secondary btn--sm" id="csb-all">${n === total ? 'Deselect All' : 'Select All'}</button>
    <div class="csb-actions">
      <div class="csb-move-wrap">
        <button class="btn btn--secondary btn--sm" id="csb-move" ${n === 0 ? 'disabled' : ''}>
          <i data-lucide="folder-symlink" style="width:14px;height:14px;margin-right:4px;" aria-hidden="true"></i>
          Move to
        </button>
        <div class="csb-move-dropdown" id="csb-move-dropdown" hidden>
          ${CATEGORIES.map((cat) => `
            <button class="csb-move-option" data-cat="${esc(cat)}">
              ${CATEGORY_ICONS[cat] || ''} ${CATEGORY_LABELS()[cat] || esc(cat)}
            </button>
          `).join('')}
        </div>
      </div>
      <button class="btn btn--secondary btn--sm" id="csb-export" ${n === 0 ? 'disabled' : ''}>
        <i data-lucide="download" style="width:14px;height:14px;margin-right:4px;" aria-hidden="true"></i>
        Export
      </button>
      <button class="btn btn--danger btn--sm" id="csb-delete" ${n === 0 ? 'disabled' : ''}>
        <i data-lucide="trash-2" style="width:14px;height:14px;margin-right:4px;" aria-hidden="true"></i>
        Delete (${n})
      </button>
    </div>
  `;
  if (window.lucide) lucide.createIcons();

  bar.querySelector('#csb-cancel').addEventListener('click', exitSelectMode);

  bar.querySelector('#csb-all').addEventListener('click', () => {
    const visible = filterContacts();
    if (state.selected.size === visible.length) {
      state.selected.clear();
    } else {
      visible.forEach((c) => state.selected.add(c.id));
    }
    renderList();
    renderSelectBar();
  });

  // Move to group
  const moveBtn      = bar.querySelector('#csb-move');
  const moveDropdown = bar.querySelector('#csb-move-dropdown');

  moveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moveDropdown.hidden = !moveDropdown.hidden;
  });

  moveDropdown.querySelectorAll('.csb-move-option').forEach((opt) => {
    opt.addEventListener('click', async () => {
      const cat = opt.dataset.cat;
      moveDropdown.hidden = true;
      const ids = [...state.selected];
      for (const id of ids) {
        await api.put(`/contacts/${id}`, { category: cat });
        const c = state.contacts.find((c) => c.id === id);
        if (c) c.category = cat;
      }
      window.planner?.showToast(`${ids.length} contact(s) moved to ${CATEGORY_LABELS()[cat] || cat}`, 'success');
      exitSelectMode();
    });
  });

  // Close dropdown on outside click
  setTimeout(() => {
    document.addEventListener('click', function closeDrop(e) {
      if (!moveDropdown.contains(e.target) && e.target !== moveBtn) {
        moveDropdown.hidden = true;
        document.removeEventListener('click', closeDrop);
      }
    });
  }, 0);

  bar.querySelector('#csb-export').addEventListener('click', () => {
    const contacts = [...state.selected]
      .map((id) => state.contacts.find((c) => c.id === id))
      .filter(Boolean);
    if (!contacts.length) return;
    const vcf  = contacts.map(contactToVCard).join('\r\n');
    const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = contacts.length === 1 ? `${contacts[0].name.replace(/[^a-zA-Z0-9-_ ]/g, '_')}.vcf` : 'contacts.vcf';
    a.click();
    URL.revokeObjectURL(url);
    exitSelectMode();
  });

  bar.querySelector('#csb-delete').addEventListener('click', async () => {
    if (!state.selected.size) return;
    if (!confirm(`Delete ${state.selected.size} contact(s)?`)) return;
    const ids = [...state.selected];
    for (const id of ids) {
      await deleteContact(id);
    }
    exitSelectMode();
  });
}

function exitSelectMode() {
  state.selectMode = false;
  state.selected.clear();
  _container.querySelector('#contacts-select-bar')?.remove();
  renderList();
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
      <div class="empty-state">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <div class="empty-state__title">${t('contacts.emptyTitle')}</div>
        <div class="empty-state__description">${t('contacts.emptyDescription')}</div>
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
        <div class="contact-group__header">${CATEGORY_ICONS[cat] || ''} ${CATEGORY_LABELS()[cat] || esc(cat)}</div>
        ${items.map((c) => renderContactItem(c)).join('')}
      </div>
    `).join('');

  if (window.lucide) lucide.createIcons();
  stagger(container.querySelectorAll('.contact-item'));
}

function renderContactItem(c) {
  const isSelected = state.selected.has(c.id);

  if (state.selectMode) {
    const meta = [c.phone, c.email].filter(Boolean).join(' · ');
    return `
      <div class="contact-item ${isSelected ? 'contact-item--selected' : ''}" data-id="${c.id}">
        <div class="contact-item__check ${isSelected ? 'contact-item__check--on' : ''}">
          <i data-lucide="${isSelected ? 'check-circle' : 'circle'}" style="width:20px;height:20px;" aria-hidden="true"></i>
        </div>
        <div class="contact-item__body">
          <div class="contact-item__name">${esc(c.name)}</div>
          ${meta ? `<div class="contact-item__meta">${esc(meta)}</div>` : ''}
        </div>
      </div>`;
  }

  const phone   = c.phone  ? `<a href="tel:${esc(c.phone)}"   class="contact-action-btn contact-action-btn--call"  aria-label="${t('contacts.callLabel')}"><i data-lucide="phone" style="width:16px;height:16px;" aria-hidden="true"></i></a>` : '';
  const email   = c.email  ? `<a href="mailto:${esc(c.email)}" class="contact-action-btn contact-action-btn--mail"  aria-label="${t('contacts.emailActionLabel')}"><i data-lucide="mail" style="width:16px;height:16px;" aria-hidden="true"></i></a>` : '';
  const maps    = c.address ? `<a href="https://maps.google.com/?q=${encodeURIComponent(c.address)}" target="_blank" rel="noopener" class="contact-action-btn contact-action-btn--maps" aria-label="${t('contacts.mapsLabel')}"><i data-lucide="map-pin" style="width:16px;height:16px;" aria-hidden="true"></i></a>` : '';
  const meta    = [c.phone, c.email].filter(Boolean).join(' · ');

  return `
    <div class="contact-item" data-id="${c.id}">
      <div class="contact-item__icon">${CATEGORY_ICONS[c.category] || '📋'}</div>
      <div class="contact-item__body">
        <div class="contact-item__name">${esc(c.name)}</div>
        ${meta ? `<div class="contact-item__meta">${esc(meta)}</div>` : ''}
      </div>
      <div class="contact-item__actions">
        ${phone}${email}${maps}
        <a href="/api/v1/contacts/${c.id}/vcard" download="${esc(c.name)}.vcf"
           class="contact-action-btn" aria-label="${t('contacts.exportLabel')}" title="${t('contacts.exportTooltip')}">
          <i data-lucide="download" style="width:16px;height:16px;" aria-hidden="true"></i>
        </a>
        <button class="contact-action-btn" data-action="delete" data-id="${c.id}" aria-label="${t('contacts.deleteLabel')}">
          <i data-lucide="trash-2" style="width:16px;height:16px;" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;
}

// --------------------------------------------------------
// Modal
// --------------------------------------------------------

function openContactModal({ mode, contact = null }) {
  const isEdit = mode === 'edit';
  const v      = (field) => esc(isEdit && contact[field] ? contact[field] : '');

  const catLabels = CATEGORY_LABELS();
  const catOpts = CATEGORIES.map((c) =>
    `<option value="${c}" ${isEdit && contact.category === c ? 'selected' : ''}>${catLabels[c] || esc(c)}</option>`
  ).join('');

  const content = `
    <div class="form-group">
      <label class="form-label" for="cm-name">${t('contacts.nameLabel')}</label>
      <input type="text" class="form-input" id="cm-name" placeholder="${t('contacts.namePlaceholder')}" value="${v('name')}">
    </div>
    <div class="form-group">
      <label class="form-label" for="cm-category">${t('contacts.categoryLabel')}</label>
      <select class="form-input" id="cm-category">${catOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label" for="cm-phone">${t('contacts.phoneLabel')}</label>
      <input type="tel" class="form-input" id="cm-phone" placeholder="${t('contacts.phonePlaceholder')}" value="${v('phone')}">
    </div>
    <div class="form-group">
      <label class="form-label" for="cm-email">${t('contacts.emailLabel')}</label>
      <input type="email" class="form-input" id="cm-email" placeholder="${t('contacts.emailPlaceholder')}" value="${v('email')}">
    </div>
    <div class="form-group">
      <label class="form-label" for="cm-address">${t('contacts.addressLabel')}</label>
      <input type="text" class="form-input" id="cm-address" placeholder="${t('contacts.addressPlaceholder')}" value="${v('address')}">
    </div>
    <div class="form-group">
      <label class="form-label" for="cm-notes">${t('contacts.notesLabel')}</label>
      <textarea class="form-input" id="cm-notes" rows="2" placeholder="${t('contacts.notesPlaceholder')}">${v('notes')}</textarea>
    </div>

    <div class="modal-panel__footer" style="border:none;padding:0;margin-top:var(--space-4)">
      ${isEdit ? `<button class="btn btn--danger btn--icon" id="cm-delete" aria-label="${t('contacts.deleteLabel')}">
        <i data-lucide="trash-2" style="width:16px;height:16px;" aria-hidden="true"></i>
      </button>` : '<div></div>'}
      <div style="display:flex;gap:var(--space-3);">
        <button class="btn btn--secondary" id="cm-cancel">${t('common.cancel')}</button>
        <button class="btn btn--primary" id="cm-save">${isEdit ? t('common.save') : t('common.create')}</button>
      </div>
    </div>`;

  openSharedModal({
    title: isEdit ? t('contacts.editContact') : t('contacts.newContact'),
    content,
    size: 'md',
    onSave(panel) {
      panel.querySelector('#cm-cancel').addEventListener('click', closeModal);

      panel.querySelector('#cm-delete')?.addEventListener('click', async () => {
        if (!confirm(t('contacts.deletePersonConfirm', { name: contact.name }))) return;
        closeModal();
        await deleteContact(contact.id);
      });

      panel.querySelector('#cm-save').addEventListener('click', async () => {
        const saveBtn  = panel.querySelector('#cm-save');
        const name     = panel.querySelector('#cm-name').value.trim();
        const category = panel.querySelector('#cm-category').value;
        const phone    = panel.querySelector('#cm-phone').value.trim() || null;
        const email    = panel.querySelector('#cm-email').value.trim() || null;
        const address  = panel.querySelector('#cm-address').value.trim() || null;
        const notes    = panel.querySelector('#cm-notes').value.trim() || null;

        if (!name) { window.planner?.showToast(t('common.nameRequired'), 'error'); return; }

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
          closeModal();
          renderList();
          window.planner?.showToast(mode === 'create' ? t('contacts.savedToast') : t('contacts.updatedToast'), 'success');
        } catch (err) {
          window.planner?.showToast(err.data?.error ?? t('common.unknownError'), 'error');
          saveBtn.disabled    = false;
          saveBtn.textContent = isEdit ? t('common.save') : t('common.create');
        }
      });
    },
  });
}

async function deleteContact(id) {
  try {
    await api.delete(`/contacts/${id}`);
    state.contacts = state.contacts.filter((c) => c.id !== id);
    renderList();
    vibrate([30, 50, 30]);
    window.planner?.showToast(t('contacts.deletedToast'), 'success');
  } catch (err) {
    window.planner?.showToast(err.data?.error ?? t('common.unknownError'), 'error');
  }
}


/**
 * Kontakt → vCard 3.0 string (inklusive CATEGORIES-Feld).
 */
function contactToVCard(c) {
  const esc = (v) => String(v || '')
    .replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
    .replace(/,/g, '\\,').replace(/;/g, '\\;');

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${esc(c.name)}`,
    `N:${esc(c.name)};;;;`,
  ];
  if (c.phone)    lines.push(`TEL;TYPE=VOICE:${esc(c.phone)}`);
  if (c.email)    lines.push(`EMAIL:${esc(c.email)}`);
  if (c.address)  lines.push(`ADR;TYPE=HOME:;;${esc(c.address)};;;;`);
  if (c.notes)    lines.push(`NOTE:${esc(c.notes)}`);
  if (c.category) lines.push(`CATEGORIES:${esc(c.category)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

/**
 * Minimaler vCard 3.0/4.0 Parser.
 * Gibt { name, phone, email, address, notes, category } zurück.
 */
function parseVCard(text) {
  const unescapeVCard = (s) => String(s || '')
    .replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

  // Decode quoted-printable encoding (=XX hex bytes → UTF-8 string)
  const decodeQP = (s) => {
    // Join soft line breaks (= at end of line)
    const joined = s.replace(/=\r?\n/g, '');
    // Convert =XX sequences to bytes then decode as UTF-8
    try {
      const bytes = joined.replace(/=([0-9A-Fa-f]{2})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16))
      );
      return decodeURIComponent(escape(bytes));
    } catch {
      return joined;
    }
  };

  // Zeilenfortsetzungen entfalten (RFC 6350 §3.2)
  const unfolded = text.replace(/\r?\n[ \t]/g, '');

  const get = (prop) => {
    const re = new RegExp(`^${prop}((?:;[^:]*)*):(.*?)$`, 'im');
    const m  = re.exec(unfolded);
    if (!m) return null;
    const params = m[1].toUpperCase();
    const value  = m[2].trim();
    const decoded = params.includes('QUOTED-PRINTABLE') ? decodeQP(value) : value;
    return unescapeVCard(decoded);
  };

  const name    = get('FN') || get('N')?.split(';')[0] || null;
  const phone   = get('TEL') || null;
  const email   = get('EMAIL') || null;

  // ADR: ;;street;city;region;postal;country
  const adrRaw  = get('ADR');
  let address   = null;
  if (adrRaw) {
    const parts = adrRaw.split(';').map((p) => p.trim()).filter(Boolean);
    address = parts.join(', ') || null;
  }

  const notes    = get('NOTE') || null;
  const catRaw   = get('CATEGORIES') || null;
  const category = CATEGORIES.find((c) => catRaw?.toLowerCase().includes(c.toLowerCase())) || 'Other';

  return { name, phone, email, address, notes, category };
}
