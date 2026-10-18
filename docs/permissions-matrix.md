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
| Targets | set: ✔ | view team | view own | `user_targets` policies |
| Daily reports | all | team | own (metrics derived by trigger) | policies + `daily_reports_before` |
| Audit log | all | team work entries | own work entries | `audit_select`; append-only triggers |
| Approvals | decide all | decide `mentor_support`/`escalation` for team | request / cancel own | `decide_approval()` |
| System settings / vocabularies | ✔ | read | read | admin-only write policies |

Deactivated users: `app.me()` returns NULL ⇒ every policy denies, even with a still-valid JWT.
