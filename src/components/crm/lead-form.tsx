import { useMemo } from "react";
import { RecordDialog, type FieldDef } from "@/components/crm/record-dialog";
import { useConfig, useDirectory } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Lead } from "@/lib/db-types";

export type LeadFormValues = Record<string, string>;

export function leadToForm(l?: Lead | null): LeadFormValues {
  if (!l) return { priority: "medium", currency: "INR" };
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    company_name: s(l.company_name),
    contact_name: s(l.contact_name),
    email: s(l.email),
    phone: s(l.phone),
    website: s(l.website),
    industry: s(l.industry),
    company_size: s(l.company_size),
    lead_source_id: s(l.lead_source_id),
    lead_source_details: s(l.lead_source_details),
    service_id: s(l.service_id),
    priority: s(l.priority),
    estimated_value: s(l.estimated_value),
    expected_close_date: s(l.expected_close_date),
    next_follow_up_at: l.next_follow_up_at ? l.next_follow_up_at.slice(0, 10) : "",
    decision_maker: s(l.decision_maker),
    qualification_notes: s(l.qualification_notes),
    notes: s(l.notes),
    owner_id: s(l.owner_id),
  };
}

/** Form → DB patch. Blank strings become null so optional columns clear properly. */
export function formToPatch(v: LeadFormValues, opts: { includeOwner: boolean }): Partial<Lead> {
  const n = (x?: string) => (x && x.trim() !== "" ? x.trim() : null);
  const patch: Record<string, unknown> = {
    company_name: (v["company_name"] ?? "").trim(),
    contact_name: n(v["contact_name"]),
    email: n(v["email"]),
    phone: n(v["phone"]),
    website: n(v["website"]),
    industry: n(v["industry"]),
    company_size: n(v["company_size"]),
    lead_source_id: n(v["lead_source_id"]),
    lead_source_details: n(v["lead_source_details"]),
    service_id: n(v["service_id"]),
    priority: v["priority"] || "medium",
    estimated_value: n(v["estimated_value"]) === null ? null : Number(v["estimated_value"]),
    expected_close_date: n(v["expected_close_date"]),
    next_follow_up_at: n(v["next_follow_up_at"])
      ? new Date(`${v["next_follow_up_at"]}T09:00:00`).toISOString()
      : null,
    decision_maker: n(v["decision_maker"]),
    qualification_notes: n(v["qualification_notes"]),
    notes: n(v["notes"]),
  };
  if (opts.includeOwner && v["owner_id"]) patch["owner_id"] = v["owner_id"];
  return patch as Partial<Lead>;
}

export function LeadFormDialog({
  open,
  onOpenChange,
  initial,
  title,
  submitting,
  onSubmit,
  allowOwner,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: LeadFormValues;
  title: string;
  submitting?: boolean;
  onSubmit: (v: LeadFormValues) => void;
  allowOwner?: boolean;
}) {
  const { data: cfg } = useConfig();
  const { data: dir } = useDirectory();
  const { role } = useAuth();
  const fields = useMemo<FieldDef[]>(() => {
    const opt = (rows?: { id: string; name?: string; label?: string; is_active: boolean }[]) =>
      (rows ?? [])
        .filter((r) => r.is_active)
        .map((r) => ({ value: r.id, label: (r.name ?? r.label) as string }));
    const f: FieldDef[] = [
      { name: "company_name", label: "Company name", required: true },
      { name: "contact_name", label: "Contact person" },
      { name: "email", label: "Email", type: "email" },
      { name: "phone", label: "Phone", type: "tel" },
      { name: "website", label: "Website" },
      { name: "industry", label: "Industry / category" },
      { name: "company_size", label: "Company size" },
      { name: "decision_maker", label: "Decision maker" },
      { name: "lead_source_id", label: "Source", type: "select", options: opt(cfg?.sources) },
      { name: "lead_source_details", label: "Source details" },
      {
        name: "service_id",
        label: "Service of interest",
        type: "select",
        options: opt(cfg?.services),
      },
      {
        name: "priority",
        label: "Priority",
        type: "select",
        options: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
      },
      { name: "estimated_value", label: "Estimated value (INR)", type: "number" },
      { name: "expected_close_date", label: "Expected close", type: "date" },
      { name: "next_follow_up_at", label: "Next follow-up", type: "date" },
    ];
    if (allowOwner && (role === "admin" || role === "mentor"))
      f.push({
        name: "owner_id",
        label: "Owner",
        type: "select",
        options: (dir?.list ?? [])
          .filter((u) => u.role !== "admin" || role === "admin")
          .map((u) => ({ value: u.id, label: u.full_name })),
      });
    f.push(
      { name: "qualification_notes", label: "Qualification notes", type: "textarea" },
      { name: "notes", label: "Notes", type: "textarea" },
    );
    return f;
  }, [cfg, dir, allowOwner, role]);
  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      fields={fields}
      initial={initial}
      submitting={submitting ?? false}
      onSubmit={onSubmit}
    />
  );
}
