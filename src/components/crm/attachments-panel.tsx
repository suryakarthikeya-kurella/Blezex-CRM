import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/crm/ui-bits";
import { useUserName } from "@/components/crm/controls";
import { useAuth } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { supabase, unwrap } from "@/lib/supabase";

const BUCKET = "attachments";
const MAX_BYTES = 10 * 1024 * 1024;

type Att = {
  id: string;
  path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
};

const size = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
/** Keep names storage-safe and short; the original name is kept in the table for display. */
const safeName = (n: string) =>
  n
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(-120) || "file";

/** Files on a lead or client. The database decides who can attach/see/delete (RLS on `attachments` and on the
 *  private storage bucket); downloads use short-lived signed links. */
export function AttachmentsPanel({
  entity,
  id,
  readOnly = false,
}: {
  entity: "lead" | "client";
  id: string;
  readOnly?: boolean;
}) {
  const { profile, isAdmin } = useAuth();
  const userName = useUserName();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const key = ["attachments", entity, id];
  const col = entity === "lead" ? "lead_id" : "client_id";

  const q = useQuery({
    queryKey: key,
    queryFn: async () =>
      unwrap(
        await supabase
          .from("attachments")
          .select("*")
          .eq(col, id)
          .order("created_at", { ascending: false }),
      ) as Att[],
  });

  const upload = async (file: File | undefined) => {
    if (!file || !profile) return;
    if (file.size > MAX_BYTES) return void toast.error("Files can be at most 10 MB.");
    if (file.size === 0) return void toast.error("That file is empty.");
    setBusy(true);
    const path = `${crypto.randomUUID()}/${safeName(file.name)}`;
    try {
      // 1) register the row (RLS: you must be able to access this lead/client), 2) upload the object
      unwrap(
        await supabase.from("attachments").insert({
          [col]: id,
          path,
          file_name: file.name.slice(0, 200),
          mime_type: file.type || null,
          size_bytes: file.size,
          uploaded_by: profile.id,
        } as never),
      );
      const up = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, ...(file.type ? { contentType: file.type } : {}) });
      if (up.error) {
        await supabase.from("attachments").delete().eq("path", path); // never leave a row without a file
        throw new Error(up.error.message);
      }
      toast.success("File attached");
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const open = async (a: Att) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(a.path, 60, { download: a.file_name });
    if (error || !data) return void toast.error(error?.message ?? "Could not open the file.");
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const remove = useMutation({
    mutationFn: async (a: Att) => {
      const del = await supabase.storage.from(BUCKET).remove([a.path]); // object first, then its row
      if (del.error) throw new Error(del.error.message);
      unwrap(await supabase.from("attachments").delete().eq("id", a.id));
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <LoadingBlock rows={2} />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const rows = q.data ?? [];
  return (
    <div className="space-y-3">
      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            aria-label="Choose a file to attach"
            className="text-sm"
            onChange={(e) => void upload(e.target.files?.[0])}
            disabled={busy}
          />
          {busy ? (
            <span className="text-xs text-muted-foreground">Uploading…</span>
          ) : (
            <span className="text-xs text-muted-foreground">Up to 10 MB each.</span>
          )}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState message="No files attached." />
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <button
                type="button"
                onClick={() => void open(a)}
                className="flex items-center gap-2 text-left text-primary hover:underline"
              >
                {a.mime_type?.startsWith("image/") ? (
                  <Paperclip className="size-4" />
                ) : (
                  <FileText className="size-4" />
                )}
                {a.file_name}
              </button>
              <span className="text-xs text-muted-foreground">
                {size(a.size_bytes)} · {userName(a.uploaded_by)} · {dateTime(a.created_at)}
              </span>
              {!readOnly && (a.uploaded_by === profile?.id || isAdmin) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  aria-label={`Delete ${a.file_name}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(a)}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
