# Permissions matrix (enforced in Postgres; mirrored for UI in `src/lib/permissions.ts`)

| Capability | Admin | Mentor | BDS | Enforced by |
|---|---|---|---|---|
| Company dashboard / all leads | ✔ | ✘ (team only) | ✘ (own) | `leads_select` policy |
| Manage users, roles, activation | ✔ | ✘ | ✘ | `profiles` has no UPDATE grant on role/is_active; `admin_update_profile()` checks admin |
| Manage teams/memberships/targets | ✔ | ✘ (read own team) | ✘ (read own) | admin-only write policies |
| Create lead | ✔ any owner | ✔ own team members | ✔ self only | `leads_insert` check |
| Edit lead fields | ✔ | ✔ team | ✔ own | `leads_update` + column grants |
| Change stage | ✔ | ✔ team | ✔ own | `move_lead_stage()` (stage column not updatable directly) |
| Reassign lead | ✔ any | ✔ within team, if `mentor.can_assign_leads` | ✘ | `assign_lead()` |
| Convert to client (Won) | ✔ | ✔ team | ✔ own | `convert_lead_to_client()` |
| Archive / delete lead | ✔ delete (hard) | archive team | ✘ | `archive_lead()`, `leads_delete` admin-only |
| Tasks | all | team (assign within team) | own / created | `tasks_*` policies + reassignment trigger |
| Clients / projects | ✔ write | read, team only | read, own converted | `can_access_client()`; writes admin-only |
| Proposals | ✔ | ✔ team | ✔ own leads | follows lead access |
| Invoices / payments / revenue | ✔ | ✘ | ✘ | admin-only policies; `report_revenue()` raises |
| Finance: overview, client accounts, invoices & payments, adjustments, employee sales, payroll, expenses, financial reports (+ CSV) | ✔ | ✘ | ✘ | admin-only RLS on every table/view; `finance_*` RPCs raise 42501 for non-admins; `/finance/*` guarded in `permissions.ts` |
| Finance: Services & pricing (prices, discounts) | ✔ read + write | ✔ read only | ✔ read only | `services` policies: select = any active user, insert/update/delete = admin |
| Targets | set: ✔ | view team | view own | `user_targets` policies |
| Daily reports | all | team | own (metrics derived by trigger) | policies + `daily_reports_before` |
| Audit history (tab on the Attendance page, route `/audit-logs`) | all | team work entries | own work entries | `audit_select`; append-only triggers |
| Attendance & hours | all mentors/employees; edit any day (reason required); decide corrections | own + assigned **employees** (never other mentors, even co-mentors) | own | `attendance_*` policies via `can_see_attendance()`; writes only through `attendance_*` RPCs |
| Check-in / out / breaks | ✘ (admins have no attendance) | own | own | server clock in `attendance_check_in()` etc. |
| Leave requests (tab on the Attendance page) | see all; decide **mentors'** requests, and employees' only when they have no active mentor | decide requests of their assigned **employees**; apply (decided by admin) | apply; see/cancel own | `leave_requests_select` via `can_see_attendance()`; `app.leave_approvers()`/`can_decide_leave()`; writes only via `request_leave`/`decide_leave_request`/`cancel_leave` |
| Attendance policy | edit | read | read | `app_settings` key `attendance.policy` (validated by trigger) |
| Approvals | decide all | decide `mentor_support`/`escalation` for team | request / cancel own | `decide_approval()` |
| System settings / vocabularies | ✔ | read | read | admin-only write policies |

Deactivated users: `app.me()` returns NULL ⇒ every policy denies, even with a still-valid JWT.

**Added controls.** Two-step verification is optional per user and enforced in the database (aal2 required once a factor is verified); an admin can reset a lost factor (Team → Reset 2FA). Admins can offboard a user (reassign + deactivate + block). Leave: employee → assigned mentor, mentor → admin; an admin can decide an employee's request after 48 h. Files on leads/clients follow lead/client access; only the uploader or an admin can delete. Message templates: everyone reads active ones, admins manage. Sign-up is disabled on the hosted project; accounts are created by admins. Idle sessions end after 30 minutes.
