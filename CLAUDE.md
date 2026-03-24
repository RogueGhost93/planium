# CLAUDE.md — Familienplaner Web-App „Oikos"

<role>
Du bist ein Senior Full-Stack-Entwickler mit Expertise in Self-Hosted Web-Apps, Progressive Web Apps, Datenbankdesign und UX/UI-Design. Du arbeitest methodisch in klar abgegrenzten Phasen und lieferst produktionsreifen, dokumentierten Code.
</role>

<project_context>
Selbstgehostete Familienplaner-Web-App mit dem Namen "Oikos" für eine einzelne Familie (2–6 Personen). Kein App-Store, kein öffentlicher Zugang. Deployment via Docker auf einem privaten Linux-Server hinter Nginx Reverse Proxy mit SSL. Die App wird ausschließlich über den Browser auf Android, iOS und Desktop genutzt.
</project_context>

---

## ARCHITEKTUR-ENTSCHEIDUNGEN

<tech_stack>
### Backend
- **Runtime:** Node.js (LTS)
- **Framework:** Express.js (minimalistisch, nur Routing + Middleware)
- **Datenbank:** SQLite mit **better-sqlite3** + **SQLCipher** (Verschlüsselung at rest)
- **Auth:** Session-basiert mit **bcrypt** (Passwort-Hashing) + **express-session** mit SQLite-Session-Store
- **API-Design:** RESTful JSON-API, alle Routen unter `/api/v1/`
- **Kalender-Sync:** CalDAV-Client-Library für Google Calendar / Apple Calendar Integration
- **Wetter-API:** OpenWeatherMap Free Tier (serverseitiger Proxy, API-Key nie im Frontend)

### Frontend
- **Kein Build-Step.** Kein React, kein Vue, kein Webpack, kein Bundler.
- **Vanilla JavaScript** mit ES-Modulen (`type="module"`)
- **Web Components** (Custom Elements) für wiederverwendbare UI-Komponenten
- **CSS:** Custom Properties (Design Tokens), CSS Grid + Flexbox, Container Queries
- **Interaktivität:** Alpine.js (optional, ~15kb, CDN-Einbindung, kein Build nötig) — NUR wenn DOM-Manipulation in Vanilla JS zu verbose wird
- **Icons:** Lucide Icons (SVG, CDN)
- **PWA:** Service Worker für Offline-Grundfunktionalität, Web App Manifest für „Add to Homescreen"

### Deployment
- **Docker Compose:** Ein Container für die App (Node.js), Volumes für SQLite-DB und Uploads
- **Reverse Proxy:** Konfiguration für Nginx Proxy Manager (Beispiel-Config mitliefern)
- **Umgebungsvariablen:** `.env`-Datei für alle Secrets (DB-Passwort, API-Keys, Session-Secret)
</tech_stack>

<architecture_principles>
1. **Single-Page-Application-Verhalten** ohne SPA-Framework: Client-seitiges Routing über History API mit einem leichtgewichtigen eigenen Router (~50 Zeilen).
2. **API-First:** Jedes Modul hat eine saubere REST-API. Das Frontend ist ein reiner API-Consumer.
3. **Mobile-First Design:** Alle Layouts zuerst für 375px Breite entwerfen, dann nach oben skalieren.
4. **Offline-Tolerant:** Service Worker cached App-Shell. Daten werden bei Reconnect synchronisiert.
5. **Keine Telemetrie, kein Tracking, keine externen Fonts.** Alles self-contained.
</architecture_principles>

---

## DATENMODELL

<database_schema>
Entwirf das Schema nach diesen Entitäten. Jede Tabelle bekommt `id` (INTEGER PRIMARY KEY), `created_at`, `updated_at` (ISO 8601 Timestamps).

### Users
- `username` (UNIQUE, NOT NULL)
- `display_name`
- `password_hash` (bcrypt)
- `avatar_color` (HEX — für farbliche Zuordnung im UI)
- `role` (ENUM: 'admin', 'member') — Admin kann Familienmitglieder verwalten

### Tasks (Aufgaben-Modul)
- `title` (NOT NULL)
- `description` (Notizfeld, TEXT)
- `category` (z.B. Haushalt, Schule, Einkauf, Reparatur, Sonstiges)
- `priority` (ENUM: 'low', 'medium', 'high', 'urgent')
- `status` (ENUM: 'open', 'in_progress', 'done')
- `due_date` (DATE, nullable)
- `due_time` (TIME, nullable)
- `assigned_to` (FK → Users.id, nullable)
- `created_by` (FK → Users.id)
- `is_recurring` (BOOLEAN)
- `recurrence_rule` (TEXT, nullable — iCal RRULE Format, z.B. `FREQ=WEEKLY;BYDAY=MO,TH`)
- `parent_task_id` (FK → Tasks.id, nullable — für Teilaufgaben)

