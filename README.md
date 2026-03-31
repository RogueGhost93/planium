<p align="center">
  <!-- Replace with your logo: recommended 120–160px, SVG or PNG, transparent background -->
  <!-- <img src="docs/logo.svg" alt="Oikos" width="140"> -->
  <img src="https://img.shields.io/badge/%F0%9F%8F%A0-Oikos-007AFF?style=for-the-badge&labelColor=F5F5F7" alt="Oikos" height="48">
</p>

<h1 align="center">Oikos</h1>

<p align="center">
  <strong>Self-hosted family planner — tasks, calendars, shopping, meals, budget.</strong><br>
  Your data stays on your server. No subscriptions. No tracking. No cloud lock-in.
</p>

<p align="center">
  <a href="https://github.com/ulsklyc/oikos/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js ≥22"></a>
  <a href="https://www.docker.com"><img src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker Ready"></a>
  <a href="https://www.zetetic.net/sqlcipher/"><img src="https://img.shields.io/badge/SQLCipher-AES--256-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLCipher Encrypted"></a>
  <a href="https://web.dev/progressive-web-apps/"><img src="https://img.shields.io/badge/PWA-offline--capable-5A0FC8?style=flat-square&logo=pwa&logoColor=white" alt="PWA Offline"></a>
  <a href="https://github.com/ulsklyc/oikos/stargazers"><img src="https://img.shields.io/github/stars/ulsklyc/oikos?style=flat-square&color=f5c542" alt="GitHub Stars"></a>
  <a href="https://github.com/ulsklyc/oikos/commits/main"><img src="https://img.shields.io/github/last-commit/ulsklyc/oikos?style=flat-square" alt="Last Commit"></a>
</p>

<p align="center">
  <a href="#features">Features</a> · <a href="#quick-start">Quick Start</a> · <a href="#configuration">Configuration</a> · <a href="#calendar-sync">Calendar Sync</a> · <a href="#security">Security</a>
</p>

---

Oikos is a self-hosted family organizer for 2–6 people. Tasks, calendars, shopping lists, meal plans, budget tracking, notes, and contacts — all running on your own server inside a single Docker container. No cloud dependency, no telemetry, no data leaves your network.

Built with Express.js, SQLite (optionally encrypted via SQLCipher), and vanilla JavaScript — no frontend framework, no build step. Works offline as a PWA on phones and tablets.

Oikos is **not** a SaaS product, not a team collaboration tool, and not designed for public multi-tenant use. It is a private tool for one family on one server.

---

## Screenshots

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/tablet-dark/tablet-dark-dashboard.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/tablet-light/tablet-light-dashboard.png">
    <img src="docs/screenshots/tablet-light/tablet-light-dashboard.png" alt="Dashboard" width="720">
  </picture>
</p>

<table>
  <tr>
    <td align="center" width="33%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-dark/mobile-dark-tasks.png">
        <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/mobile-light/mobile-light-tasks.png">
        <img src="docs/screenshots/mobile-light/mobile-light-tasks.png" alt="Tasks" width="240">
      </picture>
      <br><strong>Tasks</strong>
    </td>
    <td align="center" width="33%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-dark/mobile-dark-household.png">
        <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/mobile-light/mobile-light-household.png">
        <img src="docs/screenshots/mobile-light/mobile-light-household.png" alt="Shopping" width="240">
      </picture>
      <br><strong>Shopping</strong>
    </td>
    <td align="center" width="33%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-dark/mobile-dark-budget.png">
        <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/mobile-light/mobile-light-budget.png">
        <img src="docs/screenshots/mobile-light/mobile-light-budget.png" alt="Budget" width="240">
      </picture>
      <br><strong>Budget</strong>
    </td>
  </tr>
  <tr>
    <td align="center" width="33%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-dark/mobile-dark-notes.png">
        <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/mobile-light/mobile-light-notes.png">
        <img src="docs/screenshots/mobile-light/mobile-light-notes.png" alt="Notes" width="240">
      </picture>
      <br><strong>Notes</strong>
    </td>
    <td align="center" width="33%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-dark/mobile-dark-contacts.png">
        <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/mobile-light/mobile-light-contacts.png">
        <img src="docs/screenshots/mobile-light/mobile-light-contacts.png" alt="Contacts" width="240">
      </picture>
      <br><strong>Contacts</strong>
    </td>
    <td align="center" width="33%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/mobile-dark/mobile-dark-dashboard.png">
        <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/mobile-light/mobile-light-dashboard.png">
        <img src="docs/screenshots/mobile-light/mobile-light-dashboard.png" alt="Dashboard Mobile" width="240">
      </picture>
      <br><strong>Dashboard — Mobile</strong>
    </td>
  </tr>
</table>

<p align="center">
  <sub>Screenshots adapt to your GitHub theme — switch between light and dark mode to see both variants.</sub>
