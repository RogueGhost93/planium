# Modul-Akzentfarben stärker nutzen — Design Spec

**Date:** 2026-03-31
**Status:** Approved

## Ziel

Die vorhandenen `--module-*` CSS-Tokens (Dashboard=Blau, Tasks=Grün, Kalender=Violett, Mahlzeiten=Orange, Einkauf=Rot-Orange, Notizen=Gold, Kontakte=Kräftiges Blau, Budget=Teal) werden aktuell nur für die FAB-Hintergrundfarbe genutzt. Ziel: drei weitere visuelle Ebenen mit Modul-Akzenten versehen, damit der Nutzer sofort erkennt, in welchem Modul er sich befindet.

## Drei Änderungsbereiche

### A — Aktiver Tab in Navigation (Bottom-Nav + Sidebar)

**Problem:** `--module-accent` ist auf dem Page-Wrapper gesetzt (z. B. `.tasks-page`), aber die Nav-Bar liegt im App-Shell außerhalb dieser Wrapper. CSS-Kaskade funktioniert nicht.

**Lösung — JS:** In `updateNav(path)` (router.js) wird nach dem Setzen von `aria-current` zusätzlich `--active-module-accent` als CSS Custom Property auf `document.documentElement` geschrieben:

```js
const module = ROUTES.find(r => r.path === path)?.module;
const accent = module ? getCSSToken(`--module-${module}`) : '';
document.documentElement.style.setProperty('--active-module-accent', accent || '');
```

**Lösung — CSS** (layout.css): Alle drei Stellen, die aktuell `var(--color-accent)` für den aktiven Nav-State nutzen, werden auf `var(--active-module-accent, var(--color-accent))` umgestellt:

1. `.nav-item[aria-current="page"] { color: ... }` — Bottom-Nav Icon + Label
2. `.nav-sidebar .nav-item[aria-current="page"] { color: ...; background-color: ... }` — Sidebar Highlight
3. `.nav-sidebar .nav-item[aria-current="page"]::before { background: ... }` — Sidebar linker Akzentstreifen

Das Fallback `var(--color-accent)` stellt sicher, dass Login-Screen und Fehlerseiten ohne Modul-Kontext korrekt dargestellt werden.

---

### B — Seitenkopf-Streifen (3px border-top)

`border-top: 3px solid var(--module-accent)` wird auf den Toolbar/Header-Selektor jedes Moduls gesetzt. Da diese Elemente innerhalb des Page-Wrappers liegen, erben sie `--module-accent` direkt.

| Modul | Selektor | CSS-Datei |
|-------|----------|-----------|
| Tasks | `.tasks-toolbar` | tasks.css |
| Notizen | `.notes-toolbar` | notes.css |
| Kontakte | `.contacts-toolbar` | contacts.css |
| Kalender | `.cal-toolbar` | calendar.css |
| Einkauf | `.list-header` | shopping.css |
| Budget | `.budget-list-header` | budget.css |
| Mahlzeiten | — | entfällt (kein Toolbar) |
| Dashboard | — | entfällt (Widget-Grid, kein Toolbar) |

---

### C — Karten-Randstreifen (3px border-left)

`border-left: 3px solid var(--module-accent)` auf den Hauptkarten-/Zeilen-Elementen. Der linke `border-radius` wird auf `0` gesetzt damit der Streifen sauber anliegt (`border-radius: 0 var(--radius-md) var(--radius-md) 0`).

| Modul | Selektor | CSS-Datei | Bemerkung |
|-------|----------|-----------|-----------|
| Tasks | `.task-card` | tasks.css | |
| Einkauf | `.shopping-item` | shopping.css | |
| Kontakte | `.contact-item` | contacts.css | |
| Budget | `.budget-entry` | budget.css | Hat bereits Einnahmen/Ausgaben-Dot — kein Konflikt |
| Kalender | ❌ | — | Eigene Event-Farblogik |
| Notizen | ❌ | — | Eigene Karten-Hintergrundfarben |
| Mahlzeiten | ❌ | — | Slot-Layout, keine klassische Liste |
| Dashboard | ❌ | — | Widget-Struktur |

---

## Out of Scope

- Kein Umbau des Farbsystems oder der Token-Namen
- Kein Dark-Mode-spezifisches Anpassen (Dark-Mode-Tokens für `--module-*` existieren bereits in tokens.css)
- Keine neuen Modul-Farben
- Keine Änderungen an Meals, Dashboard, Calendar-Events, Notes-Karten
