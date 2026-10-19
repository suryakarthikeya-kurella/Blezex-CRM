import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectBox } from "@/components/crm/controls";
import { RecordDialog } from "@/components/crm/record-dialog";
import { useAuth } from "@/lib/auth";
import { supabase, unwrap } from "@/lib/supabase";

type View = { id: string; name: string; filters: Record<string, unknown> };

/** Personal saved filter sets for a list page (table saved_filters; RLS keeps each user's views private). */
export function SavedViews({
  scope,
  current,
  onApply,
}: {
  scope: string;
  /** the filter object to save */
  current: Record<string, unknown>;
  onApply: (filters: Record<string, unknown>) => void;
}) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [naming, setNaming] = useState(false);
  const [selected, setSelected] = useState("");
  const views = useQuery({
    queryKey: ["saved_filters", scope],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("saved_filters")
          .select("id,name,filters")
          .eq("scope", scope)
          .order("name"),
      ) as View[],
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["saved_filters", scope] });
  const save = useMutation({
    mutationFn: async (name: string) =>
      unwrap(
        await supabase
          .from("saved_filters")
          .upsert({ user_id: profile!.id, scope, name, filters: current } as never, {
            onConflict: "user_id,scope,name",
          }),
      ),
    onSuccess: () => {
      toast.success("View saved");
      setNaming(false);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from("saved_filters").delete().eq("id", id)),
    onSuccess: () => {
      setSelected("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex items-center gap-1">
      <SelectBox
        value={selected}
        onChange={(id) => {
          setSelected(id);
          const v = views.data?.find((x) => x.id === id);
          if (v) onApply(v.filters);
        }}
        options={(views.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
        placeholder="Saved views"
        className="w-40"
      />
      <Button
        variant="outline"
        size="icon"
        className="size-9"
        aria-label="Save current filters as a view"
        onClick={() => setNaming(true)}
      >
        <Bookmark className="size-4" />
      </Button>
      {selected ? (
        <Button variant="ghost" size="sm" onClick={() => remove.mutate(selected)}>
          Delete view
        </Button>
      ) : null}
      <RecordDialog
        open={naming}
        onOpenChange={setNaming}
        title="Save this view"
        description="Saves the current filters and sorting under a name only you can see."
        submitting={save.isPending}
        fields={[{ name: "name", required: true }]}
        onSubmit={(v) => save.mutate((v["name"] ?? "").trim())}
      />
    </div>
  );
}