### Shopping Lists (Einkaufslisten-Modul)
- `name` (z.B. "Wocheneinkauf", "Baumarkt")

### Shopping Items
- `list_id` (FK → Shopping Lists.id)
- `name` (NOT NULL)
- `quantity` (TEXT, z.B. "500g", "2 Stück")
- `category` (ENUM: 'Obst & Gemüse', 'Milchprodukte', 'Fleisch & Fisch', 'Backwaren', 'Getränke', 'Tiefkühl', 'Haushalt', 'Drogerie', 'Sonstiges')
- `is_checked` (BOOLEAN)
- `added_from_meal` (FK → Meals.id, nullable — Herkunft aus Essensplan)

### Meals (Essensplan-Modul)
- `date` (DATE, NOT NULL)
- `meal_type` (ENUM: 'breakfast', 'lunch', 'dinner', 'snack')
- `title` (NOT NULL, z.B. "Spaghetti Bolognese")
- `notes` (TEXT, nullable)
- `created_by` (FK → Users.id)

### Meal Ingredients
- `meal_id` (FK → Meals.id)
- `name` (NOT NULL)
- `quantity` (TEXT, nullable)
- `on_shopping_list` (BOOLEAN — wurde bereits auf Einkaufsliste übernommen?)

### Calendar Events (Kalender-Modul)
- `title` (NOT NULL)
- `description` (TEXT, nullable)
- `start_datetime` (DATETIME, NOT NULL)
- `end_datetime` (DATETIME, nullable)
- `all_day` (BOOLEAN)
- `location` (TEXT, nullable)
- `color` (HEX — visuelle Kategorie)
- `assigned_to` (FK → Users.id, nullable)
- `created_by` (FK → Users.id)
- `external_calendar_id` (TEXT, nullable — ID aus Google/Apple Calendar)
- `external_source` (ENUM: 'local', 'google', 'apple')
- `recurrence_rule` (TEXT, nullable — iCal RRULE)

### Notes (Pinnwand-Modul)
- `title` (nullable)
- `content` (TEXT, NOT NULL)
- `color` (HEX — Sticky-Note-Farbe)
- `pinned` (BOOLEAN)
- `created_by` (FK → Users.id)

### Contacts (Wichtige Kontakte)
- `name` (NOT NULL)
- `category` (ENUM: 'Arzt', 'Schule/Kita', 'Behörde', 'Versicherung', 'Handwerker', 'Notfall', 'Sonstiges')
- `phone` (TEXT, nullable)
- `email` (TEXT, nullable)
- `address` (TEXT, nullable)
- `notes` (TEXT, nullable)

### Budget Entries (Budget-Tracker)
- `title` (NOT NULL)
- `amount` (REAL, NOT NULL — positiv = Einnahme, negativ = Ausgabe)
- `category` (ENUM: 'Lebensmittel', 'Miete', 'Versicherung', 'Mobilität', 'Freizeit', 'Kleidung', 'Gesundheit', 'Bildung', 'Sonstiges')
- `date` (DATE, NOT NULL)
- `is_recurring` (BOOLEAN)
- `recurrence_rule` (TEXT, nullable)
- `created_by` (FK → Users.id)
</database_schema>

---

## MODULE — FUNKTIONALE SPEZIFIKATIONEN

<module_dashboard>
### Dashboard (Startseite)
**Route:** `/`

**Layout:** Responsive Grid (1 Spalte mobil, 2 Spalten Tablet, 3 Spalten Desktop).

**Widgets:**
1. **Begrüßung** — "Guten [Morgen/Tag/Abend], [Name]" mit aktuellem Datum
2. **Wetter-Widget** — Aktuelles Wetter + 3-Tage-Vorschau. Standort konfigurierbar in Settings. Daten vom Backend-Proxy (OpenWeatherMap). Refresh alle 30 Minuten. Fallback bei API-Fehler: Widget ausblenden, kein Error-Screen.
3. **Anstehende Termine** — Nächste 3–5 Termine aus dem Kalender-Modul. Farbcodiert nach Person. Klick → Kalender-Modul.
4. **Dringende Aufgaben** — Aufgaben mit `priority: urgent/high` UND `due_date` innerhalb der nächsten 48h. Sortiert nach Fälligkeit. Klick → Aufgaben-Modul.
5. **Heutiges Essen** — Mahlzeiten für heute aus dem Essensplan. Zeigt Titel + Meal-Type. Klick → Essensplan-Modul.
6. **Pinnwand-Vorschau** — Letzte 2–3 angepinnte Notizen. Klick → Pinnwand.
7. **Schnellaktionen** — Floating Action Button (FAB) mit: + Aufgabe, + Termin, + Einkaufslisteneintrag, + Notiz.

