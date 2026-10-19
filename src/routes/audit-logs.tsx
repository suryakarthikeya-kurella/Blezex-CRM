import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/crm/ui-bits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AttendanceView } from "@/components/attendance/attendance-page";
import { AuditHistory } from "@/components/attendance/audit-history";
import { useAuth } from "@/lib/auth";

// The path stays /audit-logs: this is the former Audit log entry in the sidebar, now led by attendance.
export const Route = createFileRoute("/audit-logs")({
  head: () => ({ meta: [{ title: "Attendance — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});

function Page() {
  const { role } = useAuth();
  return (
    <>
      <PageHeader
        title="Attendance & work hours"
        subtitle={
          role === "admin"
            ? "Everyone's check-ins, hours and corrections — plus the immutable audit history"
            : role === "mentor"
              ? "Your attendance and your team's"
              : "Your attendance and work hours"
        }
      />
      <Tabs defaultValue="attendance">
        <TabsList>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="audit">Audit history</TabsTrigger>
        </TabsList>
        <TabsContent value="attendance" className="mt-4">
          <AttendanceView />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditHistory />
        </TabsContent>
      </Tabs>
    </>
  );
}
