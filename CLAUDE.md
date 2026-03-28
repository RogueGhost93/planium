# Oikos

Self-hosted family planner PWA. Node.js/Express, Vanilla JS (ES modules, no build step), SQLite/SQLCipher, Docker.

## Quick Reference

```bash
npm start              # Production server (PORT from .env, default 3000)
npm run dev            # Development with --watch
npm test               # All test suites (requires Node ≥22 for --experimental-sqlite)
docker compose up -d   # Production deployment
```

## Architecture

```
server/
  index.js             # Express entry, middleware chain, static serving
  db.js                # SQLite/SQLCipher connection, migrations
  auth.js              # Session auth middleware + login/logout/user-mgmt routes
  routes/              # One file per module: tasks, shopping, meals, calendar, notes, contacts, budget, weather
  services/            # google-calendar.js, apple-calendar.js, recurrence.js (RRULE)
public/
  index.html           # SPA shell — single entry point
  router.js            # History API router (~50 lines, no library)
  api.js               # Fetch wrapper: auth, CSRF, error handling
  styles/              # tokens.css (design tokens), reset.css, layout.css, [module].css
  components/          # Web Components: oikos-[module]-[name].js
  pages/               # Page modules loaded by router
  sw.js                # Service worker (app-shell caching)
  manifest.json
docs/
  SPEC.md              # Full product spec — module definitions, data model, design system
```

**Request flow:** Client → Express static (public/) or `/api/v1/*` → auth middleware (session check) → route handler → better-sqlite3 (sync) → JSON response.

**No SPA framework.** Client-side routing via History API. Pages are ES modules that export a `render()` function. Web Components for reusable UI. No React, Vue, Svelte, or build tooling.

## Code Conventions

- ES modules everywhere (`type: "module"` in package.json, `import`/`export` in all JS)
- Semicolons: yes
- Web Component prefix: `oikos-` (not `fb-`), one component per file
- All UI text in German. Dates: `DD.MM.YYYY`. Times: `HH:MM` (24h)
- API responses: `{ data: ... }` on success, `{ error: string, code: number }` on failure
- Every route handler: `try/catch` wrapping, no unhandled promise rejections
- No `eval()`, no `innerHTML` with user input — use `textContent` or DOM API
- No external frontend dependencies except Lucide Icons (SVG sprite, self-hosted — no CDN at runtime)
- Backend deps minimal: express, better-sqlite3, bcrypt, express-session, express-rate-limit, helmet, dotenv
- Header comment in every file: purpose, module, dependencies

## Testing

Tests use Node.js built-in test runner with `--experimental-sqlite` for in-memory SQLite (no SQLCipher dep in tests). Each module gets a test file in `tests/`. Run: `npm test`. Add new tests: create `tests/[module].test.js`, it auto-discovers via glob pattern.

## Security Model

- **Auth:** Session-based. `express-session` with SQLite store, `httpOnly + secure + sameSite: strict` cookies. 7-day TTL. No public registration — admin creates users.
- **CSRF:** Double Submit Cookie pattern. Backend sets `csrfToken` cookie; frontend sends it as `X-CSRF-Token` header. Validate on all state-changing requests.
- **Rate limiting:** 5 login attempts/min/IP, 15-min lockout via `express-rate-limit`.
- **Passwords:** bcrypt, cost factor 12.
- **Headers:** `helmet()` defaults + strict CSP allowing only `'self'`.

## Database

SQLite via `better-sqlite3`. Optional SQLCipher encryption (AES-256) — enabled when `DB_ENCRYPTION_KEY` is set in `.env`.

**Migrations:** `server/db.js` runs migrations sequentially on startup. Each migration is an idempotent SQL block in a `migrations` array. Add new tables/columns by appending to that array — never modify existing entries.

**Schema conventions:** Every table has `id INTEGER PRIMARY KEY`, `created_at TEXT DEFAULT (datetime('now'))`, `updated_at TEXT DEFAULT (datetime('now'))`. Foreign keys enforced via `PRAGMA foreign_keys = ON`.

## Deployment

```dockerfile
# Base: node:20-slim + SQLCipher build deps (libsqlcipher-dev)
# Volume: /app/data (SQLite DB file)
# Expose: 3000
```

Required env vars: `SESSION_SECRET`, `DB_ENCRYPTION_KEY` (optional), `PORT` (default 3000).
Optional: `OPENWEATHERMAP_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

Runs behind Nginx reverse proxy with SSL. Example config in `nginx.conf.example`.

## Bootstrap Sequence

When starting from scratch, follow this order:

1. `npm init` + install deps + `.env.example` + `.gitignore` + `Dockerfile` + `docker-compose.yml`
2. Express server + SQLite connection + migration runner + auth system
3. Frontend app shell: SPA router, nav, layout, CSS design tokens
4. Modules one by one (see `docs/SPEC.md` for detailed specs per module)
5. Cross-module integrations (meal→shopping, dashboard widgets)
6. PWA (service worker, manifest, offline shell)
7. Security hardening (CSRF, rate limiting, CSP, input validation)

Read `docs/SPEC.md` before implementing any module — it contains the data model, UI specs, and design system.