**Design-Vorgaben:**
- Widgets als Cards mit `border-radius: 12px`, subtiler `box-shadow`
- Farbschema: Neutraler Hintergrund (`#F5F5F7`), Cards weiß, Akzentfarbe konfigurierbar
- Smooth Scroll, keine abrupten Übergänge
- Skeleton-Loading-States während API-Calls (keine Spinner)
</module_dashboard>

<module_tasks>
### Aufgaben-Modul
**Route:** `/tasks`

**Ansichten:**
1. **Listenansicht** (Standard) — Gruppiert nach Kategorie ODER Fälligkeit (umschaltbar). Filter: Person, Priorität, Status.
2. **Kanban-Ansicht** — Spalten: Offen → In Bearbeitung → Erledigt. Drag & Drop zum Statuswechsel.

**Funktionen:**
- CRUD für Aufgaben + Teilaufgaben (beliebig verschachtelbar, max. 2 Ebenen)
- Zuweisung an Familienmitglied (Avatar-Farbe als Indikator)
- Dringlichkeitsstufen visuell durch Farbe/Icon codiert
- Wiederkehrende Aufgaben: Bei Erledigung wird automatisch die nächste Instanz erstellt
- Swipe-Gesten auf Mobil: Links = erledigt, Rechts = bearbeiten
- Benachrichtigung (In-App-Badge) bei überfälligen Aufgaben

**Teilaufgaben:**
- Checkbox-Liste innerhalb einer Aufgabe
- Fortschrittsbalken (z.B. 3/5 Teilaufgaben erledigt)
- Eigene Notiz pro Teilaufgabe
</module_tasks>

<module_shopping>
### Einkaufslisten-Modul
**Route:** `/shopping`

**Funktionen:**
- Mehrere Listen parallel (z.B. "REWE", "dm", "Baumarkt")
- Artikel mit Kategorie, Menge, Checkbox
- Automatische Gruppierung nach Kategorie (Supermarkt-Gang-Logik)
- **Essensplan-Integration:** Button "Zutaten auf Einkaufsliste" im Essensplan → Zutaten werden mit Quell-Referenz übernommen
- Erledigte Artikel werden durchgestrichen, nach unten sortiert
- "Liste leeren" entfernt nur abgehakte Artikel
- Artikel-Vorschläge basierend auf bisherigen Einträgen (lokaler Autocomplete, kein externer Service)
</module_shopping>

<module_mealplan>
### Essensplan-Modul
**Route:** `/meals`

**Layout:** Wochenansicht (Mo–So), jeder Tag mit Slots für Frühstück/Mittag/Abend/Snack.

**Funktionen:**
- Mahlzeit eintragen: Titel + optionale Notizen + Zutatenliste
- Zutaten pro Mahlzeit erfassen (Name + Menge)
- **Button "→ Einkaufsliste":** Überträgt alle nicht-abgehakten Zutaten der aktuellen Woche auf eine wählbare Einkaufsliste. Bereits übertragene Zutaten werden markiert.
- Wochennavigation (vor/zurück)
- Mahlzeiten per Drag & Drop zwischen Tagen/Slots verschieben
- Vergangene Mahlzeiten als Vorschläge beim Tippen (Autocomplete aus Historie)
</module_mealplan>

<module_calendar>
### Familienkalender-Modul
**Route:** `/calendar`

**Ansichten:**
1. **Monatsansicht** (Standard) — Tage mit Punkt-Indikatoren für Termine
2. **Wochenansicht** — Stundenraster mit Terminblöcken
3. **Tagesansicht** — Detaillierte Timeline
4. **Agenda-Ansicht** — Chronologische Liste aller kommenden Termine

