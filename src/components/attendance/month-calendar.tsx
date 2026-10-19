import { cn } from "@/lib/utils";
import { STATUS_LABEL, addDays, clock, hm, type AttRow, type AttStatus } from "@/lib/attendance";

const TONE: Record<AttStatus, string> = {
  present: "border-success/30 bg-success/10",
  late: "border-warning/40 bg-warning/15",
  half_day: "border-warning/40 bg-warning/15",
  absent: "border-destructive/30 bg-destructive/10",
  incomplete: "border-destructive/30 bg-destructive/10",
  not_checked_in: "border-border bg-muted/40",
  weekly_off: "border-border bg-muted/60 text-muted-foreground",
  holiday: "border-primary/25 bg-primary/10",
  on_leave: "border-primary/25 bg-primary/10",
};

/** One person, one month (Monday-first). Cell content is the server-derived report row. */
export function MonthCalendar({
  from,
  rows,
  tz,
  onPick,
}: {
  from: string; // first day of the month, YYYY-MM-DD
  rows: AttRow[];
  tz: string;
  onPick?: (row: AttRow) => void;
}) {
  const byDate = new Map(rows.map((r) => [r.work_date, r]));
  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const month = from.slice(0, 7);
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = from; d.startsWith(month); d = addDays(d, 1)) cells.push(d);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          const r = d ? byDate.get(d) : undefined;
          if (!d) return <div key={`b${i}`} />;
          return (
            <button
              type="button"
              key={d}
              disabled={!r || !onPick}
              onClick={() => r && onPick?.(r)}
              title={r ? STATUS_LABEL[r.status] : "No data"}
              className={cn(
                "min-h-16 rounded-md border p-1.5 text-left text-[11px] leading-tight sm:min-h-20",
                r ? TONE[r.status] : "border-dashed border-border text-muted-foreground",
              )}
            >
              <span className="font-semibold">{Number(d.slice(8))}</span>
              {r ? (
                <>
                  <span className="mt-0.5 block truncate">{STATUS_LABEL[r.status]}</span>
                  {r.check_in_at ? (
                    <span className="hidden sm:block">
                      {clock(r.check_in_at, tz)} – {clock(r.check_out_at, tz)}
                    </span>
                  ) : null}
                  {r.net_minutes != null ? (
                    <span className="hidden text-muted-foreground sm:block">
                      {hm(r.net_minutes)}
                    </span>
                  ) : null}
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
