<claude-mem-context>
# Memory Context

# [planium] recent context, 2026-04-28 10:47pm GMT+2

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (17,775t read) | 278,478t work | 94% savings

### Apr 28, 2026
881 9:54a 🔵 tasks table is empty — household tasks fully migrated; two database files exist
S97 Planium Database is Empty — Possible DB Path Mismatch (Apr 28, 9:54 AM)
882 9:58a 🔵 Deleted Items Still Appearing in Reminder Modal
883 10:00a 🔵 Bug Confirmed Reproducible in Incognito Mode
884 " 🔵 Planium Project Database Architecture
885 " 🔵 Planium Tasks Table Schema
886 " 🔵 Planium Database is Empty — Possible DB Path Mismatch
S98 Database Not Local on Testing Machine — Stale Data Cleanup Needed (Apr 28, 10:00 AM)
887 10:01a 🔵 Database Not Local on Testing Machine — Stale Data Cleanup Needed
S99 Delete old household tasks that should have been removed during migration from household tasks to personal tasks (Apr 28, 10:01 AM)
S100 Identify and delete stale household tasks from the Planium SQLite3 database (planium.db) (Apr 28, 10:03 AM)
888 10:04a ✅ Default Status Filter Changed to "Unread" on First Open
889 " 🔵 Planium Bookmarks Status Filter Lives in public/pages/bookmarks.js
890 " 🔵 Status Filter Default and Persistence Logic Found in bookmarks.js
891 10:08a 🔵 Planium Project Database: SQLite3 File in Container
S101 Planium SQLite Database Task Data State (Apr 28, 10:08 AM)
892 10:09a 🔵 Planium SQLite Database Task Data State
S102 Deleted All Household Tasks from Planium SQLite Database (Apr 28, 10:09 AM)
893 10:11a ✅ Deleted All Household Tasks from Planium SQLite Database
S103 Planium Duplicate Notification Root Cause: Dead householdQuery Code Path (Apr 28, 10:11 AM)
894 10:14a 🔵 Planium Duplicate Notification Root Cause: Dead householdQuery Code Path
S104 Planium SQLite DB Schema: tasks vs personal_tasks column mismatch (Apr 28, 10:14 AM)
895 10:16a 🔵 Planium SQLite DB Schema: tasks vs personal_tasks column mismatch
S105 Planium personal_tasks SQLite Schema (Apr 28, 10:16 AM)
896 " 🔵 Planium personal_tasks SQLite Schema
897 10:19a ⚖️ Post-Migration Cleanup Checklist for Tasks Feature
898 " 🔵 Legacy Tasks Code Location and Size Confirmed in Planium
899 " 🔵 Full Function Map and Backend Route Registration for Legacy Tasks Cleanup
900 " 🔵 render() Entry Point Already Uses Personal View, But Still Calls openTaskModal
901 10:20a 🔵 State Object Layout and API Dependency Map for Legacy Tasks Cleanup
902 " 🔵 state.users Is Shared Between Legacy and Personal View — Meta Endpoint Cannot Be Simply Deleted
903 " 🔵 Meta/Options Endpoint is Simple Users Query; Web Share Target Must Migrate to openItemEditDialog
904 " 🔵 Tasks Widget Sort Bug: Date Priority Over Priority Flags
905 10:21a 🔵 Tasks Widget Sort: No Explicit Sort Call in renderPersonalListBody
906 " 🔵 personal-lists.js Has No Users Endpoint — Must Add Meta Route During Migration
907 " 🔵 Root Cause Confirmed: Missing Sort + Isolated PRIORITY_RANK in tasks.js
909 " 🔴 Fixed Tasks Widget Sort Order to Match Tasks Tab
908 " 🔵 Shared Utilities in Household Code Block Must Be Preserved for Personal View
910 10:22a 🔵 All Early Helper Functions (lines 38–132) Must Be Preserved — All Used by Personal View
911 " 🔵 server/routes/tasks.js Contains /due-notifications Endpoint That Also Needs Migration Check
912 10:23a 🔵 /due-notifications Already Queries Both Household and Personal Tasks
913 " 🔵 due-notifications Frontend Caller Located in task-notifications.js
914 " ⚖️ Task Sorting Priority Rules Defined
916 " 🔴 Fixed sortWidgetItems Sort Order in dashboard.js
S106 Fixed sortWidgetItems Sort Order in dashboard.js (Apr 28, 10:23 AM)
915 " 🔵 server/index.js Tasks Router Registration at Lines 18 and 175
917 10:24a 🔵 Exact Deletion Boundaries Confirmed in tasks.js
918 10:25a 🔵 personal-lists.js Ends at Line 507 — Append Point for Migrated Endpoints
919 " 🔵 personal-lists.js Already Imports db — No New Imports Needed for Migrated Endpoints
920 " 🟣 Migrated /users and /due-notifications Endpoints to personal-lists.js
921 " 🔄 Legacy Tasks Router Removed from server/index.js
922 10:26a 🔄 server/routes/tasks.js Deleted; Frontend API Paths Now Being Updated
923 " 🔴 task-notifications.js API Path Updated to /personal-lists/due-notifications
924 2:59p 🟣 Restored "In Progress" Kanban Column to Tasks Board
925 " 🔵 Database Constraint Still Blocks in_progress — Migration Needed
926 3:00p ✅ Kanban CSS Updated for Three-Column Layout at ≥1024px
927 " 🔵 DB Migration 18 Rebuilt the Tasks Table to Enforce open/done-Only Constraint
928 3:01p ⚖️ Personal Kanban Intentionally Stays Two-Column While Household Tasks Gets Three
929 3:02p 🔵 Service Worker Caches tasks.js and en.json — Version Bump Required to Ship Changes
930 " ✅ Service Worker Cache Bumped from v163 to v164

Access 278k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
