import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Download, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  StatusPill,
} from "@/components/crm/ui-bits";
import { Pager, SelectBox } from "@/components/crm/controls";
import { useAuth } from "@/lib/auth";
import { supabase, unwrap } from "@/lib/supabase";
import { date as fmtDate, downloadCsv } from "@/lib/format";
import {
  CSV_COLUMNS,
  SUMMARY_COLUMNS,
  summaryCsvRows,
  STATUS_LABEL,
  STATUS_OPTIONS,
  addDays,
  clock,
  dayStats,
  fetchReport,
  hm,
  isOffDay,
  monthBounds,
  rangeFor,
  summarize,
  toCsvRows,
  useAttendanceReport,
  useAttendanceSettings,
  useAttendanceToday,
  useCorrections,
  useLeaveRequests,
  type AttRow,
  type AttStatus,
  type RangeKind,
} from "@/lib/attendance";
import { MyDayCard } from "./my-day-card";
import { MonthCalendar } from "./month-calendar";
import { LeavePanel } from "./leave-panel";
import { PolicyDialog } from "./policy-dialog";
import { CorrectionDialog, CorrectionsPanel, type CorrectionTarget } from "./corrections";

const PAGE = 25;
const RANGES: { value: RangeKind; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

function step(kind: RangeKind, d: string, dir: 1 | -1) {
  if (kind === "day") return addDays(d, dir);
  if (kind === "week") return addDays(d, 7 * dir);
  const { from, to } = monthBounds(d);
  return dir === 1 ? addDays(to, 1) : addDays(from, -1);
}

/** Attendance & work hours. Scope (own / assigned team / everyone) is enforced by Postgres RLS inside
 *  attendance_report(); this component only chooses what to display. */
export function AttendanceView() {
  const { profile, isAdmin, role } = useAuth();
  const me = profile?.id ?? "";
  const isMentor = role === "mentor";
  const { tz, policy } = useAttendanceSettings();
  const todayQ = useAttendanceToday();
  const today = todayQ.data ?? "";

  const [anchor, setAnchor] = useState<string | null>(null);
  const date = anchor ?? today;
  const [kind, setKind] = useState<RangeKind>("day");
  const [scope, setScope] = useState<"team" | "mine">("team"); // mentors only
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState("records");
  const [page, setPage] = useState(0);
  const [calUser, setCalUser] = useState("");
  const [policyOpen, setPolicyOpen] = useState(false);
  const [fix, setFix] = useState<{ mode: "request" | "admin"; t: CorrectionTarget } | null>(null);
  const [exp, setExp] = useState<{ from: string; to: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const ownView = !isAdmin && (!isMentor || scope === "mine"); // whose rows are shown
  const range = date ? rangeFor(kind, date) : { from: "", to: "" };
  const teams = useQuery({
    queryKey: ["attendance", "teams"],
    queryFn: async () =>
      unwrap(
        await supabase.from("teams").select("id,name").eq("status", "active").order("name"),
      ) as { id: string; name: string }[],
  });
  const corrections = useCorrections();
  const leave = useLeaveRequests();
  const report = useAttendanceReport(
    {
      ...range,
      ...(ownView ? { user: me } : {}),
      team: ownView ? "" : team,
      role: isAdmin ? roleFilter : "",
    },
    !!date,
  );

  // Rows in the chosen scope (mentor "team" view excludes the mentor's own row).
  const scoped = useMemo(
    () =>
      (report.data ?? []).filter((r) => (isMentor && scope === "team" ? r.user_id !== me : true)),
    [report.data, isMentor, scope, me],
  );
  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      scoped.filter(
        (r) =>
          (!needle || r.full_name.toLowerCase().includes(needle)) &&
          (status ? r.status === status : kind === "day" || !isOffDay(r.status)),
      ),
    [scoped, needle, status, kind],
  );
  const stats = useMemo(
    () => dayStats(ownView ? scoped : scoped.filter((r) => r.work_date === date)),
    [scoped, ownView, date],
  );
  // approvers: requests awaiting their decision; applicants: their own pending requests
  const leaveBadge = (leave.data ?? []).filter((l) =>
    isAdmin || isMentor ? l.can_decide : l.user_id === me && l.status === "pending",
  ).length;
  const summary = useMemo(() => summarize(filtered), [filtered]);
  const pending = (corrections.data ?? []).filter(
    (c) => c.status === "pending" && (!ownView || c.user_id === me),
  ).length;
  const people = useMemo(
    () => [...new Map(scoped.map((r) => [r.user_id, r.full_name])).entries()],
    [scoped],
  );
  const calTarget = ownView ? me : calUser || people[0]?.[0] || "";
  const month = date ? monthBounds(date) : { from: "", to: "" };
  const cal = useAttendanceReport(
    { ...month, user: calTarget },
    tab === "calendar" && !!date && !!calTarget,
  );

  if (!today) return todayQ.isError ? <ErrorBlock error={todayQ.error} /> : <LoadingBlock />;

  const isToday = date === today;
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const openFix = (r: AttRow) =>
    setFix({
      mode: isAdmin ? "admin" : "request",
      t: {
        userId: r.user_id,
        name: r.full_name,
        date: r.work_date,
        checkIn: r.check_in_at,
        checkOut: r.check_out_at,
      },
    });
  const reset = () => setPage(0);

  const exportCsv = async (e: { from: string; to: string }) => {
    if (!e.from || !e.to) return;
    setExporting(true);
    try {
      const rows = (
        await fetchReport({
          ...e,
          ...(ownView ? { user: me } : {}),
          team: ownView ? "" : team,
          role: isAdmin ? roleFilter : "",
        })
      ).filter(
        (r) =>
          !(isMentor && scope === "team" && r.user_id === me) &&
          (!needle || r.full_name.toLowerCase().includes(needle)) &&
          (!status || r.status === status),
      );
      if (!rows.length) toast.info("Nothing to export for that range.");
      else downloadCsv(`attendance_${e.from}_to_${e.to}.csv`, CSV_COLUMNS, toCsvRows(rows, tz));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const cards = ownView
    ? [
        <KpiCard key="p" label="Days present" value={stats.present} tone="success" />,
        <KpiCard key="l" label="Late arrivals" value={stats.late} tone="warning" />,
        <KpiCard key="a" label="Absent" value={stats.absent} tone="danger" />,
        <KpiCard key="o" label="Leave days" value={stats.onLeave} tone="primary" />,
        <KpiCard key="m" label="Missing check-outs" value={stats.missingCheckout} tone="danger" />,
        <KpiCard key="n" label="Avg net hours" value={hm(stats.avgNetMinutes)} />,
        <KpiCard key="c" label="Pending corrections" value={pending} tone="primary" />,
      ]
    : [
        <KpiCard
          key="p"
          label={isToday ? "Present today" : "Present"}
          value={stats.present}
          tone="success"
        />,
        <KpiCard key="l" label="Late arrivals" value={stats.late} tone="warning" />,
        <KpiCard key="a" label="Absent" value={stats.absent} tone="danger" />,
        <KpiCard key="o" label="On leave" value={stats.onLeave} tone="primary" />,
        <KpiCard key="m" label="Missing check-outs" value={stats.missingCheckout} tone="danger" />,
        <KpiCard
          key="i"
          label="Checked in now"
          value={isToday ? stats.checkedIn : "—"}
          {...(isToday ? {} : { hint: "Live count is for today" })}
          tone="primary"
        />,
        <KpiCard key="n" label="Avg net hours" value={hm(stats.avgNetMinutes)} />,
        <KpiCard key="c" label="Pending corrections" value={pending} tone="primary" />,
      ];

  return (
    <>
      {role !== "admin" && me ? <MyDayCard userId={me} today={today} /> : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {isMentor ? (
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Attendance scope">
            {(
              [
                ["team", "My team attendance"],
                ["mine", "My attendance"],
              ] as const
            ).map(([v, l]) => (
              <Button
                key={v}
                size="sm"
                variant={scope === v ? "default" : "ghost"}
                onClick={() => {
                  setScope(v);
                  reset();
                }}
              >
                {l}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            aria-label="Previous"
            onClick={() => {
              setAnchor(step(kind, date, -1));
              reset();
            }}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Input
            type="date"
            aria-label="Date"
            className="w-40"
            value={date}
            max={today}
            onChange={(e) => {
              setAnchor(e.target.value || null);
              reset();
            }}
          />
          <Button
            variant="outline"
            size="icon"
            className="size-9"
            aria-label="Next"
            disabled={rangeFor(kind, date).to >= today}
            onClick={() => {
              setAnchor(step(kind, date, 1));
              reset();
            }}
          >
            <ChevronRight className="size-4" />
          </Button>
          {!isToday ? (
            <Button variant="ghost" size="sm" onClick={() => setAnchor(null)}>
              Today
            </Button>
          ) : null}
        </div>
        <SelectBox
          value={kind}
          onChange={(v) => {
            setKind((v || "day") as RangeKind);
            reset();
          }}
          options={RANGES}
          className="w-28"
          ariaLabel="Range"
        />
        {isAdmin ? (
          <Button variant="outline" className="ml-auto" onClick={() => setPolicyOpen(true)}>
            <Settings2 className="size-4" /> Policy
          </Button>
        ) : null}
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        {range.from === range.to
          ? fmtDate(range.from)
          : `${fmtDate(range.from)} – ${fmtDate(range.to)}`}
        {" · "}Schedule {policy.work_start}–{policy.work_end}, lunch {policy.lunch_start}–
        {policy.lunch_end} ({tz})
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">{cards}</div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {!ownView ? (
          <Input
            aria-label="Search by name"
            placeholder="Search by name"
            className="w-48"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              reset();
            }}
          />
        ) : null}
        {!ownView && (teams.data?.length ?? 0) > 0 ? (
          <SelectBox
            value={team}
            onChange={(v) => {
              setTeam(v);
              reset();
            }}
            options={(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
            allLabel="All teams"
          />
        ) : null}
        {isAdmin ? (
          <SelectBox
            value={roleFilter}
            onChange={(v) => {
              setRoleFilter(v);
              reset();
            }}
            options={[
              { value: "mentor", label: "Mentors" },
              { value: "bds_employee", label: "Employees" },
            ]}
            allLabel="All roles"
          />
        ) : null}
        <SelectBox
          value={status}
          onChange={(v) => {
            setStatus(v);
            reset();
          }}
          options={STATUS_OPTIONS}
          allLabel="All statuses"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="leave">Leave{leaveBadge ? ` (${leaveBadge})` : ""}</TabsTrigger>
          <TabsTrigger value="corrections">Corrections{pending ? ` (${pending})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="mt-3">
          {report.isLoading ? (
            <LoadingBlock />
          ) : report.isError ? (
            <ErrorBlock error={report.error} onRetry={() => void report.refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState message="No attendance records match these filters." />
          ) : (
            <div className="surface overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Check-in</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead>Sessions</TableHead>
                    <TableHead>Break</TableHead>
                    <TableHead>Net work</TableHead>
                    <TableHead>Late</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => (
                    <TableRow key={`${r.user_id}|${r.work_date}`}>
                      <TableCell className="text-xs font-medium">{r.full_name}</TableCell>
                      <TableCell className="text-xs">
                        {r.role === "mentor" ? "Mentor" : "Employee"}
                      </TableCell>
                      <TableCell className="text-xs">{r.teams ?? "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {fmtDate(r.work_date)}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {clock(r.check_in_at, tz)}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {clock(r.check_out_at, tz)}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {(r.sessions ?? []).length > 1
                          ? (r.sessions ?? []).map((s, i) => (
                              <span key={i} className="block">
                                {clock(s.in, tz)} – {s.out ? clock(s.out, tz) : "now"}
                              </span>
                            ))
                          : (r.sessions ?? []).length === 1
                            ? "1 session"
                            : "—"}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {r.break_minutes == null ? "—" : `${r.break_minutes} min`}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {hm(r.net_minutes)}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {r.late_minutes > 0 ? `${r.late_minutes} min` : "—"}
                      </TableCell>
                      <TableCell className="space-x-1 whitespace-nowrap">
                        <StatusPill value={r.status} className="" />
                        {r.is_corrected ? (
                          <span className="text-[10px] text-muted-foreground">corrected</span>
                        ) : null}
                        {r.early_minutes > 0 && r.check_out_at ? (
                          <span className="text-[10px] text-muted-foreground">
                            left {r.early_minutes}m early
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {isAdmin ? (
                          <Button size="sm" variant="ghost" onClick={() => openFix(r)}>
                            Correct
                          </Button>
                        ) : r.user_id === me &&
                          !isOffDay(r.status) &&
                          r.status !== "on_leave" &&
                          r.status !== "not_checked_in" ? (
                          <Button size="sm" variant="ghost" onClick={() => openFix(r)}>
                            Request correction
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pager page={page} total={filtered.length} pageSize={PAGE} onPage={setPage} />
        </TabsContent>

        <TabsContent value="summary" className="mt-3">
          {summary.length > 0 ? (
            <div className="mb-2 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCsv(
                    `attendance_summary_${range.from}_to_${range.to}.csv`,
                    SUMMARY_COLUMNS,
                    summaryCsvRows(summary),
                  )
                }
              >
                <Download className="size-4" /> Export summary (payroll) CSV
              </Button>
            </div>
          ) : null}
          {summary.length === 0 ? (
            <EmptyState message="Nothing to summarise for this range." />
          ) : (
            <div className="surface overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Present</TableHead>
                    <TableHead>Late</TableHead>
                    <TableHead>Half day</TableHead>
                    <TableHead>Absent</TableHead>
                    <TableHead>On leave</TableHead>
                    <TableHead>Missing check-out</TableHead>
                    <TableHead>Net work</TableHead>
                    <TableHead>Avg / day</TableHead>
                    <TableHead>Late (min)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((s) => (
                    <TableRow key={s.user_id}>
                      <TableCell className="text-xs font-medium">{s.full_name}</TableCell>
                      <TableCell className="text-xs">
                        {s.role === "mentor" ? "Mentor" : "Employee"}
                      </TableCell>
                      <TableCell className="text-xs">{s.present}</TableCell>
                      <TableCell className="text-xs">{s.late}</TableCell>
                      <TableCell className="text-xs">{s.half_day}</TableCell>
                      <TableCell className="text-xs">{s.absent}</TableCell>
                      <TableCell className="text-xs">{s.on_leave}</TableCell>
                      <TableCell className="text-xs">{s.incomplete}</TableCell>
                      <TableCell className="text-xs">{hm(s.net_minutes)}</TableCell>
                      <TableCell className="text-xs">
                        {s.worked_days ? hm(Math.round(s.net_minutes / s.worked_days)) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{s.late_minutes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="calendar" className="mt-3">
          <SectionCard
            title={`Monthly calendar — ${month.from.slice(0, 7)}`}
            action={
              !ownView && people.length > 0 ? (
                <SelectBox
                  value={calTarget}
                  onChange={setCalUser}
                  options={people.map(([id, name]) => ({ value: id, label: name }))}
                  ariaLabel="Person"
                  className="w-48"
                />
              ) : undefined
            }
          >
            {!calTarget ? (
              <EmptyState message="No one to show." />
            ) : cal.isLoading ? (
              <LoadingBlock />
            ) : cal.isError ? (
              <ErrorBlock error={cal.error} />
            ) : (
              <MonthCalendar
                from={month.from}
                rows={cal.data ?? []}
                tz={tz}
                onPick={(r) => {
                  setAnchor(r.work_date);
                  setKind("day");
                  setTab("records");
                  setSearch(ownView ? "" : r.full_name);
                  reset();
                }}
              />
            )}
          </SectionCard>
          <p className="mt-2 text-xs text-muted-foreground">
            Statuses:{" "}
            {(Object.keys(STATUS_LABEL) as AttStatus[]).map((s) => STATUS_LABEL[s]).join(" · ")}
          </p>
        </TabsContent>

        <TabsContent value="leave" className="mt-3">
          <LeavePanel me={me} isAdmin={isAdmin} today={today} />
        </TabsContent>

        <TabsContent value="corrections" className="mt-3">
          <CorrectionsPanel isAdmin={isAdmin} me={me} />
        </TabsContent>
      </Tabs>

      <SectionCard title="Report & export" className="mt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="exp-from" className="mb-1.5 block text-xs">
              From
            </Label>
            <Input
              id="exp-from"
              type="date"
              className="w-40"
              max={today}
              value={(exp ?? range).from}
              onChange={(e) => setExp({ from: e.target.value, to: (exp ?? range).to })}
            />
          </div>
          <div>
            <Label htmlFor="exp-to" className="mb-1.5 block text-xs">
              To
            </Label>
            <Input
              id="exp-to"
              type="date"
              className="w-40"
              max={today}
              value={(exp ?? range).to}
              onChange={(e) => setExp({ from: (exp ?? range).from, to: e.target.value })}
            />
          </div>
          <Button
            variant="outline"
            disabled={exporting}
            onClick={() => void exportCsv(exp ?? range)}
          >
            <Download className="size-4" /> {exporting ? "Preparing…" : "Export CSV"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Uses the filters above. Up to 93 days; includes only people you are allowed to see.
          </p>
        </div>
      </SectionCard>

      <PolicyDialog open={policyOpen} onOpenChange={setPolicyOpen} />
      <CorrectionDialog
        mode={fix?.mode ?? "request"}
        target={fix?.t ?? null}
        onClose={() => setFix(null)}
      />
    </>
  );
}
