import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ErrorBlock, LoadingBlock, PageHeader, SectionCard } from "@/components/crm/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useConfig } from "@/lib/api";
import { supabase, unwrap } from "@/lib/supabase";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});
type Table = "lead_sources" | "services" | "lost_reasons";

function Vocabulary({
  title,
  table,
  rows,
  col,
}: {
  title: string;
  table: Table;
  rows: { id: string; name?: string; label?: string; is_active: boolean }[];
  col: "name" | "label";
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["config"] });
  };
  const err = (e: Error) => toast.error(e.message);
  const add = useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase.from(table).insert({ [col]: text.trim(), position: rows.length * 10 + 10 }),
      ),
    onSuccess: () => {
      setText("");
      done();
    },
    onError: err,
  });
  const toggle = useMutation({
    mutationFn: async (r: { id: string; on: boolean }) =>
      unwrap(await supabase.from(table).update({ is_active: r.on }).eq("id", r.id)),
    onSuccess: done,
    onError: err,
  });
  return (
    <SectionCard title={title}>
      <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between">
            <span className={r.is_active ? "" : "text-muted-foreground line-through"}>
              {r[col]}
            </span>
            <Switch
              checked={r.is_active}
              onCheckedChange={(on) => toggle.mutate({ id: r.id, on })}
              aria-label={`Active: ${r[col]}`}
            />
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add new…"
          aria-label={`Add to ${title}`}
        />
        <Button type="submit" size="sm" disabled={add.isPending}>
          Add
        </Button>
      </form>
    </SectionCard>
  );
}

function Page() {
  const q = useConfig();
  const qc = useQueryClient();
  const [stageName, setStageName] = useState("");
  const err = (e: Error) => toast.error(e.message);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["config"] });
  const addStage = useMutation({
    mutationFn: async () => {
      const label = stageName.trim();
      const max = Math.max(
        0,
        ...(q.data?.stages ?? []).filter((s) => !s.is_won && !s.is_lost).map((s) => s.position),
      );
      return unwrap(
        await supabase.from("pipeline_stages").insert({
          key:
            label
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "") || "stage",
          label,
          position: max + 5,
        }),
      );
    },
    onSuccess: () => {
      setStageName("");
      refresh();
    },
    onError: err,
  });
  const toggleStage = useMutation({
    mutationFn: async (a: { key: string; on: boolean }) =>
      unwrap(await supabase.from("pipeline_stages").update({ is_active: a.on }).eq("key", a.key)),
    onSuccess: refresh,
    onError: err,
  });
  const saveSetting = useMutation({
    mutationFn: async (a: { key: string; value: unknown }) =>
      unwrap(
        await supabase
          .from("app_settings")
          .update({ value: a.value as never })
          .eq("key", a.key),
      ),
    onSuccess: () => {
      refresh();
      toast.success("Setting saved");
    },
    onError: err,
  });
  if (q.isLoading) return <LoadingBlock rows={6} />;
  if (q.isError || !q.data) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Pipeline, vocabularies and operating rules (admin only)"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Pipeline stages">
          <ul className="space-y-1 text-sm">
            {c.stages.map((s) => (
              <li key={s.key} className="flex items-center justify-between">
                <span>
                  {s.label}
                  {s.is_won ? " (won)" : s.is_lost ? " (lost)" : ""}
                </span>
                {s.is_won || s.is_lost ? (
                  <span className="text-xs text-muted-foreground">fixed</span>
                ) : (
                  <Switch
                    checked={s.is_active}
                    onCheckedChange={(on) => toggleStage.mutate({ key: s.key, on })}
                    aria-label={`Active: ${s.label}`}
                  />
                )}
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (stageName.trim()) addStage.mutate();
            }}
          >
            <Input
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
              placeholder="New stage name"
              aria-label="New stage"
            />
            <Button type="submit" size="sm">
              Add
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Stages in use cannot be deleted; deactivate them instead.
          </p>
        </SectionCard>
        <SectionCard title="Operating rules">
          <div className="space-y-3 text-sm">
            <label className="flex items-center justify-between">
              Mentors may reassign leads within their team
              <Switch
                checked={c.settings["mentor.can_assign_leads"] === true}
                onCheckedChange={(on) =>
                  saveSetting.mutate({ key: "mentor.can_assign_leads", value: on })
                }
              />
            </label>
            {(
              [
                ["proposal.followup_hours", "Proposal follow-up target (hours)"],
                ["lead.stale_days", "Stale lead after (days)"],
                ["qualification.min_score", "Min. qualification score (0–100)"],
              ] as const
            ).map(([k, l]) => (
              <form
                key={k}
                className="flex items-center justify-between gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = Number(new FormData(e.currentTarget).get("v"));
                  if (Number.isFinite(v) && v > 0) saveSetting.mutate({ key: k, value: v });
                }}
              >
                <span>{l}</span>
                <span className="flex gap-1">
                  <Input
                    name="v"
                    type="number"
                    defaultValue={Number(c.settings[k] ?? 0)}
                    className="h-8 w-20"
                    aria-label={l}
                  />
                  <Button size="sm" variant="outline" type="submit">
                    Save
                  </Button>
                </span>
              </form>
            ))}
          </div>
        </SectionCard>
        <Vocabulary title="Lead sources" table="lead_sources" rows={c.sources} col="name" />
        <Vocabulary title="Services catalogue" table="services" rows={c.services} col="name" />
        <Vocabulary title="Lost reasons" table="lost_reasons" rows={c.lostReasons} col="label" />
      </div>
    </>
  );
}
