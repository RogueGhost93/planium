/**
 * Modul: Listen (3-Tier: head_lists → sublists → items)
 * Tier 1: Head lists = Tabs
 * Tier 2: Sublists   = Sektionen mit Quick-Add + Items
 * Tier 3: Items
 */

import { api } from '/api.js';
import { stagger, vibrate } from '/utils/ux.js';
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { showConfirm, showPrompt, openModal, closeModal } from '/components/modal.js';

const SWIPE_THRESHOLD = 80;
const SWIPE_MAX_VERT  = 12;
const SWIPE_LOCK_VERT = 30;

const state = {
  heads:        [],
  activeHeadId: null,
  head:         null,
  sublists:     [],
  items:        [],
};

// --------------------------------------------------------
// Renders
// --------------------------------------------------------

function renderHeadTabs(container) {
  const bar = container.querySelector('#list-tabs-bar');
  if (!bar) return;

  const tabsHtml = state.heads.map((h) => {
    const unchecked = h.unchecked_count || 0;
    return `
      <button class="list-tab ${h.id === state.activeHeadId ? 'list-tab--active' : ''}"
              data-action="switch-head" data-id="${h.id}">
        ${esc(h.name)}
        ${unchecked > 0 ? `<span class="list-tab__count">${unchecked}</span>` : ''}
      </button>`;
  }).join('');

  bar.innerHTML = `
    ${tabsHtml}
    <button class="list-tab__new" data-action="new-head" aria-label="${t('shopping.newHeadListLabel')}">
      <i data-lucide="plus" style="width:18px;height:18px" aria-hidden="true"></i>
    </button>
  `;
  if (window.lucide) window.lucide.createIcons();
}

