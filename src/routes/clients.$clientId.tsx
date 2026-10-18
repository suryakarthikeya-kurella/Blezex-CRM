import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/app-shell";
import {
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@/components/crm/ui-bits";
import { useClient } from "@/lib/api";
import { date, money } from "@/lib/format";

export const Route = createFileRoute("/clients/$clientId")({ component: Page });

/* eslint-disable @typescript-eslint/no-explicit-any */
function Page() {
  const { clientId } = Route.useParams();
  const q = useClient(clientId);
  if (q.isLoading) return <LoadingBlock rows={5} />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data?.client;
  if (!c) return <AccessDenied message="This client doesn't exist or you don't have access." />;
  const h = q.data?.handover as any;
  return (
    <>
      <Link
        to="/clients"
        className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3" /> Clients
      </Link>
      <PageHeader
        title={c.company_name}
        subtitle={`${c.client_number} · relationship owner: ${h?.relationship_owner ?? "—"}`}
        actions={
          <>
            <StatusPill value={c.status} />
            {c.source_lead_id ? (
              <Link
                to="/leads/$leadId"
                params={{ leadId: c.source_lead_id }}
                className="text-sm text-primary hover:underline"
              >
                Source lead
              </Link>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Client">
          <dl className="space-y-1.5 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Contact</dt>
              <dd>{c.contact_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd className="break-all">{c.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Phone</dt>
              <dd>{c.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Website</dt>
              <dd className="break-all">{c.website ?? "—"}</dd>
            </div>
          </dl>
        </SectionCard>
        <div className="space-y-4 lg:col-span-2">
          <SectionCard title="Handover">
            {(h?.projects ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No project recorded yet.</p>
            ) : (
              (h.projects as any[]).map((p) => (
                <div
                  key={p.project_number}
                  className="mb-4 border-b border-border pb-4 last:mb-0 last:border-0 last:pb-0"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium">
                      {p.project_number} — {p.name}
                    </p>
                    <StatusPill value={p.status} />
                  </div>
                  <dl className="mt-2 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Service</dt>
                      <dd>{p.service ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Deal value</dt>
                      <dd>{money(p.deal_value, p.currency)}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-muted-foreground">Scope</dt>
                      <dd className="whitespace-pre-wrap">{p.scope ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Payment terms</dt>
                      <dd>{p.payment_terms ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Key commitments</dt>
                      <dd>{p.commitments ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Timeline</dt>
                      <dd>
                        {date(p.start_date)} → {date(p.target_end_date)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Next action</dt>
                      <dd>{p.next_action ?? "—"}</dd>
                    </div>
                    {p.proposal ? (
                      <div className="sm:col-span-2">
                        <dt className="text-xs text-muted-foreground">Proposal</dt>
                        <dd>
                          {p.proposal.proposal_number} v{p.proposal.version} ·{" "}
                          {money(p.proposal.amount)} · {p.proposal.status}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              ))
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}
