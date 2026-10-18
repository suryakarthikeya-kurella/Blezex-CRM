import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  SectionCard,
} from "@/components/crm/ui-bits";
import { useUserName } from "@/components/crm/controls";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/crm/controls";
import { useAuth } from "@/lib/auth";
import { supabase, unwrap } from "@/lib/supabase";
import { date } from "@/lib/format";

export const Route = createFileRoute("/daily-reports")({
  head: () => ({ meta: [{ title: "Daily reports — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});
type R = {
  id: string;
  user_id: string;
  report_date: string;
  summary: string | null;
  leads_created: number;
  outreach_completed: number;
  meetings_booked: number;
  proposals_sent: number;
  wins: string | null;
  blockers: string | null;
  next_day_plan: string | null;
};

function Page() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const userName = useUserName();
  const today = new Date().toLocaleDateString("en-CA");
  const q = useQuery({
    queryKey: ["daily-reports"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("daily_reports")
          .select("*")
          .order("report_date", { ascending: false })
          .limit(60),
      ) as R[],
  });
  const mine = q.data?.find((r) => r.user_id === profile?.id && r.report_date === today);
  const [f, setF] = useState<Record<string, string>>({});
  const val = (k: keyof R) => f[k] ?? (mine?.[k] as string | null) ?? "";
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        summary: val("summary"),
        wins: val("wins"),
        blockers: val("blockers"),
        next_day_plan: val("next_day_plan"),
      };
      if (mine) unwrap(await supabase.from("daily_reports").update(body).eq("id", mine.id));
      else
        unwrap(
          await supabase
            .from("daily_reports")
            .insert({ user_id: profile!.id, report_date: today, ...body }),
        );
    },
    onSuccess: () => {
      toast.success("Report submitted");
      setF({});
      void qc.invalidateQueries({ queryKey: ["daily-reports"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <PageHeader
        title="Daily reports"
        subtitle="Numbers are calculated from your leads, activities and proposals — not typed in"
      />
      <SectionCard title={mine ? "Today's report (editable)" : "Submit today's report"}>
        {mine ? (
          <p className="mb-2 text-xs text-muted-foreground">
            Auto-calculated: {mine.leads_created} leads created · {mine.outreach_completed} outreach
            · {mine.meetings_booked} meetings booked · {mine.proposals_sent} proposals sent
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Summary">
              <Textarea
                value={val("summary")}
                onChange={(e) => setF({ ...f, summary: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Wins">
            <Textarea value={val("wins")} onChange={(e) => setF({ ...f, wins: e.target.value })} />
          </Field>
          <Field label="Blockers">
            <Textarea
              value={val("blockers")}
              onChange={(e) => setF({ ...f, blockers: e.target.value })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Plan for tomorrow">
              <Textarea
                value={val("next_day_plan")}
                onChange={(e) => setF({ ...f, next_day_plan: e.target.value })}
              />
            </Field>
          </div>
        </div>
        <Button className="mt-3" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : mine ? "Update report" : "Submit report"}
        </Button>
      </SectionCard>
      <SectionCard title="History" className="mt-4">
        {q.isLoading ? (
          <LoadingBlock />
        ) : q.isError ? (
          <ErrorBlock error={q.error} />
        ) : (q.data ?? []).length === 0 ? (
          <EmptyState message="No reports yet." />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {(q.data ?? []).map((r) => (
              <li key={r.id} className="py-2">
                <p className="font-medium">
                  {userName(r.user_id)} · {date(r.report_date)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.leads_created} leads · {r.outreach_completed} outreach · {r.meetings_booked}{" "}
                  meetings · {r.proposals_sent} proposals
                </p>
                {r.summary ? <p>{r.summary}</p> : null}
                {r.blockers ? <p className="text-warning">Blockers: {r.blockers}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