function renderHeadBody(container) {
  const content = container.querySelector('#list-content');
  if (!content) return;

  if (!state.head) {
    content.innerHTML = `
      <div class="no-lists">
        <i data-lucide="list-checks" style="width:56px;height:56px;color:var(--color-text-disabled)" aria-hidden="true"></i>
        <div style="font-size:var(--text-lg);font-weight:var(--font-weight-semibold)">${t('shopping.noHeadLists')}</div>
        <div style="font-size:var(--text-sm);color:var(--color-text-secondary)">${t('shopping.noHeadListsDescription')}</div>
        <button class="btn btn--primary" data-action="new-head">${t('shopping.createFirstHead')}</button>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  content.innerHTML = `
    <div class="list-header">
      <span class="list-header__name" data-action="rename-head" role="button" tabindex="0"
            aria-label="${t('shopping.renameHeadLabel')}">
        ${esc(state.head.name)}
        <i data-lucide="pencil" class="list-header__edit-icon" aria-hidden="true"></i>
      </span>
      <div class="list-header__actions">
        <button class="btn btn--ghost btn--icon" data-action="delete-head"
                aria-label="${t('shopping.deleteHeadLabel')}"
                style="color:var(--color-text-secondary)">
          <i data-lucide="trash" style="width:18px;height:18px" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <div class="sublists-scroll" id="sublists-scroll">
      ${state.sublists.map(renderSublist).join('')}
      <button class="btn btn--ghost new-sublist-btn" data-action="new-sublist">
        <i data-lucide="plus" style="width:16px;height:16px" aria-hidden="true"></i>
        ${t('shopping.addSublist')}
      </button>
    </div>
  `;

  if (window.lucide) window.lucide.createIcons();
  stagger(content.querySelectorAll('.shopping-item'));
  wireSwipeGestures(container);
  wireAllAutocomplete(container);
}

function renderSublist(sub) {
  const subItems = state.items.filter((i) => i.list_id === sub.id);
  const checkedCount = subItems.filter((i) => i.is_checked).length;

  return `
    <section class="sublist" data-sublist-id="${sub.id}">
      <div class="sublist__header">
        <span class="sublist__name" data-action="rename-sublist" data-id="${sub.id}"
              role="button" tabindex="0">
          ${esc(sub.name)}
          <i data-lucide="pencil" class="sublist__edit-icon" aria-hidden="true"></i>
        </span>
        <div class="sublist__actions">
          ${checkedCount > 0 ? `
            <button class="btn btn--ghost" data-action="clear-checked" data-id="${sub.id}"
                    style="font-size:var(--text-sm);color:var(--color-text-secondary)">
              <i data-lucide="trash-2" style="width:15px;height:15px" aria-hidden="true"></i>
              ${t('shopping.clearChecked', { count: checkedCount })}
            </button>` : ''}
          <button class="btn btn--ghost btn--icon" data-action="delete-sublist" data-id="${sub.id}"
                  aria-label="${t('shopping.deleteListLabel')}"
                  style="color:var(--color-text-secondary)">
            <i data-lucide="trash" style="width:16px;height:16px" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <div class="quick-add">
        <form class="quick-add__form" data-quick-add-form data-sublist-id="${sub.id}" novalidate autocomplete="off">
          <div class="quick-add__input-wrap">
            <input class="quick-add__input" type="text" data-field="name"
                   placeholder="${t('shopping.itemNamePlaceholder')}" aria-label="${t('shopping.itemNameLabel')}" autocomplete="off">
            <input class="quick-add__qty" type="text" data-field="qty"
                   placeholder="${t('shopping.itemQtyPlaceholder')}" aria-label="${t('shopping.itemQtyLabel')}" autocomplete="off">
            <div class="autocomplete-dropdown" data-autocomplete hidden></div>
          </div>
          <button class="quick-add__btn" type="submit" aria-label="${t('shopping.addItemLabel')}">
            <i data-lucide="plus" style="width:20px;height:20px" aria-hidden="true"></i>
          </button>
        </form>
      </div>

      <div class="items-list" data-items-for="${sub.id}">
        ${renderItems(subItems)}
      </div>
    </section>`;
}

function renderItems(items) {
  if (!items.length) {
    return `<div class="sublist__empty">${t('shopping.emptyList')}</div>`;
  }
  const sorted = [...items].sort((a, b) => (a.is_checked - b.is_checked) || (a.id - b.id));
  return sorted.map(renderItem).join('');
}

function renderItem(item) {
  const isDone = Boolean(item.is_checked);
  return `
    <div class="swipe-row" data-swipe-id="${item.id}" data-swipe-checked="${item.is_checked}">
      <div class="swipe-reveal swipe-reveal--done" aria-hidden="true">
        <i data-lucide="${isDone ? 'rotate-ccw' : 'check'}" style="width:22px;height:22px" aria-hidden="true"></i>
        <span>${isDone ? t('shopping.swipeBack') : t('shopping.swipeCheck')}</span>
      </div>
      <div class="swipe-reveal swipe-reveal--delete" aria-hidden="true">
        <i data-lucide="trash-2" style="width:22px;height:22px" aria-hidden="true"></i>
        <span>${t('shopping.swipeDelete')}</span>
      </div>
      <div class="shopping-item ${isDone ? 'shopping-item--checked' : ''}" data-item-id="${item.id}">
        <button class="item-check ${isDone ? 'item-check--checked' : ''}"
                data-action="toggle-item" data-id="${item.id}" data-checked="${item.is_checked}"
                aria-label="${isDone ? t('shopping.markUndoneLabel', { name: esc(item.name) }) : t('shopping.markDoneLabel', { name: esc(item.name) })}">
          <i data-lucide="check" class="item-check__icon" aria-hidden="true"></i>
        </button>
        <div class="item-body">
          <div class="item-name">${esc(item.name)}</div>
          ${item.quantity ? `<div class="item-quantity">${esc(item.quantity)}</div>` : ''}
        </div>
        <button class="item-delete" data-action="delete-item" data-id="${item.id}"
                aria-label="${t('shopping.deleteItemLabel', { name: esc(item.name) })}">
          <i data-lucide="x" style="width:16px;height:16px" aria-hidden="true"></i>
        </button>
      </div>
    </div>`;
}

// --------------------------------------------------------
// Autocomplete (per sublist form)
// --------------------------------------------------------

function wireAllAutocomplete(container) {
  container.querySelectorAll('[data-quick-add-form]').forEach((form) => {
    const input    = form.querySelector('[data-field="name"]');
    const dropdown = form.querySelector('[data-autocomplete]');
    if (!input || !dropdown) return;

    let activeIdx = -1;
    let timer = null;

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 1) { dropdown.hidden = true; return; }
      timer = setTimeout(async () => {
        try {
          const data = await api.get(`/lists/suggestions?q=${encodeURIComponent(q)}`);
          const suggestions = data.data ?? [];
          if (!suggestions.length) { dropdown.hidden = true; return; }
          dropdown.innerHTML = suggestions.map((s, i) =>
            `<div class="autocomplete-item" data-idx="${i}" data-value="${esc(s)}">${esc(s)}</div>`
          ).join('');
          dropdown.hidden = false;
          activeIdx = -1;
          dropdown.querySelectorAll('.autocomplete-item').forEach((el) => {
            el.addEventListener('mousedown', (e) => {
              e.preventDefault();
              input.value = el.dataset.value;
              dropdown.hidden = true;
            });
          });
        } catch { dropdown.hidden = true; }
      }, 200);
    });

    input.addEventListener('keydown', (e) => {
      if (dropdown.hidden) return;
      const items = dropdown.querySelectorAll('.autocomplete-item');
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('autocomplete-item--active', i === activeIdx));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        items.forEach((el, i) => el.classList.toggle('autocomplete-item--active', i === activeIdx));
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        input.value = items[activeIdx].dataset.value;
        dropdown.hidden = true;
      } else if (e.key === 'Escape') {
        dropdown.hidden = true;
      }
    });

    input.addEventListener('blur', () => setTimeout(() => { dropdown.hidden = true; }, 150));
  });
}

// --------------------------------------------------------
// Swipe gestures
// --------------------------------------------------------

function wireSwipeGestures(container) {
  container.querySelectorAll('.swipe-row').forEach((row) => {
    let startX = 0, startY = 0;
    let dx = 0;
    let locked = false;
    let thresholdHit = false;
    const card = row.querySelector('.shopping-item');
    if (!card) return;

    function resetCard(animate = true) {
      card.style.transition = animate ? 'transform 0.25s ease' : '';
      card.style.transform  = '';
      row.classList.remove('swipe-row--swiping');
      row.querySelector('.swipe-reveal--done').style.opacity   = '0';
      row.querySelector('.swipe-reveal--delete').style.opacity = '0';
    }

    row.addEventListener('touchstart', (e) => {
      if (document.getElementById('shared-modal-overlay')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0; locked = false; thresholdHit = false;
      card.style.transition = '';
    }, { passive: true });

    row.addEventListener('touchmove', (e) => {
      if (locked === 'scroll') return;
      const cx = e.touches[0].clientX;
      const cy = e.touches[0].clientY;
      dx = cx - startX;
      const dy = Math.abs(cy - startY);

      if (locked === false) {
        if (dy > SWIPE_MAX_VERT && Math.abs(dx) < dy) { locked = 'scroll'; resetCard(false); return; }
        if (Math.abs(dx) > SWIPE_MAX_VERT) locked = 'swipe';
      }
      if (locked !== 'swipe') return;
      if (dy < SWIPE_LOCK_VERT) e.preventDefault();

      const dampened = dx > 0
        ? Math.min(dx,  SWIPE_THRESHOLD + (dx  - SWIPE_THRESHOLD) * 0.2)
        : Math.max(dx, -(SWIPE_THRESHOLD + (-dx - SWIPE_THRESHOLD) * 0.2));
      card.style.transform = `translateX(${dampened}px)`;
      row.classList.add('swipe-row--swiping');

      const progress = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
      if (dx < 0) {
        row.querySelector('.swipe-reveal--done').style.opacity = String(progress);
        row.querySelector('.swipe-reveal--delete').style.opacity = '0';
      } else {
        row.querySelector('.swipe-reveal--delete').style.opacity = String(progress);
        row.querySelector('.swipe-reveal--done').style.opacity = '0';
      }
      if (!thresholdHit && Math.abs(dx) >= SWIPE_THRESHOLD) { thresholdHit = true; vibrate(15); }
    }, { passive: false });

    row.addEventListener('touchend', async () => {
      if (locked !== 'swipe') { resetCard(false); return; }
      const itemId  = Number(row.dataset.swipeId);
      const checked = Number(row.dataset.swipeChecked);

      if (dx < -SWIPE_THRESHOLD) {
        card.style.transition = 'transform 0.2s ease';
        card.style.transform  = 'translateX(-110%)';
        vibrate(40);
        setTimeout(async () => {
          resetCard(false);
          const newVal = checked ? 0 : 1;
          const item = state.items.find((i) => i.id === itemId);
          if (item) item.is_checked = newVal;
          try {
            await api.patch(`/lists/items/${itemId}`, { is_checked: newVal });
            vibrate(10);
            rerenderCurrentHead(container);
          } catch (err) {
            if (item) item.is_checked = checked;
            window.planner.showToast(err.message, 'danger');
          }
        }, 200);
      } else if (dx > SWIPE_THRESHOLD) {
        card.style.transition = 'transform 0.2s ease';
        card.style.transform  = 'translateX(110%)';
        vibrate(40);
        setTimeout(async () => {
          try {
            await api.delete(`/lists/items/${itemId}`);
            state.items = state.items.filter((i) => i.id !== itemId);
            rerenderCurrentHead(container);
          } catch (err) {
            resetCard(true);
            window.planner.showToast(err.message, 'danger');
          }
        }, 200);
      } else {
        resetCard(true);
      }
    });
  });
}

// --------------------------------------------------------
// Data loading
// --------------------------------------------------------

async function loadHeads() {
  const res = await api.get('/lists/heads');
  state.heads = res.data ?? [];
}

async function loadHead(headId) {
  const res = await api.get(`/lists/heads/${headId}/full`);
  state.head     = res.data.head;
  state.sublists = res.data.sublists || [];
  state.items    = res.data.items    || [];
  state.activeHeadId = headId;
}

function rerenderCurrentHead(container) {
  renderHeadTabs(container);
  renderHeadBody(container);
}

async function switchHead(headId, container) {
  try {
    await loadHead(headId);
  } catch (err) {
    console.error('[Lists] loadHead:', err);
    state.head = null; state.sublists = []; state.items = [];
    window.planner?.showToast(t('shopping.listsLoadError'), 'danger');
  }
  rerenderCurrentHead(container);
}

// --------------------------------------------------------
// Event wiring
// --------------------------------------------------------

function wireContentEvents(container) {
  container.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;

    if (action === 'switch-head') {
      const id = Number(target.dataset.id);
      if (id !== state.activeHeadId) await switchHead(id, container);
      return;
    }

    if (action === 'new-head') {
      const name = await showPrompt(t('shopping.newHeadPrompt'));
      if (!name?.trim()) return;
      try {
        const res = await api.post('/lists/heads', { name: name.trim() });
        state.heads.push(res.data);
        await switchHead(res.data.id, container);
      } catch (err) { window.planner.showToast(err.message, 'danger'); }
      return;
    }

    if (action === 'rename-head') {
      const name = await showPrompt(t('shopping.renameHeadPrompt'), state.head?.name);
      if (!name?.trim() || name.trim() === state.head.name) return;
      try {
        const res = await api.put(`/lists/heads/${state.head.id}`, { name: name.trim() });
        state.head.name = res.data.name;
        const h = state.heads.find((x) => x.id === state.head.id); if (h) h.name = res.data.name;
        rerenderCurrentHead(container);
      } catch (err) { window.planner.showToast(err.message, 'danger'); }
      return;
    }

    if (action === 'delete-head') {
      if (!await showConfirm(t('shopping.deleteHeadConfirm', { name: state.head?.name }), { danger: true })) return;
      try {
        await api.delete(`/lists/heads/${state.head.id}`);
        state.heads = state.heads.filter((h) => h.id !== state.head.id);
        const next = state.heads[0];
        if (next) await switchHead(next.id, container);
        else { state.head = null; state.sublists = []; state.items = []; rerenderCurrentHead(container); }
      } catch (err) { window.planner.showToast(err.message, 'danger'); }
      return;
    }

    if (action === 'new-sublist') {
      const name = await showPrompt(t('shopping.newSublistPrompt'));
      if (!name?.trim()) return;
      try {
        const res = await api.post(`/lists/heads/${state.head.id}/sublists`, { name: name.trim() });
        state.sublists.push(res.data);
        rerenderCurrentHead(container);
      } catch (err) { window.planner.showToast(err.message, 'danger'); }
      return;
    }

    if (action === 'rename-sublist') {
      const id = Number(target.dataset.id);
      const sub = state.sublists.find((s) => s.id === id); if (!sub) return;
      const name = await showPrompt(t('shopping.renameSublistPrompt'), sub.name);
      if (!name?.trim() || name.trim() === sub.name) return;
      try {
        const res = await api.put(`/lists/${id}`, { name: name.trim() });
        sub.name = res.data.name;
        rerenderCurrentHead(container);
      } catch (err) { window.planner.showToast(err.message, 'danger'); }
      return;
    }

    if (action === 'delete-sublist') {
      const id = Number(target.dataset.id);
      const sub = state.sublists.find((s) => s.id === id); if (!sub) return;
      if (!await showConfirm(t('shopping.deleteListConfirm', { name: sub.name }), { danger: true })) return;
      try {
        await api.delete(`/lists/${id}`);
        state.sublists = state.sublists.filter((s) => s.id !== id);
        state.items = state.items.filter((i) => i.list_id !== id);
        rerenderCurrentHead(container);
      } catch (err) { window.planner.showToast(err.message, 'danger'); }
      return;
    }

    if (action === 'toggle-item') {
      const id = Number(target.dataset.id);
      const checked = Number(target.dataset.checked);
      const newVal = checked ? 0 : 1;
      const item = state.items.find((i) => i.id === id); if (!item) return;
      item.is_checked = newVal;
      rerenderCurrentHead(container);
      try {
        await api.patch(`/lists/items/${id}`, { is_checked: newVal });
        vibrate(10);
      } catch (err) {
        item.is_checked = checked;
        rerenderCurrentHead(container);
        window.planner.showToast(err.message, 'danger');
      }
      return;
    }

    if (action === 'delete-item') {
      const id = Number(target.dataset.id);
      try {
        await api.delete(`/lists/items/${id}`);
        state.items = state.items.filter((i) => i.id !== id);
        rerenderCurrentHead(container);
      } catch (err) { window.planner.showToast(err.message, 'danger'); }
      return;
    }

    if (action === 'clear-checked') {
      const id = Number(target.dataset.id);
      const count = state.items.filter((i) => i.list_id === id && i.is_checked).length;
      if (!count) return;
      try {
        await api.delete(`/lists/${id}/items/checked`);
        state.items = state.items.filter((i) => !(i.list_id === id && i.is_checked));
        rerenderCurrentHead(container);
        window.planner.showToast(t('shopping.itemsRemovedToast', { count }));
      } catch (err) { window.planner.showToast(err.message, 'danger'); }
      return;
    }
  });

  container.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-quick-add-form]');
    if (!form) return;
    e.preventDefault();
    const sublistId = Number(form.dataset.sublistId);
    const nameEl = form.querySelector('[data-field="name"]');
    const qtyEl  = form.querySelector('[data-field="qty"]');
    const name = nameEl.value.trim();
    const quantity = qtyEl.value.trim() || null;
    if (!name) { nameEl.focus(); return; }
    try {
      const res = await api.post(`/lists/${sublistId}/items`, { name, quantity });
      state.items.push(res.data);
      rerenderCurrentHead(container);
      const refocus = container.querySelector(`[data-quick-add-form][data-sublist-id="${sublistId}"] [data-field="name"]`);
      if (refocus) refocus.focus();
    } catch (err) {
      window.planner.showToast(err.message, 'danger');
    }
  });
}

// --------------------------------------------------------
// Head-tabs drag reorder
// --------------------------------------------------------

function wireHeadTabDragReorder(container) {
  const bar = container.querySelector('#list-tabs-bar');
  if (!bar) return;

  let dragging  = null;
  let dragPtrId = null;
  let didDrag   = false;
  let startX = 0, startY = 0;

  const getTabs = () => [...bar.querySelectorAll('.list-tab')];

  bar.addEventListener('pointerdown', (e) => {
    const tab = e.target.closest('.list-tab');
    if (!tab) return;
    dragging  = tab;
    dragPtrId = e.pointerId;
    didDrag   = false;
    startX = e.clientX; startY = e.clientY;
  });

  bar.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragPtrId) return;
    const dx = e.clientX - startX;
    const dy = Math.abs(e.clientY - startY);
    if (!didDrag && dy > Math.abs(dx) + 5) { dragging = null; dragPtrId = null; return; }
    if (!didDrag) {
      if (Math.abs(dx) < 8) return;
      didDrag = true;
      dragging.classList.add('list-tab--dragging');
      try { bar.setPointerCapture(e.pointerId); } catch {}
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.list-tab');
    if (!over || over === dragging) return;
    const tabs = getTabs();
    const dragIdx = tabs.indexOf(dragging);
    const overIdx = tabs.indexOf(over);
    if (dragIdx === -1 || overIdx === -1) return;
    if (dragIdx < overIdx) over.after(dragging); else over.before(dragging);
  });

  const onPointerUp = async (e) => {
    if (!dragging || e.pointerId !== dragPtrId) return;
    const wasDragged = didDrag;
    dragging.classList.remove('list-tab--dragging');
    const newOrder = getTabs().map((el) => Number(el.dataset.id));
    const oldOrder = state.heads.map((h) => h.id);
    dragging = null; dragPtrId = null; didDrag = false;
    if (!wasDragged) return;
    bar.addEventListener('click', (ev) => ev.stopImmediatePropagation(), { once: true, capture: true });
    if (JSON.stringify(newOrder) === JSON.stringify(oldOrder)) return;
    state.heads.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
    try {
      await api.patch('/lists/heads/reorder', { ids: newOrder });
      vibrate(15);
    } catch (err) {
      window.planner?.showToast(err.message, 'danger');
      state.heads.sort((a, b) => oldOrder.indexOf(a.id) - oldOrder.indexOf(b.id));
      renderHeadTabs(container);
    }
  };

  bar.addEventListener('pointerup', onPointerUp);
  bar.addEventListener('pointercancel', (e) => {
    if (!dragging || e.pointerId !== dragPtrId) return;
    dragging.classList.remove('list-tab--dragging');
    dragging = null; dragPtrId = null; didDrag = false;
    renderHeadTabs(container);
  });
}

// --------------------------------------------------------
// Main render
// --------------------------------------------------------

export async function render(container, { user }) {
  container.innerHTML = `
    <div class="shopping-page">
      <div class="list-tabs-bar" id="list-tabs-bar">
        <div class="skeleton skeleton-line skeleton-line--medium" style="height:36px;width:120px;border-radius:var(--radius-full)"></div>
      </div>
      <div id="list-content" style="flex:1;display:flex;flex-direction:column;overflow:hidden"></div>
    </div>
  `;

  try {
    await loadHeads();
    let chosenId = null;
    const pendingHead = localStorage.getItem('lists-open-head');
    if (pendingHead) {
      localStorage.removeItem('lists-open-head');
      const h = state.heads.find((x) => x.id === Number(pendingHead));
      if (h) chosenId = h.id;
    }
    if (!chosenId && state.heads[0]) chosenId = state.heads[0].id;
    if (chosenId) await loadHead(chosenId);
  } catch (err) {
    console.error('[Lists] init:', err);
    window.planner?.showToast(t('shopping.listsLoadError'), 'danger');
  }

  container.innerHTML = `
    <div class="shopping-page">
      <h1 class="sr-only">${t('shopping.title')}</h1>
      <div class="list-tabs-bar" id="list-tabs-bar"></div>
      <div id="list-content" style="flex:1;display:flex;flex-direction:column;overflow:hidden"></div>
      <div class="fab-container" id="lists-fab">
        <button class="fab-main" id="fab-main" aria-label="${t('shopping.fabMenuLabel')}" aria-expanded="false">
          <i data-lucide="plus" style="width:24px;height:24px" aria-hidden="true"></i>
        </button>
        <div class="fab-actions" id="fab-actions" aria-hidden="true">
          <button class="fab-action__btn" data-fab-action="add-item">
            <i data-lucide="shopping-basket" style="width:18px;height:18px" aria-hidden="true"></i>
            <span>${t('shopping.fabAddItem')}</span>
          </button>
          <button class="fab-action__btn" data-fab-action="new-head">
            <i data-lucide="list-plus" style="width:18px;height:18px" aria-hidden="true"></i>
            <span>${t('shopping.fabNewList')}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  renderHeadTabs(container);
  renderHeadBody(container);
  wireContentEvents(container);
  wireHeadTabDragReorder(container);
  wireFabMenu(container);

  if (localStorage.getItem('lists-create-new')) {
    localStorage.removeItem('lists-create-new');
    container.querySelector('[data-fab-action="new-head"]')?.click();
  }
  if (localStorage.getItem('lists-add-item')) {
    localStorage.removeItem('lists-add-item');
    openAddItemDialog(container);
  }
}

// --------------------------------------------------------
// FAB menu + Add-Item dialog
// --------------------------------------------------------

function wireFabMenu(container) {
  const wrap       = container.querySelector('#lists-fab');
  const main       = container.querySelector('#fab-main');
  const actions    = container.querySelector('#fab-actions');
  if (!wrap || !main || !actions) return;

  const setOpen = (open) => {
    main.setAttribute('aria-expanded', String(open));
    actions.setAttribute('aria-hidden', String(!open));
    wrap.classList.toggle('fab-container--open', open);
  };

  main.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(main.getAttribute('aria-expanded') !== 'true');
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) setOpen(false);
  });

  actions.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-fab-action]');
    if (!btn) return;
    setOpen(false);
    if (btn.dataset.fabAction === 'new-head') {
      const name = await showPrompt(t('shopping.newHeadPrompt'));
      if (!name?.trim()) return;
      try {
        const res = await api.post('/lists/heads', { name: name.trim() });
        state.heads.push(res.data);
        await switchHead(res.data.id, container);
      } catch (err) { window.planner.showToast(err.message, 'danger'); }
    } else if (btn.dataset.fabAction === 'add-item') {
      openAddItemDialog(container);
    }
  });
}

