import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, ChevronLeft, ChevronRight, PhoneCall, Plane } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  SectionCard,
} from "@/components/crm/ui-bits";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import {
  addDays,
  monthBounds,
  useAttendanceSettings,
  useAttendanceToday,
  useLeaveRequests,
} from "@/lib/attendance";
import { supabase, unwrap } from "@/lib/supabase";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/calendar")({
  head: () => ({ meta: [{ title: "Calendar — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <CalendarPage />
    </AppShell>
  ),
});

type Item =
  | { kind: "follow_up"; id: string; title: string; at: string }
  | { kind: "task"; id: string; title: string; at: string }
  | { kind: "leave"; id: string; title: string; at: string };

const ICON = { follow_up: PhoneCall, task: CheckSquare, leave: Plane } as const;
const TONE = {
  follow_up: "bg-primary/10 text-primary",
  task: "bg-warning/15 text-warning",
  leave: "bg-success/12 text-success",
} as const;

function CalendarPage() {
  const { profile, role } = useAuth();
  const me = profile?.id ?? "";
  const { tz, policy } = useAttendanceSettings();
  const today = useAttendanceToday().data ?? "";
  const [anchor, setAnchor] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(role === "bds_employee" || role === "mentor");
  const [picked, setPicked] = useState<string | null>(null);
  const date = anchor ?? today;
  const { from, to } = date ? monthBounds(date) : { from: "", to: "" };
  const dayOf = useMemo(() => {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return (iso: string) => f.format(new Date(iso));
  }, [tz]);

  // [from 00:00, next-month 00:00) in the company timezone, expressed as instants
  const range = useMemo(() => {
    if (!from) return null;
    const start = new Date(`${from}T00:00:00+05:30`); // tz offset only widens the window; items are re-bucketed by dayOf()
    const end = new Date(`${addDays(to, 1)}T00:00:00+05:30`);
    return {
      s: new Date(start.getTime() - 864e5).toISOString(),
      e: new Date(end.getTime() + 864e5).toISOString(),
    };
  }, [from, to]);

  const q = useQuery({
    queryKey: ["calendar", from, mineOnly, me],
    enabled: !!range && !!me,
    queryFn: async (): Promise<Item[]> => {
      let leads = supabase
        .from("leads")
        .select("id,company_name,next_follow_up_at,owner_id,stage")
        .is("archived_at", null)
        .gte("next_follow_up_at", range!.s)
        .lt("next_follow_up_at", range!.e)
        .limit(500);
      let tasks = supabase
        .from("tasks")
        .select("id,title,due_at,assigned_to,status")
        .in("status", ["todo", "in_progress"])
        .gte("due_at", range!.s)
        .lt("due_at", range!.e)
        .limit(500);
      if (mineOnly) {
        leads = leads.eq("owner_id", me);
        tasks = tasks.eq("assigned_to", me);
      }
      const [l, t] = await Promise.all([leads, tasks]);
      return [
        ...(unwrap(l) as { id: string; company_name: string; next_follow_up_at: string }[]).map(
          (x) => ({
            kind: "follow_up" as const,
            id: x.id,
            title: x.company_name,
            at: x.next_follow_up_at,
          }),
        ),
        ...(unwrap(t) as { id: string; title: string; due_at: string }[]).map((x) => ({
          kind: "task" as const,
          id: x.id,
          title: x.title,
          at: x.due_at,
        })),
      ];
    },
  });

  // my approved leave, expanded to days
  const leave = useLeaveRequests();
  const leaveDays = useMemo(() => {
    const out: Item[] = [];
    for (const l of leave.data ?? []) {
      if (l.user_id !== me || l.status !== "approved") continue;
      for (let d = l.start_date; d <= l.end_date; d = addDays(d, 1))
        out.push({
          kind: "leave",
          id: `${l.id}-${d}`,
          title: `On leave${l.is_half_day ? " (half day)" : ""}`,
          at: `${d}T12:00:00+05:30`,
        });
    }
    return out;
  }, [leave.data, me]);

  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of [...(q.data ?? []), ...leaveDays]) {
      const d = it.kind === "leave" ? it.at.slice(0, 10) : dayOf(it.at);
      (m.get(d) ?? m.set(d, []).get(d)!).push(it);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.at.localeCompare(b.at));
    return m;
  }, [q.data, leaveDays, dayOf]);

  if (!today) return <LoadingBlock rows={4} />;
  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = from; d <= to; d = addDays(d, 1)) cells.push(d);
  const isOff = (d: string) => {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    return policy.weekly_offs.includes(dow) || policy.holidays.includes(d);
  };
  const open = picked ? (byDay.get(picked) ?? []) : [];

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Follow-ups, task deadlines and your approved leave"
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={mineOnly} onCheckedChange={setMineOnly} /> Mine only
            </label>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous month"
              onClick={() => setAnchor(addDays(from, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-28 text-center text-sm font-medium">{from.slice(0, 7)}</span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next month"
              onClick={() => setAnchor(addDays(to, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAnchor(null);
                setPicked(today);
              }}
            >
              Today
            </Button>
          </>
        }
      />
      {q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.isLoading ? <LoadingBlock rows={4} /> : null}
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const items = byDay.get(d) ?? [];
          return (
            <button
              type="button"
              key={d}
              onClick={() => setPicked(d)}
              className={cn(
                "min-h-20 rounded-md border p-1.5 text-left text-[11px] leading-tight sm:min-h-24",
                isOff(d) ? "bg-muted/50 text-muted-foreground" : "bg-card",
                d === today && "border-primary",
                d === picked && "ring-2 ring-primary",
              )}
            >
              <span className="font-semibold">{Number(d.slice(8))}</span>
              <span className="mt-0.5 block space-y-0.5">
                {items.slice(0, 3).map((it) => {
                  const Icon = ICON[it.kind];
                  return (
                    <span
                      key={it.kind + it.id}
                      className={cn(
                        "flex items-center gap-1 truncate rounded px-1 py-0.5",
                        TONE[it.kind],
                      )}
                    >
                      <Icon className="size-3 shrink-0" />{" "}
                      <span className="truncate">{it.title}</span>
                    </span>
                  );
                })}
                {items.length > 3 ? (
                  <span className="block text-muted-foreground">+{items.length - 3} more</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {picked ? (
        <SectionCard title={picked} className="mt-4">
          {open.length === 0 ? (
            <EmptyState message="Nothing scheduled." />
          ) : (
            <ul className="space-y-2 text-sm">
              {open.map((it) => {
                const Icon = ICON[it.kind];
                return (
                  <li key={it.kind + it.id} className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" />
                    {it.kind === "follow_up" ? (
                      <Link
                        to="/leads/$leadId"
                        params={{ leadId: it.id }}
                        className="hover:underline"
                      >
                        Follow up — {it.title}
                      </Link>
                    ) : it.kind === "task" ? (
                      <Link to="/tasks" className="hover:underline">
                        Task — {it.title}
                      </Link>
                    ) : (
                      <span>{it.title}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      ) : null}
    </>
  );
}