</p>

---

## Features

| | Module | What it does | Highlights |
|---|---|---|---|
| 📋 | **Dashboard** | At-a-glance overview of your family's day | Weather widget · upcoming events · urgent tasks · today's meals · pinned notes |
| ✅ | **Tasks** | Shared to-do lists with accountability | List + Kanban views · subtasks · recurring tasks (RRULE) · swipe gestures · priority levels |
| 🛒 | **Shopping** | Collaborative grocery lists | Multiple lists · aisle-grouped categories · auto-import from meal plan |
| 🍽️ | **Meals** | Weekly meal planning with ingredients | Week view (Mon–Sun) · ingredient management · one-click export to shopping list |
| 📅 | **Calendar** | Family calendar with external sync | Month/week/day/agenda views · Google Calendar & Apple iCloud two-way sync |
| 📌 | **Notes** | Shared family pinboard | Colored sticky notes · pinning · full-text search · lightweight Markdown (bold, italic, lists) |
| 👥 | **Contacts** | Important family contacts | Category filters · tap-to-call · tap-to-email · map links · vCard import/export |
| 💰 | **Budget** | Income & expense tracking | Category breakdown · month-over-month comparison · CSV export |
| ⚙️ | **Settings** | User & sync management | Password changes · calendar sync config · family member admin |

---

## Tech Stack

<p>
  <img src="https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white" alt="Express">
  <img src="https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/Vanilla_JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="Vanilla JS">
  <img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/PWA-5A0FC8?style=flat-square&logo=pwa&logoColor=white" alt="PWA">
</p>

| Layer | Technology |
|---|---|
| **Server** | Node.js ≥ 22 · Express · better-sqlite3 · bcrypt · Helmet |
| **Database** | SQLite with optional SQLCipher encryption (AES-256) |
| **Frontend** | Vanilla JavaScript ES modules — no framework, no build step. Web Components (`oikos-*`). Lucide Icons (self-hosted SVG sprite) |
| **Auth** | Session-based · httpOnly cookies · CSRF double-submit · express-session |
| **Deployment** | Docker + Docker Compose · Nginx reverse proxy · Let's Encrypt SSL |
| **Integrations** | Google Calendar API v3 (OAuth 2.0) · Apple iCloud CalDAV (tsdav) · OpenWeatherMap |

---

## Quick Start

**Prerequisites:** Docker + Docker Compose on a Linux server.

### 1. Clone

```bash
git clone https://github.com/ulsklyc/oikos.git
cd oikos
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and set the two required variables:

```env
SESSION_SECRET=your-random-string-at-least-32-chars
DB_ENCRYPTION_KEY=your-sqlcipher-aes256-key
```

### 3. Start

```bash
docker compose up -d
```

First build takes 2–3 minutes (compiles SQLCipher against better-sqlite3).

### 4. Create admin account

```bash
docker compose exec oikos node setup.js
```

Interactive script — sets up username, display name, and password. This admin can create additional family members from the settings page.

### 5. Open

Navigate to `http://localhost:3000` — or your configured domain after Nginx setup.