**Funktionen:**
- CRUD für Termine (Titel, Beschreibung, Start/Ende, Ganztägig, Ort, Farbe, Zuweisung)
- Farbcodierung pro Person (Avatar-Farbe aus User-Profil)
- Wiederkehrende Termine (iCal RRULE)
- **Kalender-Sync:**
  - **Google Calendar:** OAuth 2.0 → Google Calendar API v3. Zwei-Wege-Sync.
  - **Apple Calendar (iCloud):** CalDAV-Protokoll. Zwei-Wege-Sync.
  - Sync-Intervall konfigurierbar (Standard: alle 15 Minuten)
  - Externe Termine visuell unterscheidbar (dezenter Badge/Icon)
  - Konflikte: Externes Event gewinnt bei Änderungen, lokale Ergänzungen bleiben erhalten
</module_calendar>

<module_notes>
### Pinnwand / Notizen-Modul
**Route:** `/notes`

**Layout:** Masonry-Grid (Pinterest-Style) mit farbigen Sticky Notes.

**Funktionen:**
- CRUD für Notizen (Titel optional, Inhalt, Farbe wählbar)
- Anpinnen (erscheint oben + auf Dashboard)
- Ersteller wird angezeigt (Avatar-Farbe)
- Markdown-Light im Inhalt (fett, kursiv, Listen — kein Full-Markdown-Parser nötig, regex-basiert)
</module_notes>

<module_contacts>
### Wichtige Kontakte
**Route:** `/contacts`

**Funktionen:**
- CRUD für Kontakte mit Kategorie-Filter
- Telefonnummer als `tel:`-Link (direkter Anruf auf Mobil)
- E-Mail als `mailto:`-Link
- Adresse als Link zu Google Maps / Apple Maps (User-Agent-Detection)
- Suchfeld mit Echtzeit-Filter
</module_contacts>

<module_budget>
### Budget-Tracker
**Route:** `/budget`

**Ansichten:**
1. **Monatsübersicht** — Einnahmen vs. Ausgaben, Saldo. Balkendiagramm nach Kategorie (Canvas-basiert, keine Chart-Library).
2. **Transaktionsliste** — Chronologisch, filterbar nach Kategorie/Monat.

**Funktionen:**
- CRUD für Einträge (Titel, Betrag, Kategorie, Datum)
- Wiederkehrende Buchungen (Miete, Gehalt, Abos)
- Monatsvergleich (aktueller vs. Vormonat)
- Export als CSV
</module_budget>

---

## AUTHENTIFIZIERUNG & SICHERHEIT

<security>
1. **Login-Screen:** Username + Passwort. Kein öffentlicher Registrierungs-Endpoint. Neue User werden nur durch Admin erstellt.
2. **Passwort-Hashing:** bcrypt mit Cost Factor 12.
3. **Sessions:** `express-session` mit `httpOnly`, `secure`, `sameSite: strict` Cookies. Session-Timeout: 7 Tage.
4. **CSRF-Protection:** Double Submit Cookie Pattern.
5. **Rate Limiting:** 5 Login-Versuche pro Minute pro IP, danach 15min Sperre.
6. **Datenbank-Verschlüsselung:** SQLCipher (AES-256-CBC). Schlüssel aus `.env`.
7. **Input Validation:** Alle API-Inputs serverseitig validieren. Kein `eval()`, kein `innerHTML` mit User-Input.
8. **Content Security Policy:** Strikte CSP-Header. Nur eigene Ressourcen + explizit erlaubte CDNs.
9. **HTTPS-only:** App setzt `Strict-Transport-Security` Header. Redirect HTTP → HTTPS.
</security>

---

## UI/UX DESIGN-SYSTEM

<design_system>
### Farben (CSS Custom Properties)
```css
:root {
  /* Neutrals */
  --color-bg: #F5F5F7;
  --color-surface: #FFFFFF;
  --color-border: #E5E5EA;
  --color-text-primary: #1C1C1E;
  --color-text-secondary: #8E8E93;

  /* Akzent (konfigurierbar pro Installation) */
  --color-accent: #007AFF;
  --color-accent-light: #E3F2FF;

  /* Semantisch */
  --color-success: #34C759;
  --color-warning: #FF9500;
  --color-danger: #FF3B30;
  --color-info: #5AC8FA;

  /* Prioritäten */
  --color-priority-low: #8E8E93;
  --color-priority-medium: #FF9500;
  --color-priority-high: #FF6B35;
  --color-priority-urgent: #FF3B30;

  /* Schatten */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.1);
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);

  /* Radien */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;

  /* Typografie */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', monospace;
}

/* Dark Mode */
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #1C1C1E;
    --color-surface: #2C2C2E;
    --color-border: #3A3A3C;
    --color-text-primary: #F5F5F7;
    --color-text-secondary: #8E8E93;
  }
}
```

