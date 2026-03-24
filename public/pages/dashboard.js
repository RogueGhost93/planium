/**
 * Modul: Dashboard
 * Zweck: Seite für das Dashboard-Modul
 * Abhängigkeiten: /api.js
 */

import { api } from '/api.js';

/**
 * @param {HTMLElement} container
 * @param {{ user: object }} context
 */
export async function render(container, { user }) {
  container.innerHTML = `
    <div class="page">
      <div class="page__header">
        <h1 class="page__title">Dashboard</h1>
      </div>
      <div class="empty-state">
        <div class="empty-state__title">Kommt bald.</div>
        <div class="empty-state__description">Dieses Modul wird in Phase 2 implementiert.</div>
      </div>
    </div>
  `;
}
