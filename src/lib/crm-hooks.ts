import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { createRecord, fetchTable, removeRecord, saveRecord } from "./crm.functions";
import type { CrmRecord, SheetRow, TabName } from "./crm-schema";

export function useTable(tab: TabName) {
  const fn = useServerFn(fetchTable);
  return useQuery({
    queryKey: ["sheet", tab],
    queryFn: async () => (await fn({ data: { tab } })) as SheetRow[],
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function nextId(rows: SheetRow[] | undefined, field: string, prefix: string) {
  const max = (rows ?? []).reduce((acc, r) => {
    const n = parseInt(String(r[field] ?? "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

function sanitize(record: CrmRecord): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(record).forEach(([k, v]) => {
    if (k === "__row" || v === undefined || v === null) return;
    out[k] = String(v);
  });
  return out;
}

export function useCrmMutations(tab: TabName) {
  const qc = useQueryClient();
  const create = useServerFn(createRecord);
  const save = useServerFn(saveRecord);
  const remove = useServerFn(removeRecord);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["sheet", tab] });

  const createMutation = useMutation({
    mutationFn: (record: CrmRecord) => create({ data: { tab, record: sanitize(record) } }),
    onSuccess: () => {
      invalidate();
      toast.success("Record created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ row, record }: { row: number; record: CrmRecord }) =>
      save({ data: { tab, row, record: sanitize(record) } }),
    onSuccess: () => {
      invalidate();
      toast.success("Record updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (row: number) => remove({ data: { tab, row } }),
    onSuccess: () => {
      invalidate();
      toast.success("Record deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { createMutation, updateMutation, deleteMutation };
}

export function exportCsv(filename: string, columns: string[], rows: SheetRow[]) {
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    columns.map(esc).join(","),
    ...rows.map((r) => columns.map((c) => esc(r[c] ?? "")).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function num(v: string | undefined) {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function currency(v: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(v);
}