let _addItemDialogOpen = false;
async function openAddItemDialog(container) {
  if (_addItemDialogOpen) return;
  _addItemDialogOpen = true;
  try {
    await _openAddItemDialogInner(container);
  } finally {
    setTimeout(() => { _addItemDialogOpen = false; }, 300);
  }
}

async function _openAddItemDialogInner(container) {
  if (!state.heads.length) {
    window.planner.showToast(t('shopping.noHeadLists'), 'danger');
    return;
  }

  // Fetch all sublists across heads so user can pick any
  let allSublists = [];
  try {
    const res = await api.get('/lists/sublists');
    allSublists = res.data || [];
  } catch (err) {
    window.planner.showToast(err.message, 'danger');
    return;
  }
  if (!allSublists.length) {
    window.planner.showToast(t('shopping.noSublistsHint'), 'danger');
    return;
  }

  const lastUsedSublist = Number(localStorage.getItem('lists-last-sublist')) || allSublists[0].id;
  const defaultSublist  = allSublists.find((s) => s.id === lastUsedSublist) ? lastUsedSublist : allSublists[0].id;

  openModal({
    title: t('shopping.fabAddItem'),
    size: 'sm',
    content: `
      <form id="add-item-form" class="list-dialog">
        <label class="list-dialog__field">
          <span class="list-dialog__label">${t('shopping.addToSublist')}</span>
          <select name="sublist" class="list-dialog__input" autofocus>
            ${allSublists.map((s) => `
              <option value="${s.id}" ${s.id === defaultSublist ? 'selected' : ''}>
                ${esc(s.head_name ? `${s.head_name} › ${s.name}` : s.name)}
              </option>`).join('')}
            <option value="__new__">＋ ${esc(t('shopping.newSublistOption'))}</option>
          </select>
        </label>
        <label class="list-dialog__field" data-new-only hidden>
          <span class="list-dialog__label">${t('shopping.newHeadPrompt')}</span>
          <input type="text" name="newHeadName" class="list-dialog__input">
        </label>
        <label class="list-dialog__field" data-new-only hidden>
          <span class="list-dialog__label">${t('shopping.newSublistPrompt')}</span>
          <input type="text" name="newSubName" class="list-dialog__input">
        </label>
        <label class="list-dialog__field">
          <span class="list-dialog__label">${t('shopping.itemNameLabel')}</span>
          <input type="text" name="name" class="list-dialog__input" required>
        </label>
        <label class="list-dialog__field">
          <span class="list-dialog__label">${t('shopping.itemQtyLabel')}</span>
          <input type="text" name="quantity" class="list-dialog__input" placeholder="${t('shopping.itemQtyPlaceholder')}">
        </label>
        <div class="list-dialog__actions">
          <button type="button" class="btn btn--ghost" data-action="dialog-cancel">${t('shopping.cancel')}</button>
          <button type="submit" class="btn btn--primary">${t('shopping.addItem')}</button>
        </div>
      </form>
    `,
    onSave: (panel) => {
      const form = panel.querySelector('#add-item-form');
      const select = form.querySelector('select[name="sublist"]');
      const newFields = form.querySelectorAll('[data-new-only]');
      const newHeadInput = form.querySelector('input[name="newHeadName"]');
      const newSubInput = form.querySelector('input[name="newSubName"]');
      panel.querySelector('[data-action="dialog-cancel"]').addEventListener('click', () => closeModal());

      const toggleNewFields = () => {
        const show = select.value === '__new__';
        newFields.forEach((el) => { el.hidden = !show; });
        newHeadInput.required = show;
        newSubInput.required = show;
        if (show) newHeadInput.focus();
      };
      select.addEventListener('change', toggleNewFields);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get('name') || '').trim();
        const quantity = String(fd.get('quantity') || '').trim() || null;
        if (!name) return;

        let sublistId;
        try {
          if (select.value === '__new__') {
            const headName = String(fd.get('newHeadName') || '').trim();
            const subName = String(fd.get('newSubName') || '').trim();
            if (!headName || !subName) return;
            const headRes = await api.post('/lists/heads', { name: headName });
            const subRes = await api.post(`/lists/heads/${headRes.data.id}/sublists`, { name: subName });
            sublistId = subRes.data.id;
          } else {
            sublistId = Number(select.value);
          }
          if (!sublistId) return;

          await api.post(`/lists/${sublistId}/items`, { name, quantity });
          localStorage.setItem('lists-last-sublist', String(sublistId));
          closeModal();

          // Reload heads (may include a newly created one) and switch to the
          // head that contains this sublist so the user sees the result.
          await loadHeads();
          const allSubsRes = await api.get('/lists/sublists').catch(() => ({ data: [] }));
          const targetSub = (allSubsRes.data || []).find((s) => s.id === sublistId);
          const targetHeadId = targetSub?.head_list_id ?? state.activeHeadId;
          if (targetHeadId && targetHeadId !== state.activeHeadId) {
            await switchHead(targetHeadId, container);
          } else {
            await loadHead(state.activeHeadId);
            renderHeadTabs(container);
            renderHeadBody(container);
            wireContentEvents(container);
            wireHeadTabDragReorder(container);
          }
          window.planner.showToast(t('shopping.itemAddedToast'));
        } catch (err) {
          window.planner.showToast(err.message, 'danger');
        }
      });
    },
  });
}
