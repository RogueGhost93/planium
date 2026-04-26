/**
 * Module: RRULE UI helpers
 * Purpose: Recurrence form (HTML + logic) for task and calendar modals
 * Dependencies: none
 */

const FREQ_OPTIONS = [
  { value: '',          label: 'No recurrence' },
  { value: 'DAILY',     label: 'Daily' },
  { value: 'WEEKLY',    label: 'Weekly' },
  { value: 'BIWEEKLY',  label: 'Biweekly' },
  { value: 'MONTHLY',   label: 'Monthly' },
  { value: 'YEARLY',    label: 'Yearly' },
];

const WEEKDAYS = [
  { value: 'MO', label: 'Mo' },
  { value: 'TU', label: 'Tu' },
  { value: 'WE', label: 'We' },
  { value: 'TH', label: 'Th' },
  { value: 'FR', label: 'Fr' },
  { value: 'SA', label: 'Sa' },
  { value: 'SU', label: 'Su' },
];

/**
 * Parses an RRULE string into an object for the UI.
 * @param {string|null} rule - e.g. "FREQ=WEEKLY;BYDAY=MO,TH;INTERVAL=2"
 * @returns {{ freq: string, interval: number, byday: string[], until: string }}
 */
export function parseRRule(rule) {
  const result = { freq: '', interval: 1, byday: [], until: '' };
  if (!rule) return result;

  for (const segment of rule.split(';')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const key = segment.slice(0, eq).toUpperCase();
    const val = segment.slice(eq + 1);

    if (key === 'FREQ')     result.freq     = val;
    if (key === 'INTERVAL') result.interval  = parseInt(val, 10) || 1;
    if (key === 'BYDAY')    result.byday     = val.split(',').map(d => d.trim());
    if (key === 'UNTIL') {
      // YYYYMMDD → YYYY-MM-DD
      const c = val.replace(/[TZ]/g, '');
      result.until = `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`;
    }
  }
  if (result.freq === 'WEEKLY' && result.interval === 2) result.freq = 'BIWEEKLY';
  return result;
}

/**
 * Builds an RRULE string from the UI values.
 * @param {{ freq: string, interval: number, byday: string[], until: string }} opts
 * @returns {string|null} - RRULE string or null (no recurrence)
 */
