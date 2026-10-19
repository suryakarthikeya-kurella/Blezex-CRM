import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, SectionCard, StatusPill } from "@/components/crm/ui-bits";
import { RecordDialog } from "@/components/crm/record-dialog";
import { useConfig } from "@/lib/api";
import { LEAVE_TYPES } from "@/lib/attendance";
import { supabase, unwrap } from "@/lib/supabase";
import { useTemplates, type MessageTemplate } from "@/lib/templates";

/** Admin: manage the email / WhatsApp templates used from a lead's "Message" button. */
export function TemplatesEditor() {
  const qc = useQueryClient();
  const q = useTemplates();
  const [edit, setEdit] = useState<MessageTemplate | "new" | null>(null);
  const save = useMutation({
    mutationFn: async (v: Record<string, string>) => {
      const row = {
        name: v["name"] ?? "",
        subject: v["channel"] === "email" ? v["subject"] || null : null,
        body: v["body"] ?? "",
        is_active: v["is_active"] !== "no",
      };
      if (edit === "new")
        unwrap(
          await supabase
            .from("message_templates")
            .insert({ ...row, channel: v["channel"] } as never),
        );
      else if (edit) unwrap(await supabase.from("message_templates").update(row).eq("id", edit.id));
    },
    onSuccess: () => {
      toast.success("Template saved");
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from("message_templates").delete().eq("id", id)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const cur = edit && edit !== "new" ? edit : null;
  return (
    <SectionCard
      title="Message templates"
      className="lg:col-span-2"
      action={
        <Button size="sm" variant="outline" onClick={() => setEdit("new")}>
          Add template
        </Button>
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">
        Placeholders: {"{{contact_name}}"}, {"{{company_name}}"}, {"{{owner_name}}"}. Sending opens
        the user&apos;s own email or WhatsApp app.
      </p>
      {(q.data ?? []).length === 0 ? (
        <EmptyState message="No templates yet." />
      ) : (
        <ul className="divide-y text-sm">
          {(q.data ?? []).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{t.name}</span>{" "}
                <span className="text-xs text-muted-foreground">
                  {t.channel === "email" ? "Email" : "WhatsApp"}
                </span>
                {!t.is_active ? <StatusPill value="paused" className="ml-2" /> : null}
              </span>
              <span className="space-x-1">
                <Button size="sm" variant="ghost" onClick={() => setEdit(t)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => remove.mutate(t.id)}
                >
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <RecordDialog
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={cur ? `Edit ${cur.name}` : "New template"}
        submitting={save.isPending}
        initial={
          cur
            ? {
                channel: cur.channel,
                name: cur.name,
                subject: cur.subject ?? "",
                body: cur.body,
                is_active: cur.is_active ? "yes" : "no",
              }
            : { channel: "email", is_active: "yes" }
        }
        fields={[
          {
            name: "channel",
            type: "select",
            options: ["email", "whatsapp"],
            required: true,
            disabled: !!cur,
          },
          { name: "name", required: true },
          { name: "subject", label: "Subject (email only)" },
          { name: "body", type: "textarea", required: true },
          { name: "is_active", label: "Active", type: "select", options: ["yes", "no"] },
        ]}
        onSubmit={(v) => save.mutate(v)}
      />
    </SectionCard>
  );
}

/** Admin: yearly leave allowance per type. Types left blank are unlimited. Validated again by the database. */
export function LeaveQuotaEditor() {
  const qc = useQueryClient();
  const { data: cfg } = useConfig();
  const current = (cfg?.settings["leave.quotas"] as Record<string, number> | undefined) ?? {};
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    setVals(
      Object.fromEntries(
        LEAVE_TYPES.map((t) => [t.value, current[t.value] != null ? String(current[t.value]) : ""]),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once the setting has loaded
  }, [cfg?.settings["leave.quotas"]]);
  const save = useMutation({
    mutationFn: async () => {
      const value = Object.fromEntries(
        Object.entries(vals)
          .filter(([, v]) => v.trim() !== "")
          .map(([k, v]) => [k, Number(v)]),
      );
      unwrap(await supabase.from("app_settings").update({ value }).eq("key", "leave.quotas"));
    },
    onSuccess: () => {
      toast.success("Leave allowance saved");
      void qc.invalidateQueries({ queryKey: ["config"] });
      void qc.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e: Error) => toast.error(e.message.replace(/^invalid leave quotas: /, "")),
  });
  return (
    <SectionCard title="Leave allowance (days per year)">
      <div className="grid grid-cols-2 gap-3">
        {LEAVE_TYPES.map((t) => (
          <div key={t.value}>
            <Label htmlFor={`quota-${t.value}`} className="mb-1.5 block text-xs">
              {t.label}
            </Label>
            <Input
              id={`quota-${t.value}`}
              type="number"
              min={0}
              max={366}
              step={0.5}
              placeholder="Unlimited"
              value={vals[t.value] ?? ""}
              onChange={(e) => setVals((o) => ({ ...o, [t.value]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <Button className="mt-3" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
        Save allowance
      </Button>
    </SectionCard>
  );
}
