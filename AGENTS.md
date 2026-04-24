<claude-mem-context>
# Memory Context

# [planium] recent context, 2026-04-24 6:09pm GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (17,879t read) | 368,633t work | 95% savings

### Apr 23, 2026
S29 Homarr iframe widget randomly freezing when Planium is embedded inside it (Apr 23, 10:40 PM)
S30 Move Priority and Tasks Filter to Toolbar Dropdown (Apr 23, 10:41 PM)
S31 Current Filter Implementation: Filter Chips in #filter-bar and #personal-filter-bar Divs (Apr 23, 10:42 PM)
S32 Final commit `d2308b2` — news favicon fix on main with full description (Apr 23, 10:43 PM)
S33 Add "Assigned To" filter dimension to household task filter UI, then migrate personal list filters from flat chip strip to dropdown pattern for visual consistency (Apr 23, 10:47 PM)
S34 DuckDuckGo Icon CDN Serves Valid Images But Has No CORS Headers (Apr 23, 10:50 PM)
S35 Service Worker Cache Bumped to v128 for Favicon Icon Refactor (Apr 23, 11:01 PM)
S36 Auth Uses req.session.role; Per-User Pattern Already Exists via owner_id in task_lists (Apr 23, 11:03 PM)
272 11:04p 🔵 Planium External Integration Pattern: app_settings Table
273 " 🔵 Planium Tasks Schema and Route Architecture
274 " 🔵 Planium Frontend Settings Page Pattern and API Client
275 11:05p 🔵 Exact Settings UI Event Binding Pattern for Integration Cards
276 " 🔵 Planium Has Two Separate List Systems: head_lists and task_lists
277 11:06p 🔵 Git commit history confirmed in planium repo
278 " 🟣 Created server/routes/linkding.js Integration Route Module
279 " 🟣 Created server/routes/bookmarks.js with /save-link and /task-lists Endpoints
280 " 🟣 Registered Linkding and Bookmarks Routes in server/index.js
281 11:07p 🟣 Settings Page State Initialization Extended for Linkding and Task Lists
282 " 🟣 Linkding Settings UI Section Added to settings.js HTML Template
283 " 🟣 Linkding Event Bindings Added to settings.js bindEvents()
284 11:08p 🟣 Created save-link-modal.js Frontend Component
285 " 🔴 Fixed personal_tasks INSERT to Match Actual Schema (No description Column)
### Apr 24, 2026
286 3:34p ⚖️ Per-User Isolation Considered for Mealie, FreshRSS, and Linkding
287 " 🔵 Mealie, FreshRSS, and Linkding Store Credentials Globally in app_settings Table
288 " 🔵 Auth Uses req.session.role; Per-User Pattern Already Exists via owner_id in task_lists
S37 Bookmarks Mobile UI: Tag Sidebar Redesign Discussion (Apr 24, 3:34 PM)
289 3:37p 🔴 i18n Key Displayed as Literal String on Settings Page
290 " 🟣 Global Fallback Toggle and API/URL Override Added to Settings
291 " 🔄 Settings Page Sections Made Collapsible
292 3:38p 🔵 Root Cause of "settings.themeLabel" Bug Confirmed: Missing i18n Key
293 " 🔵 Settings Page Structure: 8+ Sections Mapped Across 1,197 Lines
294 " 🔵 Integration Backend Architecture: Mealie, FreshRSS, Linkding Share Common Pattern
295 5:56p 🔵 Planium Bookmarks/Save-Link Route Implementation
296 " ⚖️ Planned Per-User Integration Settings Feature for Planium
297 5:57p 🔵 Planium DB Already at Migration 21; user_settings Table Already Exists
298 " ⚖️ No New DB Migration Needed for Per-User Integration Settings
299 " 🟣 Mealie Route Refactored to Support Per-User Config Override
300 " 🟣 Mealie Route Call Sites Updated to Pass req.session.userId
301 5:58p 🟣 Mealie Per-User Config CRUD Endpoints Added
302 " 🟣 FreshRSS Route Refactored for Per-User Config Override
303 " ⚖️ Bookmarks Mobile UI: Tag Sidebar Redesign Discussion
304 " 🟣 FreshRSS All Proxy Routes Wired to Per-User Config
305 " 🔴 FreshRSS Token and Headline Caches Made Per-Credentials
306 5:59p 🔴 FreshRSS Token Cache Call Sites Updated to Use Per-Credentials Map
307 " 🔴 FreshRSS Test Route Force-Re-Auth Pattern Fixed for Map-Based Cache
308 " 🔴 FreshRSS Headline Cache and 401 Token Eviction Fully Migrated to Per-Credentials Keys
309 " 🔴 FreshRSS Headline Cache Write Path Fixed — Per-Credentials Cache Migration Complete
310 6:00p 🟣 FreshRSS Per-User Config CRUD Endpoints Added
311 " 🟣 Linkding Route Refactored for Per-User Config; getLinkdingConfig Exported for Bookmarks Route
312 " ⚖️ Bookmark Tag Visibility UX Decision
S38 Bookmark tag filtering UX design for ~500 bookmarks on mobile — tags hidden during scroll but accessible for filtering (Apr 24, 6:00 PM)
313 " 🟣 All Linkding Route Call Sites Bulk-Updated to Pass req.session.userId
314 " 🟣 Linkding Per-User Config CRUD Endpoints Added — Backend Integration Settings Complete
315 6:01p 🟣 bookmarks.js Migrated to Import Per-User getLinkdingConfig from linkding.js
316 " 🟣 Per-User Integration Config Backend Complete — All Routes Syntax-Valid
317 " 🔵 Settings UI CSS Structure Located for Task 3
318 " 🔵 Settings Page Structure Discovered for Task 3 UI Work
319 6:02p 🔵 Integration Card UI and Event Binding Structure Mapped in settings.js
320 " 🔵 Integration Event Handler API Call Patterns Documented in settings.js
321 " 🔵 Settings Page Section Map — FreshRSS and Linkding Use Hardcoded Titles

Access 369k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