export function buildRRule({ freq, interval, byday, until }) {
  if (!freq) return null;
  if (freq === 'BIWEEKLY') {
    const parts = ['FREQ=WEEKLY', 'INTERVAL=2'];
    if (byday.length > 0) parts.push(`BYDAY=${byday.join(',')}`);
    if (until) parts.push(`UNTIL=${until.replace(/-/g, '')}T235959Z`);
    return parts.join(';');
  }

  const parts = [`FREQ=${freq}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (freq === 'WEEKLY' && byday.length > 0) {
    parts.push(`BYDAY=${byday.join(',')}`);
  }
  if (until) {
    parts.push(`UNTIL=${until.replace(/-/g, '')}T235959Z`);
  }
  return parts.join(';');
}

/**
 * Renders the HTML for the recurrence fields.
 * @param {string} prefix - ID prefix (e.g. "task" or "event")
 * @param {string|null} existingRule - existing RRULE or null
 * @returns {string} HTML string
 */
export function renderRRuleFields(prefix, existingRule) {
  const parsed = parseRRule(existingRule);

  const freqOpts = FREQ_OPTIONS.map(o =>
    `<option value="${o.value}" ${parsed.freq === o.value ? 'selected' : ''}>${o.label}</option>`
  ).join('');

  const dayBtns = WEEKDAYS.map(d =>
    `<button type="button" class="rrule-day ${parsed.byday.includes(d.value) ? 'rrule-day--active' : ''}"
             data-day="${d.value}" aria-label="${d.label}" aria-pressed="${parsed.byday.includes(d.value)}">${d.label}</button>`
  ).join('');

  return `
    <div class="rrule-fields" id="${prefix}-rrule-fields">
      <div class="form-group">
        <label class="label form-label" for="${prefix}-rrule-freq">Recurrence</label>
        <select class="input form-input" id="${prefix}-rrule-freq" style="min-height:44px">
          ${freqOpts}
        </select>
      </div>

      <div class="rrule-details" id="${prefix}-rrule-details" ${parsed.freq ? '' : 'hidden'}>
        <div class="rrule-row" id="${prefix}-rrule-row" ${parsed.freq === 'BIWEEKLY' ? 'hidden' : ''}>
          <div class="form-group" style="margin-bottom:0">
            <label class="label form-label" for="${prefix}-rrule-interval">Every</label>
            <div class="rrule-interval-wrap">
              <input class="input form-input" type="number" id="${prefix}-rrule-interval"
                     min="1" max="99" value="${parsed.interval}" style="width:64px;text-align:center">
              <span class="rrule-interval-unit" id="${prefix}-rrule-unit">${unitLabel(parsed.freq, parsed.interval)}</span>
            </div>
          </div>
        </div>

        <div class="rrule-weekdays" id="${prefix}-rrule-weekdays" ${parsed.freq === 'WEEKLY' || parsed.freq === 'BIWEEKLY' ? '' : 'hidden'}>
          <label class="label form-label">On these days</label>
          <div class="rrule-day-grid">${dayBtns}</div>
        </div>

        <div class="form-group" style="margin-top:var(--space-3)">
          <label class="label form-label" for="${prefix}-rrule-until">Ends on (optional)</label>
          <input class="input form-input" type="date" id="${prefix}-rrule-until" value="${parsed.until}">
        </div>
      </div>
    </div>
  `;
}

function unitLabel(freq, interval) {
  const n = interval > 1;
  if (freq === 'DAILY')     return n ? 'days'   : 'day';
  if (freq === 'WEEKLY')    return n ? 'weeks'  : 'week';
  if (freq === 'BIWEEKLY')  return 'weeks';
  if (freq === 'MONTHLY')   return n ? 'months' : 'month';
  if (freq === 'YEARLY')    return n ? 'years'  : 'year';
  return '';
}

/**
 * Binds events to the RRULE fields (freq change, day toggle, etc.)
 * @param {HTMLElement} root - Container element
 * @param {string} prefix - ID prefix
 */
export function bindRRuleEvents(root, prefix) {
  const freqSelect  = root.querySelector(`#${prefix}-rrule-freq`);
  const details     = root.querySelector(`#${prefix}-rrule-details`);
  const weekdays    = root.querySelector(`#${prefix}-rrule-weekdays`);
  const rruleRow    = root.querySelector(`#${prefix}-rrule-row`);
  const unitEl      = root.querySelector(`#${prefix}-rrule-unit`);
  const intervalEl  = root.querySelector(`#${prefix}-rrule-interval`);

  if (!freqSelect) return;

  freqSelect.addEventListener('change', () => {
    const freq = freqSelect.value;
    if (details)   details.hidden   = !freq;
    if (weekdays)  weekdays.hidden  = freq !== 'WEEKLY' && freq !== 'BIWEEKLY';
    if (rruleRow)  rruleRow.hidden  = freq === 'BIWEEKLY';
    updateUnit();
  });

  intervalEl?.addEventListener('input', updateUnit);

  // Day toggle
  root.querySelectorAll(`#${prefix}-rrule-weekdays .rrule-day`).forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('rrule-day--active');
      btn.setAttribute('aria-pressed', btn.classList.contains('rrule-day--active'));
    });
  });

  function updateUnit() {
    if (!unitEl) return;
    const interval = parseInt(intervalEl?.value, 10) || 1;
    unitEl.textContent = unitLabel(freqSelect.value, interval);
  }
}

/**
 * Liest die aktuellen RRULE-Werte aus dem Formular.
 * @param {HTMLElement} root - Container-Element
 * @param {string} prefix - ID-Prefix
 * @returns {{ is_recurring: boolean, recurrence_rule: string|null }}
 */
export function getRRuleValues(root, prefix) {
  const freq     = root.querySelector(`#${prefix}-rrule-freq`)?.value || '';
  const interval = parseInt(root.querySelector(`#${prefix}-rrule-interval`)?.value, 10) || 1;
  const until    = root.querySelector(`#${prefix}-rrule-until`)?.value || '';

  const byday = [];
  root.querySelectorAll(`#${prefix}-rrule-weekdays .rrule-day--active`).forEach(btn => {
    byday.push(btn.dataset.day);
  });

  const rule = buildRRule({ freq, interval, byday, until });
  return {
    is_recurring:    !!rule,
    recurrence_rule: rule,
  };
}
