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

[Screenshots](#screenshots) · [Module](#module) · [Schnellstart](#schnellstart) · [Konfiguration](#konfiguration) · [Kalender-Sync](#kalender-synchronisation) · [Sicherheit](#sicherheit)

</div>

---

## Screenshots

<div align="center">

### ☀️ Light Mode

<table>
  <tr>
    <td align="center">
      <img src="public/screenshots/dashboard.png" width="160" alt="Dashboard" /><br/>
      <sub><b>Dashboard</b></sub><br/>
      <sub>Wetter · Termine · Aufgaben · Essen</sub>
    </td>
    <td align="center">
      <img src="public/screenshots/tasks.png" width="160" alt="Aufgaben" /><br/>
      <sub><b>Aufgaben</b></sub><br/>
      <sub>Prioritäten · Zuweisung · Filter</sub>
    </td>
    <td align="center">
      <img src="public/screenshots/calendar.png" width="160" alt="Kalender" /><br/>
      <sub><b>Kalender</b></sub><br/>
      <sub>Monatsansicht · Google & Apple Sync</sub>
    </td>
    <td align="center">
      <img src="public/screenshots/shopping.png" width="160" alt="Einkaufsliste" /><br/>
      <sub><b>Einkauf</b></sub><br/>
      <sub>Mehrere Listen · Kategorien · Fortschritt</sub>
    </td>
    <td align="center">
      <img src="public/screenshots/meals.png" width="160" alt="Essensplan" /><br/>
      <sub><b>Essensplan</b></sub><br/>
      <sub>Wochenplan · Zutaten · → Einkaufsliste</sub>
    </td>
  </tr>
</table>

### 🌙 Dark Mode

<table>
  <tr>
    <td align="center">
      <img src="public/screenshots/dashboard-dark.png" width="160" alt="Dashboard Dark" /><br/>
      <sub><b>Dashboard</b></sub><br/>
      <sub>Wetter · Termine · Aufgaben · Essen</sub>
    </td>
    <td align="center">
      <img src="public/screenshots/tasks-dark.png" width="160" alt="Aufgaben Dark" /><br/>
      <sub><b>Aufgaben</b></sub><br/>
      <sub>Prioritäten · Zuweisung · Filter</sub>
    </td>
    <td align="center">
      <img src="public/screenshots/calendar-dark.png" width="160" alt="Kalender Dark" /><br/>
      <sub><b>Kalender</b></sub><br/>
      <sub>Monatsansicht · Google & Apple Sync</sub>
    </td>
    <td align="center">
      <img src="public/screenshots/shopping-dark.png" width="160" alt="Einkaufsliste Dark" /><br/>
      <sub><b>Einkauf</b></sub><br/>
      <sub>Mehrere Listen · Kategorien · Fortschritt</sub>
    </td>
    <td align="center">
      <img src="public/screenshots/meals-dark.png" width="160" alt="Essensplan Dark" /><br/>
      <sub><b>Essensplan</b></sub><br/>
      <sub>Wochenplan · Zutaten · → Einkaufsliste</sub>
    </td>
  </tr>
</table>

<sub>Dark Mode wird automatisch über die Systemeinstellung des Geräts aktiviert.</sub>

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

## Installation

### Voraussetzungen

- **Docker** und **Docker Compose** (auf dem Server installiert)
- Einen Linux-Server oder eine lokale Linux-Maschine
- Für den produktiven Betrieb: eine Domain und einen Reverse Proxy mit SSL (empfohlen: [Nginx Proxy Manager](https://nginxproxymanager.com))

---

### Schritt 1 — Repository klonen

```bash
git clone https://github.com/ulsklyc/oikos.git
cd oikos
```

---

### Schritt 2 — Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
```

Die `.env`-Datei mit einem Texteditor öffnen und mindestens diese Felder ausfüllen:

```env
# Zufälliger String mit mindestens 32 Zeichen — z.B. generieren mit:
# openssl rand -base64 32
SESSION_SECRET=hier_einen_langen_zufaelligen_string_eintragen

# Verschlüsselungsschlüssel für die Datenbank (AES-256)
# Leer lassen = keine Verschlüsselung (nicht empfohlen für Produktion)
DB_ENCRYPTION_KEY=hier_einen_starken_schluessel_eintragen
```

> **Tipp:** Zufällige Schlüssel lassen sich einfach im Terminal generieren:
> ```bash
> openssl rand -base64 32
> ```

> Alle verfügbaren Variablen: [Konfigurationsreferenz](#konfiguration)

---

### Schritt 3 — Container bauen und starten

```bash
docker compose up -d --build
```

> Der erste Build dauert **2–3 Minuten**, da SQLCipher gegen better-sqlite3 kompiliert wird. Folgende Builds sind deutlich schneller (Docker-Layer-Cache).

Den Status des Containers prüfen:

```bash
docker compose ps
docker compose logs oikos --tail=20
```

Der Server ist bereit, wenn in den Logs erscheint:
```
[Oikos] Server läuft auf Port 3000
```

---

### Schritt 4 — Admin-Account anlegen

```bash
docker compose exec oikos node setup.js
```

Das interaktive Script fragt nach **Benutzername**, **Anzeigename** und **Passwort**. Dieser erste Account erhält Admin-Rechte und kann später weitere Familienmitglieder anlegen.

---

### Schritt 5 — App öffnen und einloggen

Ohne Reverse Proxy (lokaler Test):

```
http://localhost:3000
```

> **Wichtig bei direktem HTTP-Zugriff ohne Reverse Proxy:**
> Da `NODE_ENV=production` gesetzt ist, erwartet der Server standardmäßig HTTPS für Session-Cookies. Beim Zugriff per `http://` muss daher in der `.env` folgende Zeile ergänzt werden:
>
> ```env
> SESSION_SECURE=false
> ```
>
> Danach Container neu starten: `docker compose down && docker compose up -d`
> Diese Einstellung **unbedingt entfernen**, sobald ein Reverse Proxy mit SSL eingerichtet ist.

---

### Schritt 6 — Reverse Proxy mit SSL einrichten (Produktion)

Für den produktiven Betrieb sollte Oikos hinter einem Nginx Reverse Proxy mit SSL betrieben werden.

**Mit Nginx Proxy Manager:**

1. Neuen Proxy Host anlegen: `oikos.deine-domain.de` → `localhost:3000`
2. SSL-Zertifikat via Let's Encrypt ausstellen
3. Im Feld „Advanced" den Inhalt aus [`nginx.conf.example`](./nginx.conf.example) eintragen

**Wichtig:** Der Header `X-Forwarded-Proto` muss gesetzt sein (ist in der Beispielkonfiguration enthalten). Ohne ihn weiß der Server nicht, dass er hinter HTTPS läuft, und setzt Cookies nicht korrekt.

Sobald SSL aktiv ist: `SESSION_SECURE=false` aus der `.env` entfernen und Container neu starten.

---

## Konfiguration

### Pflichtfelder

| Variable | Beschreibung |
|---|---|
| `SESSION_SECRET` | Zufälliger String ≥ 32 Zeichen für Session-Signing |
| `DB_ENCRYPTION_KEY` | SQLCipher AES-256-Schlüssel (leer lassen = keine Verschlüsselung) |

### Sicherheit

| Variable | Standard | Beschreibung |
|---|---|---|
| `SESSION_SECURE` | *(nicht gesetzt)* | `false` setzen wenn kein HTTPS-Reverse-Proxy vorhanden (direktes HTTP) |
| `RATE_LIMIT_MAX_ATTEMPTS` | `5` | Max. Login-Versuche pro Minute pro IP |

### Wetter-Widget

Kostenlosen API-Key bei [openweathermap.org](https://openweathermap.org/api) registrieren:

```env
OPENWEATHER_API_KEY=dein_api_key
OPENWEATHER_CITY=Berlin
OPENWEATHER_UNITS=metric   # metric = °C, imperial = °F
OPENWEATHER_LANG=de
```

### Weitere Optionen

| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `3000` | Server-Port |
| `NODE_ENV` | `production` | Umgebung (nicht ändern) |
| `DB_PATH` | `/data/oikos.db` | Pfad zur SQLite-Datei im Container |
| `SYNC_INTERVAL_MINUTES` | `15` | Automatischer Kalender-Sync-Intervall |

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

Datenbank-Migrationen laufen automatisch beim Start — kein manueller Eingriff nötig. Alle Daten im Volume `oikos_data` bleiben erhalten.

> **Empfehlung:** Vor jedem Update ein Backup erstellen — siehe [Datensicherung](#datensicherung).

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
