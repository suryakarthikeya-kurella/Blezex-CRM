import { lazy, Suspense, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  SectionCard,
} from "@/components/crm/ui-bits";
import { SelectBox } from "@/components/crm/controls";
import { Button } from "@/components/ui/button";
import { AttentionPanel } from "@/components/dashboard/attention";
import { HeadlineCards, type DashView } from "@/components/dashboard/headline";
import { MoreSection } from "@/components/dashboard/more-section";
import { TodayStrip } from "@/components/dashboard/today-strip";
import { useAuth } from "@/lib/auth";
import { useActionItems, useDashboardHome, useReport } from "@/lib/api";
import { dateTime, num } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/permissions";

// recharts (the heaviest dependency) is split out and fetched after the first paint
const StageChart = lazy(() =>
  import("@/components/dashboard/charts").then((m) => ({ default: m.StageChart })),
);

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Dashboard />
    </AppShell>
  ),
});

type Target = {
  user_id: string;
  full_name: string;
  target_type: string;
  target_value: number;
  actual: number;
  pct: number | null;
};

const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
];

function Dashboard() {
  const { role, profile } = useAuth();
  const [days, setDays] = useState("30");
  const [mine, setMine] = useState(role === "bds_employee");
  const range = useMemo(
    () => ({
      from: new Date(Date.now() - Number(days) * 864e5).toISOString(),
      to: new Date(Date.now() + 60_000).toISOString(),
    }),
    [days],
  );
  const scope = mine || role === "bds_employee" ? "mine" : "visible";
  const home = useDashboardHome(range.from, range.to, scope);
  // secondary panels start loading only once the headline is on screen
  const ready = !!home.data;
  const actions = useActionItems(ready);
  const targets = useReport<Target>(
    "target_attainment",
    { p_from: range.from.slice(0, 10), p_to: range.to.slice(0, 10) },
    ready,
  );
  const company = role === "admin" && !mine;
  const teamView = role === "mentor" && !mine;
  const view: DashView =
    role === "admin" && !mine ? "admin" : role === "mentor" && !mine ? "mentor" : "employee";

  const title =
    role === "admin"
      ? mine
        ? "My dashboard"
        : "Company dashboard"
      : role === "mentor"
        ? mine
          ? "My dashboard"
          : "Team dashboard"
        : "My dashboard";
  const myTargets = (targets.data ?? []).filter(
    (t) => scope === "visible" || t.user_id === profile?.id,
  );

  return (
    <>
      <PageHeader
        title={title}
        subtitle={`${role ? ROLE_LABEL[role] : ""} workspace`}
        actions={
          <>
            {role !== "bds_employee" ? (
              <Button
                variant={mine ? "default" : "outline"}
                size="sm"
                onClick={() => setMine((m) => !m)}
              >
                {mine ? "Show " + (role === "admin" ? "company" : "team") : "Show my own"}
              </Button>
            ) : null}
            <SelectBox
              value={days}
              onChange={setDays}
              options={PERIODS}
              className="w-40"
              ariaLabel="Period"
            />
          </>
        }
      />

      {home.isLoading ? (
        <LoadingBlock rows={3} />
      ) : home.isError ? (
        <ErrorBlock error={home.error} onRetry={() => home.refetch()} />
      ) : home.data ? (
        <div className="space-y-4">
          <HeadlineCards view={view} data={home.data} />
          <TodayStrip
            me={profile?.id ?? ""}
            role={role}
            team={!mine && role !== "bds_employee"}
            data={home.data}
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <AttentionPanel data={home.data} />
            </div>
            <SectionCard
              title="My action centre"
              action={
                <Link to="/tasks" className="text-xs text-primary hover:underline">
                  Tasks
                </Link>
              }
            >
              {actions.isError ? (
                <ErrorBlock error={actions.error} />
              ) : actions.isLoading ? (
                <LoadingBlock rows={3} />
              ) : (actions.data ?? []).length === 0 ? (
                <EmptyState message="Nothing due today. 🎉" />
              ) : (
                <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
                  {(actions.data ?? []).slice(0, 20).map((a) => (
                    <li key={a.kind + a.id} className="flex items-start justify-between gap-2">
                      {a.kind === "follow_up" ? (
                        <Link
                          to="/leads/$leadId"
                          params={{ leadId: a.id }}
                          className="hover:underline"
                        >
                          Follow up — {a.title}
                        </Link>
                      ) : (
                        <span>Task — {a.title}</span>
                      )}
                      <span
                        className={
                          a.is_overdue
                            ? "shrink-0 text-xs font-medium text-destructive"
                            : "shrink-0 text-xs text-muted-foreground"
                        }
                      >
                        {a.is_overdue ? "Overdue" : dateTime(a.due_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard title="Leads by stage" className="lg:col-span-2">
              <Suspense fallback={<LoadingBlock rows={4} />}>
                <StageChart data={home.data.summary.by_stage} />
              </Suspense>
            </SectionCard>
            <SectionCard title="Target progress">
              {targets.isLoading ? (
                <LoadingBlock rows={3} />
              ) : myTargets.length === 0 ? (
                <EmptyState message="No targets set for this period." />
              ) : (
                <div className="max-h-64 space-y-3 overflow-y-auto">
                  {myTargets.map((t, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-xs">
                        <span>
                          {scope === "visible" ? `${t.full_name} · ` : ""}
                          {t.target_type.replace(/_/g, " ")}
                        </span>
                        <span>
                          {num(t.actual)} / {num(t.target_value)}
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.min(100, t.pct ?? 0)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <MoreSection data={home.data} range={range} company={company} teamView={teamView} />
        </div>
      ) : null}
    </>
  );
}
