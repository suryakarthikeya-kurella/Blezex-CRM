import { lazy, Suspense, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  ErrorBlock,
  KpiCard,
  LoadingBlock,
  SectionCard,
} from "@/components/crm/ui-bits";
import { useReport, type DashboardHome } from "@/lib/api";
import { money, num } from "@/lib/format";

const GrowthChart = lazy(() => import("./charts").then((m) => ({ default: m.GrowthChart })));

type EmpRow = {
  user_id: string;
  full_name: string;
  active_leads: number;
  meetings: number;
  proposals: number;
  conversions: number;
  lost: number;
  outreach: number;
  tasks_completed: number;
  conversion_rate: number | null;
};
type TeamRow = {
  team_id: string;
  team_name: string;
  members: number;
  new_leads: number;
  meetings: number;
  conversions: number;
  outreach: number;
  won_value: number;
};
type Growth = { month: string; new_leads: number; won: number };
type Revenue = { invoiced: number; collected: number; outstanding: number; overdue: number };

/** Secondary detail, collapsed by default. Nothing here is fetched until the section is opened. */
export function MoreSection({
  data,
  range,
  company,
  teamView,
}: {
  data: DashboardHome;
  range: { from: string; to: string };
  company: boolean;
  teamView: boolean;
}) {
  const [open, setOpen] = useState(false);
  const s = data.summary;
  const args = { p_from: range.from, p_to: range.to };
  const emp = useReport<EmpRow>("report_by_employee", args, open && (company || teamView));
  const teams = useReport<TeamRow>("report_by_team", args, open && company);
  const growth = useReport<Growth>("report_monthly_growth", { p_months: 6 }, open && company);
  const revenue = useReport<Revenue>(
    "report_revenue",
    { p_from: range.from.slice(0, 10), p_to: range.to.slice(0, 10) },
    open && company,
  );
  const rev = revenue.data?.[0] as unknown as Revenue | undefined;

  return (
    <section className="mt-6">
      <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Hide details" : "More details"}
      </Button>
      {open ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="New leads" value={num(s.new_leads)} hint="created in period" />
            <KpiCard
              label="Qualified"
              value={num(s.qualified)}
              hint="entered Qualified in period"
            />
            <KpiCard label="Meetings booked" value={num(s.meetings_booked)} />
            <KpiCard label="Proposals sent" value={num(s.proposals_sent)} />
            <KpiCard label="Won / Lost" value={`${num(s.won)} / ${num(s.lost)}`} />
            <KpiCard label="Follow-ups today" value={num(s.follow_ups_today)} />
            <KpiCard label="Tasks due today" value={num(s.tasks_due_today)} />
            <KpiCard label="Pending approvals" value={num(s.pending_approvals)} />
          </div>

          {company ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title="Revenue (cash vs. billed vs. won)">
                {revenue.isError ? (
                  <ErrorBlock error={revenue.error} />
                ) : rev ? (
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Invoiced</dt>
                      <dd className="font-semibold">{money(rev.invoiced)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Payments received (net)</dt>
                      <dd className="font-semibold text-success">{money(rev.collected)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Outstanding</dt>
                      <dd className="font-semibold">{money(rev.outstanding)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Overdue</dt>
                      <dd className="font-semibold text-destructive">{money(rev.overdue)}</dd>
                    </div>
                  </dl>
                ) : (
                  <LoadingBlock rows={2} />
                )}
              </SectionCard>
              <SectionCard title="Monthly growth (last 6 months)">
                <Suspense fallback={<LoadingBlock rows={3} />}>
                  <GrowthChart data={growth.data ?? []} />
                </Suspense>
              </SectionCard>
              <SectionCard title="Team performance" className="lg:col-span-2">
                {teams.isError ? (
                  <ErrorBlock error={teams.error} />
                ) : teams.isLoading ? (
                  <LoadingBlock rows={3} />
                ) : (teams.data ?? []).length === 0 ? (
                  <EmptyState message="No teams yet — create one under Team." />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Team</TableHead>
                          <TableHead className="text-right">Members</TableHead>
                          <TableHead className="text-right">New leads</TableHead>
                          <TableHead className="text-right">Outreach</TableHead>
                          <TableHead className="text-right">Meetings</TableHead>
                          <TableHead className="text-right">Won</TableHead>
                          <TableHead className="text-right">Won value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(teams.data ?? []).map((t) => (
                          <TableRow key={t.team_id}>
                            <TableCell className="font-medium">{t.team_name}</TableCell>
                            <TableCell className="text-right">{t.members}</TableCell>
                            <TableCell className="text-right">{num(t.new_leads)}</TableCell>
                            <TableCell className="text-right">{num(t.outreach)}</TableCell>
                            <TableCell className="text-right">{num(t.meetings)}</TableCell>
                            <TableCell className="text-right">{num(t.conversions)}</TableCell>
                            <TableCell className="text-right">{money(t.won_value)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </SectionCard>
            </div>
          ) : null}

          {company || teamView ? (
            <SectionCard title={teamView ? "My team — employee activity" : "Employee performance"}>
              {emp.isError ? (
                <ErrorBlock error={emp.error} />
              ) : emp.isLoading ? (
                <LoadingBlock rows={3} />
              ) : (emp.data ?? []).length === 0 ? (
                <EmptyState message="No team members to show." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Active leads</TableHead>
                        <TableHead className="text-right">Outreach</TableHead>
                        <TableHead className="text-right">Meetings</TableHead>
                        <TableHead className="text-right">Proposals</TableHead>
                        <TableHead className="text-right">Won</TableHead>
                        <TableHead className="text-right">Lost</TableHead>
                        <TableHead className="text-right">Conv. %</TableHead>
                        <TableHead className="text-right">Tasks done</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(emp.data ?? []).map((e) => (
                        <TableRow key={e.user_id}>
                          <TableCell className="font-medium">{e.full_name}</TableCell>
                          <TableCell className="text-right">{e.active_leads}</TableCell>
                          <TableCell className="text-right">{num(e.outreach)}</TableCell>
                          <TableCell className="text-right">{num(e.meetings)}</TableCell>
                          <TableCell className="text-right">{num(e.proposals)}</TableCell>
                          <TableCell className="text-right">{num(e.conversions)}</TableCell>
                          <TableCell className="text-right">{num(e.lost)}</TableCell>
                          <TableCell className="text-right">{e.conversion_rate ?? "—"}</TableCell>
                          <TableCell className="text-right">{num(e.tasks_completed)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </SectionCard>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
