import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Recharts lives only in this file so it is loaded on demand (React.lazy), not with the first paint. */
export function StageChart({ data }: { data: { label: string; count: number }[] }) {
  return (
    <div className="h-64" role="img" aria-label="Bar chart of leads per pipeline stage">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            interval={0}
            angle={-25}
            height={60}
            textAnchor="end"
          />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="count" name="Leads" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GrowthChart({
  data,
}: {
  data: { month: string; new_leads: number; won: number }[];
}) {
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Line dataKey="new_leads" name="New leads" stroke="var(--color-chart-1)" />
          <Line dataKey="won" name="Won" stroke="var(--color-chart-2)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