### Typografie
- Überschriften: System Font Stack, font-weight 600–700
- Body: 16px (mobile), 15px (desktop), line-height 1.5
- Small/Caption: 13px, `color: var(--color-text-secondary)`

### Komponenten-Standards
- **Cards:** `background: var(--color-surface)`, `border-radius: var(--radius-md)`, `box-shadow: var(--shadow-sm)`
- **Buttons:** Primär = `var(--color-accent)` + weiße Schrift. Sekundär = Outline. Mindesthöhe 44px (Touch-Target).
- **Inputs:** `border-radius: var(--radius-sm)`, `border: 1.5px solid var(--color-border)`, `padding: 12px 16px`
- **Navigation:** Bottom Tab Bar auf Mobil (5 Tabs: Dashboard, Aufgaben, Kalender, Essen, Mehr). Sidebar auf Desktop.
- **Übergänge:** `transition: all 0.2s ease` für interaktive Elemente. Seiten-Übergänge: Slide-Animation.
- **Leer-Zustände:** Jede Liste/Ansicht hat einen illustrierten Empty State mit Call-to-Action.
- **Touch:** Haptic Feedback wo möglich (`navigator.vibrate`). Pull-to-Refresh auf Listen.

### Responsive Breakpoints
- Mobil: < 768px (1 Spalte, Bottom Nav)
- Tablet: 768px–1024px (2 Spalten, Bottom Nav)
- Desktop: > 1024px (Sidebar + Content Area)
</design_system>

---

## ENTWICKLUNGSPLAN — PHASENSTRUKTUR

<development_phases>
### Phase 1: Fundament
1. Projektstruktur anlegen (Verzeichnisse, package.json, .env.example, .gitignore)
2. Express-Server mit grundlegendem Routing-Setup
3. SQLite + SQLCipher Datenbankverbindung + Schema-Migration
4. Auth-System (Login, Session, User-CRUD für Admin)
5. Frontend App-Shell (SPA-Router, Navigation, Layout-Gerüst)
6. CSS Design-System (Custom Properties, Basis-Komponenten)
7. Docker Compose + Nginx-Config

### Phase 2: Kern-Module
8. Dashboard (Layout + Widget-Slots, zunächst mit Platzhaltern)
9. Aufgaben-Modul (CRUD + Listenansicht + Teilaufgaben)
10. Einkaufslisten-Modul (CRUD + Kategorien + Checkbox-Logik)
11. Essensplan-Modul (Wochenansicht + CRUD + Zutaten)
12. Essensplan → Einkaufsliste Integration

### Phase 3: Kalender & Erweiterungen
13. Kalender-Modul (lokale Termine, Monats-/Wochen-/Tagesansicht)
14. Google Calendar OAuth + Sync
15. Apple Calendar CalDAV + Sync
16. Pinnwand-Modul
17. Kontakte-Modul
18. Budget-Tracker

### Phase 4: Polish & Integration
19. Dashboard-Widgets mit Live-Daten verbinden
20. Wetter-Widget (OpenWeatherMap-Integration)
21. Wiederkehrende Aufgaben + Termine (RRULE-Engine)
22. Kanban-Ansicht für Aufgaben
23. Dark Mode
24. PWA (Service Worker, Manifest, Offline-Shell)
25. Drag & Drop (Aufgaben, Essensplan)
26. Swipe-Gesten (Mobil)

### Phase 5: Härtung
27. Input-Validation + Sanitization auf allen Endpoints
28. CSRF-Protection
29. Rate Limiting
30. CSP-Header + Security-Audit
31. Error Handling (globaler Error Boundary im Frontend, strukturierte Fehler-API)
32. Performance-Optimierung (Lazy Loading, Caching-Strategie)
33. README.md mit Setup-Anleitung
</development_phases>

---

## ANWEISUNGEN FÜR CLAUDE CODE

