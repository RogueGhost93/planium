/**
 * oikos-locale-picker — Sprachauswahl-Web-Component
 * Zeigt Radio-Buttons für System/Deutsch/English.
 * Bei Auswahl: setLocale() oder localStorage-Eintrag löschen (System).
 * Dependencies: i18n.js
 */

import { t, setLocale, getLocale, getSupportedLocales } from '/i18n.js';

const LOCALE_LABELS = {
  de: 'Deutsch',
  en: 'English',
};

class OikosLocalePicker extends HTMLElement {
  connectedCallback() {
    this._render();
    this._onLocaleChanged = () => this._render();
    window.addEventListener('locale-changed', this._onLocaleChanged);
  }

  disconnectedCallback() {
    window.removeEventListener('locale-changed', this._onLocaleChanged);
  }

  _render() {
    this.textContent = '';

    const stored = localStorage.getItem('oikos-locale');

    const wrapper = document.createElement('div');
    wrapper.className = 'locale-picker';

    // System-Option
    const systemOption = this._createOption(
      'system',
      t('settings.localeSystem'),
      !stored,
      () => {
        localStorage.removeItem('oikos-locale');
        location.reload();
      }
    );
    wrapper.appendChild(systemOption);

    // Sprach-Optionen
    for (const locale of getSupportedLocales()) {
      const option = this._createOption(
        locale,
        LOCALE_LABELS[locale] || locale,
        stored === locale,
        () => setLocale(locale)
      );
      wrapper.appendChild(option);
    }

    this.appendChild(wrapper);
  }

  _createOption(value, label, checked, onChange) {
    const item = document.createElement('label');
    item.className = 'locale-picker__option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'locale';
    radio.value = value;
    radio.checked = checked;
    radio.addEventListener('change', onChange);

    const span = document.createElement('span');
    span.textContent = label;

    item.appendChild(radio);
    item.appendChild(span);
    return item;
  }
}

customElements.define('oikos-locale-picker', OikosLocalePicker);
