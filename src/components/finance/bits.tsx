import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { presetRange, RANGE_PRESETS } from "@/lib/finance";

export type Range = { from: string; to: string };

/** Preset buttons plus two date inputs. Only fires for a complete, ordered range. */
export function RangeBar({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const set = (r: Partial<Range>) => {
    const next = { ...value, ...r };
    if (next.from && next.to && next.from <= next.to) onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {RANGE_PRESETS.map((p) => (
        <Button
          key={p.value}
          size="sm"
          variant="outline"
          onClick={() => onChange(presetRange(p.value, new Date()))}
        >
          {p.label}
        </Button>
      ))}
      <Input
        type="date"
        aria-label="From date"
        className="w-40"
        value={value.from}
        max={value.to}
        onChange={(e) => set({ from: e.target.value })}
      />
      <span className="text-xs text-muted-foreground">to</span>
      <Input
        type="date"
        aria-label="To date"
        className="w-40"
        value={value.to}
        min={value.from}
        onChange={(e) => set({ to: e.target.value })}
      />
    </div>
  );
}