<execution_rules>
1. **Arbeite Phase für Phase.** Beginne keine neue Phase, bevor die aktuelle Phase vollständig funktioniert und getestet ist.
2. **Jede Datei bekommt einen Header-Kommentar:** Zweck, Modul-Zugehörigkeit, Abhängigkeiten.
3. **Kein toter Code.** Keine auskommentierten Blöcke, keine TODO-Kommentare ohne zugehörige GitHub-Issue-Referenz.
4. **API-Endpoints:** Dokumentiere jeden Endpoint inline als JSDoc-Kommentar mit Route, Method, Body, Response-Schema.
5. **Fehlerbehandlung:** Jeder API-Endpoint hat try/catch. Fehler werden als `{ error: string, code: number }` zurückgegeben.
6. **Frontend-Komponenten:** Jede Web Component ist eine eigene Datei in `/public/components/`. Naming: `fb-[modul]-[name].js` (z.B. `fb-task-card.js`).
7. **CSS:** Eine globale `styles.css` mit Design Tokens + Reset. Pro Modul eine eigene CSS-Datei. Kein Inline-Styling.
8. **Dateistruktur:**
```
/oikos
├── server/
│   ├── index.js              (Express Entry Point)
│   ├── db.js                 (SQLite/SQLCipher Setup + Migrations)
│   ├── auth.js               (Auth Middleware + Routes)
│   ├── routes/
│   │   ├── tasks.js
│   │   ├── shopping.js
│   │   ├── meals.js
│   │   ├── calendar.js
│   │   ├── notes.js
│   │   ├── contacts.js
│   │   ├── budget.js
│   │   └── weather.js
│   └── services/
│       ├── google-calendar.js
│       ├── apple-calendar.js
│       └── recurrence.js     (RRULE-Parser/Generator)
├── public/
│   ├── index.html            (App Shell)
│   ├── router.js             (Client-Side Router)
│   ├── api.js                (Fetch-Wrapper mit Auth + Error Handling)
│   ├── styles/
│   │   ├── tokens.css
│   │   ├── reset.css
│   │   ├── layout.css
│   │   └── [modul].css
│   ├── components/
│   │   ├── fb-app-shell.js
│   │   ├── fb-nav-bar.js
│   │   ├── fb-dashboard.js
│   │   ├── fb-task-*.js
│   │   ├── fb-shopping-*.js
│   │   ├── fb-meal-*.js
│   │   ├── fb-calendar-*.js
│   │   ├── fb-notes-*.js
│   │   ├── fb-contacts-*.js
│   │   └── fb-budget-*.js
│   ├── pages/
│   │   ├── dashboard.js
│   │   ├── tasks.js
│   │   ├── shopping.js
│   │   ├── meals.js
│   │   ├── calendar.js
│   │   ├── notes.js
│   │   ├── contacts.js
│   │   ├── budget.js
│   │   ├── settings.js
│   │   └── login.js
│   ├── sw.js                 (Service Worker)
│   └── manifest.json
├── docker-compose.yml
├── Dockerfile
├── nginx.conf.example
├── .env.example
├── package.json
└── README.md
```
9. **Keine externen Abhängigkeiten im Frontend** außer: Lucide Icons (CDN), optional Alpine.js (CDN).
10. **Backend-Dependencies** minimieren: `express`, `better-sqlite3`, `bcrypt`, `express-session`, `express-rate-limit`, `helmet`, `dotenv`. Für Kalender-Sync: `node-fetch`, `googleapis` (Google), `tsdav` (CalDAV).
11. **Deutsche UI-Texte.** Alle Labels, Buttons, Meldungen auf Deutsch. Datumsformate: `DD.MM.YYYY`, Uhrzeiten: `HH:MM` (24h).
12. **Bei Architektur-Unklarheiten:** Nicht raten. Frage nach. Dokumentiere die Entscheidung als Kommentar.
</execution_rules>

---

## QUALITÄTSKRITERIEN

<success_criteria>
- [ ] App startet mit `docker compose up` ohne manuelle Schritte außer `.env` konfigurieren
- [ ] Login funktioniert, Session bleibt über Browser-Neustart erhalten
- [ ] Alle 8 Module (Dashboard, Aufgaben, Einkauf, Essen, Kalender, Pinnwand, Kontakte, Budget) sind CRUD-funktional
- [ ] Essensplan-Zutaten können auf Einkaufsliste übernommen werden
- [ ] Dashboard zeigt Live-Daten aus allen relevanten Modulen
- [ ] Wetter-Widget zeigt aktuelle Daten
- [ ] App ist auf iPhone SE (375px) voll bedienbar
- [ ] Dark Mode funktioniert systemgesteuert
- [ ] Datenbank ist verschlüsselt (SQLCipher)
- [ ] Kein API-Endpoint ist ohne Auth erreichbar (außer Login)
- [ ] Lighthouse Mobile Score: Performance > 85, Accessibility > 90, Best Practices > 90
- [ ] Google Calendar Sync funktioniert bidirektional
</success_criteria>
