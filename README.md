<div align="center">

# 🏠 Oikos

**Selbstgehosteter Familienplaner — privat, offen, ohne Abonnement**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com)
[![SQLite](https://img.shields.io/badge/SQLite-SQLCipher%20verschlüsselt-003B57?logo=sqlite&logoColor=white)](https://www.zetetic.net/sqlcipher/)
[![PWA](https://img.shields.io/badge/PWA-offline--fähig-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-yellow.svg)](./LICENSE)

Alle Daten bleiben auf deinem eigenen Server.
Kein Cloud-Zwang. Keine Datenweitergabe. Kein Tracking.

[Module](#module) · [Schnellstart](#schnellstart) · [Konfiguration](#konfiguration) · [Kalender-Sync](#kalender-synchronisation) · [Sicherheit](#sicherheit)

</div>

---

## Module

| | Modul | Highlights |
|---|---|---|
| 📋 | **Dashboard** | Wetter-Widget, anstehende Termine, dringende Aufgaben, Essen heute, Pinnwand-Vorschau |
| ✅ | **Aufgaben** | Listenansicht + Kanban, Teilaufgaben, Swipe-Gesten, wiederkehrende Aufgaben (RRULE) |
| 🛒 | **Einkauf** | Mehrere Listen, automatische Kategorie-Sortierung, Integration mit Essensplan |
| 🍽️ | **Essensplan** | Wochenansicht, Zutatenverwaltung, Zutaten → Einkaufsliste mit einem Klick |
| 📅 | **Kalender** | Monats-/Wochen-/Tages-/Agenda-Ansicht, Google Calendar & Apple Calendar Sync |
| 📌 | **Pinnwand** | Farbige Sticky Notes, Markdown-Light (fett, kursiv, Listen) |
| 👥 | **Kontakte** | Wichtige Familien-Kontakte, Direktanruf (`tel:`), Maps-Links |
| 💰 | **Budget** | Einnahmen/Ausgaben, Kategorien, Monatsvergleich, CSV-Export |
| ⚙️ | **Einstellungen** | Passwort ändern, Kalender-Sync verwalten, Familienmitglieder anlegen |

---

## Tech Stack

**Backend:** Node.js · Express · SQLite/SQLCipher · express-session · bcrypt

**Frontend:** Vanilla JavaScript (ES-Module) · Kein Framework · Kein Build-Step

**Deployment:** Docker · Nginx Reverse Proxy · PWA (Service Worker + Manifest)

**Optional:** Google Calendar API v3 (OAuth 2.0) · Apple iCloud CalDAV (tsdav)

---

## Schnellstart

### Voraussetzungen

- **Docker** + **Docker Compose**
- Ein Linux-Server mit Nginx Reverse Proxy und SSL (empfohlen: [Nginx Proxy Manager](https://nginxproxymanager.com))

### 1 — Repository klonen

```bash
git clone https://github.com/ulsklyc/oikos.git
cd oikos
```

### 2 — Umgebungsvariablen setzen

```bash
cp .env.example .env
```

Mindestens diese zwei Pflichtfelder in `.env` ausfüllen:

```env
# Langen zufälligen String (≥ 32 Zeichen)
SESSION_SECRET=...

# AES-256-Schlüssel für SQLCipher-Datenbankverschlüsselung
DB_ENCRYPTION_KEY=...
```

> Vollständige Variablen-Referenz → [Konfiguration](#konfiguration)

### 3 — Container starten

```bash
docker compose up -d
```

> Der erste Build dauert 2–3 Minuten (SQLCipher wird gegen better-sqlite3 kompiliert).

### 4 — Admin-Account anlegen

```bash
docker compose exec oikos node setup.js
```

Das interaktive Script fragt nach Benutzername, Anzeigename und Passwort. Dieser Account hat Admin-Rechte und kann weitere Familienmitglieder anlegen.

### 5 — App öffnen

`http://localhost:3000` — oder die konfigurierte Domain nach dem Nginx-Setup.

---

## Nginx Reverse Proxy

Die Datei [`nginx.conf.example`](./nginx.conf.example) enthält eine vollständige Konfiguration.

**Mit Nginx Proxy Manager:**

1. Neuen Proxy Host anlegen: `oikos.deine-domain.de` → `localhost:3000`
2. SSL-Zertifikat via Let's Encrypt ausstellen
3. Inhalt aus `nginx.conf.example` im Feld "Advanced" eintragen

**Wichtig:** `X-Forwarded-Proto` muss gesetzt sein (in der Vorlage enthalten), damit Session-Cookies in Produktion korrekt als `Secure` gesetzt werden.

---

## Konfiguration

### Pflicht

| Variable | Beschreibung |
|---|---|
| `SESSION_SECRET` | Zufälliger String ≥ 32 Zeichen für Session-Signing |
| `DB_ENCRYPTION_KEY` | SQLCipher AES-256-Schlüssel (leer = keine Verschlüsselung) |

### Wetter-Widget

Kostenlosen API-Key bei [openweathermap.org](https://openweathermap.org/api) registrieren:

```env
OPENWEATHER_API_KEY=...
OPENWEATHER_CITY=Berlin
OPENWEATHER_UNITS=metric   # metric = °C, imperial = °F
OPENWEATHER_LANG=de
```

### Weitere Optionen

| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `3000` | Server-Port |
| `NODE_ENV` | `development` | `production` für Deployment |
| `DB_PATH` | `./oikos.db` | Pfad zur SQLite-Datei |
| `SYNC_INTERVAL_MINUTES` | `15` | Automatischer Kalender-Sync-Intervall |
| `RATE_LIMIT_MAX_ATTEMPTS` | `5` | Max. Login-Versuche pro Minute |

Vollständige Vorlage: [`.env.example`](./.env.example)

---

## Kalender-Synchronisation

### Google Calendar

<details>
<summary>Einrichtung anzeigen</summary>

#### Google Cloud Console vorbereiten

1. Projekt unter [console.cloud.google.com](https://console.cloud.google.com) anlegen
2. **Google Calendar API** aktivieren
3. **OAuth 2.0-Client-ID** erstellen (Typ: „Webanwendung")
4. Autorisierte Redirect-URI eintragen:
   ```
   https://oikos.deine-domain.de/api/v1/calendar/google/callback
   ```
5. In `.env` eintragen:
   ```env
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=https://oikos.deine-domain.de/api/v1/calendar/google/callback
   ```
6. Container neu starten: `docker compose up -d`

#### Verbindung herstellen

1. Mit einem **Admin**-Konto einloggen
2. **Einstellungen → Kalender-Synchronisation → Mit Google verbinden**
3. Google-Konto autorisieren → automatische Weiterleitung zurück

**Sync-Verhalten:**
- Erster Sync: Events der letzten 3 Monate + nächsten 12 Monate
- Folge-Syncs: nur Änderungen via Google syncToken (effizient)
- Outbound: neue lokale Termine werden nach Google übertragen
- Konflikt: Google gewinnt bei gleichzeitiger Änderung

</details>

### Apple Calendar (iCloud CalDAV)

<details>
<summary>Einrichtung anzeigen</summary>

#### App-spezifisches Passwort erstellen

1. [appleid.apple.com](https://appleid.apple.com) → „Anmeldung und Sicherheit" → „App-spezifische Passwörter"
2. Neues Passwort für „Oikos" erstellen
3. In `.env` eintragen:
   ```env
   APPLE_CALDAV_URL=https://caldav.icloud.com
   APPLE_USERNAME=deine@apple-id.de
   APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
   ```
4. Container neu starten: `docker compose up -d`

Der Sync-Button erscheint automatisch in den Einstellungen.

</details>

---

## Familienmitglieder

Neue Mitglieder können nur Admins anlegen — es gibt keinen öffentlichen Registrierungs-Endpoint.

**Im Browser:** Einstellungen → Familienmitglieder → Mitglied hinzufügen

**Per Script** (z.B. für weiteren Admin):
```bash
docker compose exec oikos node setup.js
```

---

## Updates

```bash
git pull
docker compose up -d --build
```

Datenbank-Migrationen laufen automatisch beim Start. Daten im Volume `oikos_data` bleiben erhalten.

---

## Entwicklung

```bash
npm install
cp .env.example .env
# SESSION_SECRET setzen — DB_ENCRYPTION_KEY weglassen (kein SQLCipher lokal)
npm run dev        # Server mit Auto-Reload
```

```bash
npm test           # 146 Tests, 7 Suiten (In-Memory-SQLite, keine laufende App nötig)
```

---

## Datensicherung

```bash
# Backup erstellen
docker run --rm \
  -v oikos_oikos_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/oikos-backup-$(date +%Y%m%d).tar.gz /data

# Backup wiederherstellen
docker compose down
docker run --rm \
  -v oikos_oikos_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/oikos-backup-YYYYMMDD.tar.gz -C /
docker compose up -d
```

---

## Sicherheit

- Sessions: `httpOnly`, `SameSite=Strict`, `Secure` in Produktion, 7 Tage TTL
- CSRF-Schutz via Double Submit Cookie auf allen schreibenden Requests
- Passwörter mit bcrypt (Cost Factor 12) gehasht
- Login-Rate-Limit: 5 Versuche/Minute
- API-Rate-Limit: 300 Requests/Minute pro IP
- Content Security Policy via Helmet
- Datenbank optional mit SQLCipher AES-256 verschlüsselt (im Docker-Container)
- Kein API-Endpoint ohne Session-Auth erreichbar (außer `/api/v1/auth/login`)

---

## Lizenz

[MIT](./LICENSE) © 2025 ulsklyc
