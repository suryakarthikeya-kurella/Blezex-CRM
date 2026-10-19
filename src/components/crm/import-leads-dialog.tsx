import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectBox, userOptions } from "@/components/crm/controls";
import { useConfig, useDirectory } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LEAD_CSV_TEMPLATE, parseCsv, validateLeadCsv, type LeadCsvResult } from "@/lib/csv";
import { supabase } from "@/lib/supabase";

const MAX_ROWS = 2000;
const BATCH = 100;

function downloadTemplate() {
  const url = URL.createObjectURL(
    new Blob([LEAD_CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "leads_import_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** CSV lead import. Rows are checked in the browser first (dry run), then inserted in small batches through the
 *  normal leads insert path, so RLS decides who may import for whom. Each row carries a request id, so an interrupted
 *  import can be re-run without creating duplicates of the rows that already went in. */
export function ImportLeadsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { profile, role } = useAuth();
  const { data: cfg } = useConfig();
  const { data: dir } = useDirectory();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<LeadCsvResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ok: number; failed: string[] } | null>(null);
  // one stable request id per CSV line for this file, so a retry is idempotent
  const requestIds = useRef(new Map<number, string>());

  const ownerOptions = useMemo(
    () => userOptions(dir?.list, ["bds_employee", "mentor", "admin"]),
    [dir],
  );
  const me = profile?.id ?? "";
  const ownerId = role === "admin" ? owner || me : me;

  const onFile = async (f: File | undefined) => {
    setDone(null);
    requestIds.current = new Map();
    if (!f) return setResult(null);
    setFileName(f.name);
    const rows = parseCsv(await f.text());
    if (rows.length - 1 > MAX_ROWS) {
      toast.error(`Please import at most ${MAX_ROWS} rows at a time.`);
      return setResult(null);
    }
    setResult(validateLeadCsv(rows));
  };

  const run = async () => {
    if (!result || !result.valid.length) return;
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    const src = new Map((cfg?.sources ?? []).map((s) => [s.name?.toLowerCase() ?? "", s.id]));
    const svc = new Map((cfg?.services ?? []).map((s) => [s.name?.toLowerCase() ?? "", s.id]));
    for (let i = 0; i < result.valid.length; i += BATCH) {
      const chunk = result.valid.slice(i, i + BATCH);
      const payload = chunk.map(({ line, row }) => {
        if (!requestIds.current.has(line)) requestIds.current.set(line, crypto.randomUUID());
        const { lead_source, service, ...rest } = row;
        return {
          ...rest,
          owner_id: ownerId,
          request_id: requestIds.current.get(line)!,
          ...(lead_source && src.get(lead_source.toLowerCase())
            ? { lead_source_id: src.get(lead_source.toLowerCase()) }
            : {}),
          ...(service && svc.get(service.toLowerCase())
            ? { service_id: svc.get(service.toLowerCase()) }
            : {}),
        };
      });
      const { error } = await supabase.from("leads").insert(payload as never);
      if (error) {
        // a failed batch is retried row by row so one bad row doesn't sink the other 99
        for (const [j, p] of payload.entries()) {
          const one = await supabase.from("leads").insert(p as never);
          if (one.error) failed.push(`line ${chunk[j]!.line}: ${one.error.message}`);
          else ok++;
        }
      } else ok += payload.length;
    }
    setBusy(false);
    setDone({ ok, failed });
    void qc.invalidateQueries({ queryKey: ["leads"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    if (!failed.length) toast.success(`Imported ${ok} lead(s)`);
  };

  const close = (o: boolean) => {
    if (busy) return;
    onOpenChange(o);
    if (!o) {
      setResult(null);
      setDone(null);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>
            Required column: company_name. Optional: contact_name, email, phone, website, industry,
            priority, estimated_value, lead_source, service, notes. Up to {MAX_ROWS} rows.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              className="text-sm"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button variant="ghost" size="sm" onClick={downloadTemplate}>
              <Download className="size-4" /> Template
            </Button>
          </div>
          {role === "admin" ? (
            <div>
              <Label className="mb-1.5 block text-xs">Assign imported leads to</Label>
              <SelectBox
                value={owner || me}
                onChange={setOwner}
                options={ownerOptions}
                className="w-64"
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Imported leads are assigned to you.</p>
          )}

          {result ? (
            <div className="space-y-2 text-sm" role="status">
              <p>
                <span className="font-medium text-success">{result.valid.length} ready</span>
                {" · "}
                <span className={result.errors.length ? "font-medium text-destructive" : ""}>
                  {result.errors.length} with problems
                </span>
                {fileName ? <span className="text-muted-foreground"> · {fileName}</span> : null}
              </p>
              {result.unknownColumns.length ? (
                <p className="text-xs text-muted-foreground">
                  Ignored columns: {result.unknownColumns.join(", ")}
                </p>
              ) : null}
              {result.errors.length ? (
                <ul className="max-h-40 overflow-y-auto rounded-md border p-2 text-xs">
                  {result.errors.slice(0, 50).map((e) => (
                    <li key={e.line}>
                      Line {e.line}: {e.message}
                    </li>
                  ))}
                  {result.errors.length > 50 ? (
                    <li>…and {result.errors.length - 50} more</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          ) : null}
          {done ? (
            <div role="status" className="rounded-md border p-3 text-sm">
              <p className="font-medium">Imported {done.ok} lead(s).</p>
              {done.failed.length ? (
                <ul className="mt-2 max-h-32 overflow-y-auto text-xs text-destructive">
                  {done.failed.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Close
          </Button>
          <Button disabled={busy || !result?.valid.length || !!done} onClick={() => void run()}>
            <Upload className="size-4" />{" "}
            {busy ? "Importing…" : `Import ${result?.valid.length ?? 0} lead(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
