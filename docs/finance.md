# Finance & Accounts module

Eight sections under `/finance` (admin: all; mentor/employee: **Services & pricing** only, read-only). Currency INR; the aggregates assume a single currency. All definitions live in SQL (migration 0018) so the overview, reports and detail pages cannot disagree.

| Metric | Definition |
|---|---|
| Total closed sales | Sum of `projects.agreed_value` (a deal = a project, counted once) whose **closed date** falls in the range. Closed date = the source lead's `converted_at`; a client with no source lead falls back to the project's creation date. |
| Total collected | Completed payments − completed refunds, by payment date. Failed/cancelled/pending never count. |
| Advances received | Completed payments with `purpose = advance`. A **subset** of collected, never added to it. |
| Outstanding receivables | Σ balance (adjusted total − net received) of `issued`/`partially_paid` invoices, **as of today**. |
| Overdue payments | The part of outstanding whose due date is before today. |
| Total expenses paid / Salaries paid | Completed `expense_payments` / `salary_payments` by payment date. |
| Salaries payable | Σ (total − paid) of **approved** obligations, as of today. Drafts and cancelled records are ignored. |
| Net cash flow | Collected − expenses paid − salaries paid. |
| Net profit | **Not available** until revenue-recognition and cost rules are defined. |

**Sales attribution:** lead owner, else the client's relationship owner, else "Unattributed". **Collections → deals:** a payment belongs to its invoice's deal; an invoice with no deal uses the client's only deal; if the client has several, the payment is shown as Unattributed (never guessed).

**Prices:** `services.standard_price` / `discount_percent` apply to new deals; each deal keeps its own `agreed_value`, `list_price`, `discount_percent`. Deals created before 0018 have no `list_price` (not back-filled).

**Corrections:** nothing financial is edited or deleted after the fact. A wrong payment is *cancelled* (row kept, stops counting); an invoice adjustment is *reversed* by a mirror row; approved salary amounts are locked (cancel and re-create if unpaid). Every change is in `audit_logs` (admin-only for these tables).

**Not in scope:** gateways/bank feeds, tax, profit & loss, budgeting, forecasting.