> **Nginx:** See [`nginx.conf.example`](nginx.conf.example) for a production-ready config. If you use [Nginx Proxy Manager](https://nginxproxymanager.com), paste the contents into the "Advanced" tab. Make sure `X-Forwarded-Proto` is set so session cookies work correctly in production.

---

<details>
<summary><h2>Configuration</h2></summary>

### Required

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Random string ≥ 32 characters for session signing |
| `DB_ENCRYPTION_KEY` | SQLCipher AES-256 key. Leave empty to disable encryption |

### Optional

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Set to `production` for deployment |
| `DB_PATH` | `./oikos.db` | Path to SQLite database file |
| `SYNC_INTERVAL_MINUTES` | `15` | Automatic calendar sync interval |
| `RATE_LIMIT_MAX_ATTEMPTS` | `5` | Max login attempts per minute per IP |

### Weather Widget

Register a free API key at [openweathermap.org](https://openweathermap.org/api):

| Variable | Default | Description |
|---|---|---|
| `OPENWEATHER_API_KEY` | — | Your API key |
| `OPENWEATHER_CITY` | `Berlin` | City name |
| `OPENWEATHER_UNITS` | `metric` | `metric` (°C) or `imperial` (°F) |
| `OPENWEATHER_LANG` | `de` | Language code |

### Integrations

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | `https://your-domain/api/v1/calendar/google/callback` |
| `APPLE_CALDAV_URL` | `https://caldav.icloud.com` |
| `APPLE_USERNAME` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from Apple ID settings |

Full template: [`.env.example`](.env.example)

</details>

---

<details>
<summary><h2>Calendar Sync</h2></summary>

Oikos syncs bidirectionally with Google Calendar and Apple iCloud. External events are visually distinguished in the UI. On conflict, the external source wins.

### Google Calendar

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the **Google Calendar API**
3. Create an **OAuth 2.0 Client ID** (type: Web application)
4. Add your redirect URI:
   ```
   https://your-domain.com/api/v1/calendar/google/callback
   ```
5. Add credentials to `.env`:
   ```env
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=https://your-domain.com/api/v1/calendar/google/callback
   ```
6. Restart: `docker compose up -d`
7. In Oikos: **Settings → Calendar Sync → Connect Google**

**Sync behavior:** Initial sync pulls events from 3 months ago to 12 months ahead. Subsequent syncs use Google's `syncToken` for incremental updates. Local events push to Google automatically. Conflicts: Google wins on simultaneous edits.

### Apple Calendar (iCloud CalDAV)

**Option A — via Settings UI (recommended, no restart required):**

1. Go to [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords
2. Generate a new password for "Oikos"
3. In Oikos: **Settings → Calendar Sync → Apple Calendar** → enter the CalDAV URL, Apple ID email and the app-specific password → click **Verbinden & testen**

Credentials are stored in the database. No server restart required.

**Option B — via `.env`:**

```env
APPLE_CALDAV_URL=https://caldav.icloud.com
APPLE_USERNAME=your@apple-id.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

Restart: `docker compose up -d`. The sync button appears automatically in Settings. `.env`-credentials are used as fallback when no UI-credentials are saved.

</details>

---

## Security

Oikos is designed to run on a private server behind SSL. No public endpoints exist except the login page.

- **Sessions** — `httpOnly`, `SameSite=Strict`, `Secure` in production, 7-day TTL
- **CSRF** — Double-submit cookie pattern on all state-changing requests
- **Passwords** — bcrypt with cost factor 12
- **Rate limiting** — 5 login attempts/min, 300 API requests/min per IP
- **Headers** — Strict Content Security Policy via Helmet (`self`-only)
- **Encryption** — Optional SQLCipher AES-256 database encryption at rest
- **Access control** — No API endpoint accessible without session auth (except `/api/v1/auth/login`)
- **No public registration** — Only admins can create user accounts

---

<details>
<summary><h2>Development</h2></summary>

### Local Setup

```bash
npm install
cp .env.example .env
# Set SESSION_SECRET — skip DB_ENCRYPTION_KEY (no SQLCipher needed locally)
npm run dev        # Starts server with --watch (auto-reload)
```

### Tests

```bash
npm test           # 146 tests across 7 suites
```

Tests use Node.js built-in test runner with `--experimental-sqlite` for in-memory SQLite. No running server required.

### Architecture

```
server/
  index.js             # Express entry, middleware, static serving
  db.js                # SQLite connection, migration runner
  auth.js              # Session auth + user management routes
  routes/              # One file per module
  services/            # Calendar sync, recurrence engine
public/
  index.html           # SPA shell
  router.js            # History API router (~50 lines)
  api.js               # Fetch wrapper with auth + CSRF
  styles/              # Design tokens, reset, layout, per-module CSS
  components/          # Web Components (oikos-* prefix)
  pages/               # Page modules with render() export
  sw.js                # Service worker
```

**Request flow:** Client → Express static or `/api/v1/*` → session auth middleware → route handler → better-sqlite3 (sync) → JSON response.

**Database migrations** run automatically on startup. Each migration is an idempotent SQL block in `server/db.js`. Append new migrations — never modify existing ones.

</details>

---

<details>
<summary><h2>Backup & Restore</h2></summary>

### Backup

```bash
docker run --rm \
  -v oikos_oikos_data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/oikos-backup-$(date +%Y%m%d).tar.gz /data
```

### Restore

```bash
docker compose down
docker run --rm \
  -v oikos_oikos_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/oikos-backup-YYYYMMDD.tar.gz -C /
docker compose up -d
```

Database migrations run automatically on startup. Data in the `oikos_data` volume is preserved across container rebuilds.

</details>

---

<details>
<summary><h2>Updates & Family Members</h2></summary>

### Updating Oikos

```bash
git pull
docker compose up -d --build
```

Migrations run automatically. Your data volume stays intact.

### Adding Family Members

Only admins can create new accounts — there is no public registration endpoint.

**In the browser:** Settings → Family Members → Add Member

**Via CLI:** `docker compose exec oikos node setup.js`

</details>

---

## Contributing

Contributions are welcome. If you find a bug or have a feature idea, [open an issue](https://github.com/ulsklyc/oikos/issues). Pull requests are appreciated — please keep the vanilla JS constraint in mind (no frameworks, no build tools).

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup instructions, code conventions, commit format, and workflow.

---

## License

[MIT](LICENSE) © 2025 ulsklyc

---

<p align="center">
  Made with ☕ by <a href="https://github.com/ulsklyc">ulsklyc</a>
</p>
