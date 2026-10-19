import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
} from "@/components/crm/ui-bits";
import { SelectBox, useUserName } from "@/components/crm/controls";
import { RecordDialog } from "@/components/crm/record-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { supabase, unwrap } from "@/lib/supabase";
import { useDirectory, useReport } from "@/lib/api";
import {
  changeUserRole,
  deleteUser,
  inviteUser,
  offboardUser,
  resetUserMfa,
  sendPasswordReset,
  setUserActive,
} from "@/lib/admin.functions";
import { ROLE_LABEL, type Role } from "@/lib/permissions";
import { TodayCell, useTodayAttendance } from "@/components/attendance/today-cell";
import { num } from "@/lib/format";

export const Route = createFileRoute("/team")({
  head: () => ({ meta: [{ title: "Team — BlezeX Connect" }] }),
  component: () => (
    <AppShell>
      <Page />
    </AppShell>
  ),
});
const ROLES = (["admin", "mentor", "bds_employee"] as Role[]).map((r) => ({
  value: r,
  label: ROLE_LABEL[r],
}));

type P = { id: string; full_name: string; email: string; role: Role; is_active: boolean };
type TM = {
  id: string;
  team_id: string;
  user_id: string;
  membership_role: string;
  is_active: boolean;
};
type Team = { id: string; name: string; description: string | null; status: string };

function Page() {
  const { role } = useAuth();
  return role === "admin" ? <AdminTeam /> : <MentorTeam />;
}

function AdminTeam() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const userName = useUserName();
  const attendance = useTodayAttendance();
  const inv = () => {
    for (const k of ["people", "teams", "directory"]) void qc.invalidateQueries({ queryKey: [k] });
  };
  const people = useQuery({
    queryKey: ["people"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("profiles")
          .select("id,full_name,email,role,is_active")
          .order("full_name"),
      ) as P[],
  });
  const teams = useQuery({
    queryKey: ["teams"],
    queryFn: async () => ({
      teams: unwrap(await supabase.from("teams").select("*").order("name")) as Team[],
      members: unwrap(
        await supabase.from("team_memberships").select("*").eq("is_active", true),
      ) as TM[],
    }),
  });
  const [invite, setInvite] = useState(false);
  const [teamDlg, setTeamDlg] = useState(false);
  const [memberDlg, setMemberDlg] = useState(false);
  const [targetDlg, setTargetDlg] = useState(false);
  const [del, setDel] = useState<P | null>(null);
  const [off, setOff] = useState<P | null>(null);
  const [confirm, setConfirm] = useState<{ p: P; active: boolean } | null>(null);
  const fail = (e: Error) => toast.error(e.message);
  const doInvite = useMutation({
    mutationFn: (v: Record<string, string>) =>
      inviteUser({
        data: {
          email: v["email"] ?? "",
          fullName: v["full_name"] ?? "",
          password: v["password"] ?? "",
          role: (v["role"] || "bds_employee") as Role,
          ...(v["team_id"] ? { teamId: v["team_id"] } : {}),
        },
      }),
    onSuccess: () => {
      toast.success("User created. Share the temporary password with them.");
      setInvite(false);
      inv();
    },
    onError: fail,
  });
  const doRole = useMutation({
    mutationFn: (a: { userId: string; role: Role }) => changeUserRole({ data: a }),
    onSuccess: () => {
      toast.success("Role updated");
      inv();
    },
    onError: fail,
  });
  const doActive = useMutation({
    mutationFn: (a: { userId: string; active: boolean }) => setUserActive({ data: a }),
    onSuccess: () => {
      toast.success("Account updated");
      setConfirm(null);
      inv();
    },
    onError: fail,
  });
  const doDelete = useMutation({
    mutationFn: (userId: string) => deleteUser({ data: { userId } }),
    onSuccess: () => {
      toast.success("User deleted");
      setDel(null);
      inv();
    },
    onError: (e: Error) => {
      setDel(null);
      fail(e);
    },
  });
  const doOffboard = useMutation({
    mutationFn: (a: { userId: string; handoverTo: string }) => offboardUser({ data: a }),
    onSuccess: (r) => {
      toast.success(
        `Offboarded. Handed over ${r.leads} lead(s), ${r.tasks} task(s), ${r.clients} client(s).`,
      );
      setOff(null);
      inv();
    },
    onError: (e: Error) => {
      setOff(null);
      fail(e);
    },
  });
  const doResetMfa = useMutation({
    mutationFn: (userId: string) => resetUserMfa({ data: { userId } }),
    onSuccess: (r) =>
      toast.success(r.removed ? "Two-step verification reset" : "That user had none enabled"),
    onError: fail,
  });
  const doReset = useMutation({
    mutationFn: (email: string) => sendPasswordReset({ data: { email } }),
    onSuccess: () => toast.success("Reset email sent"),
    onError: fail,
  });
  const addTeam = useMutation({
    mutationFn: async (v: Record<string, string>) =>
      unwrap(
        await supabase
          .from("teams")
          .insert({ name: v["name"], description: v["description"] || null }),
      ),
    onSuccess: () => {
      setTeamDlg(false);
      inv();
      toast.success("Team created");
    },
    onError: fail,
  });
  const addMember = useMutation({
    mutationFn: async (v: Record<string, string>) =>
      unwrap(
        await supabase.from("team_memberships").insert({
          team_id: v["team_id"],
          user_id: v["user_id"],
          membership_role: v["membership_role"] || "member",
        }),
      ),
    onSuccess: () => {
      setMemberDlg(false);
      inv();
      toast.success("Member added");
    },
    onError: fail,
  });
  const endMember = useMutation({
    mutationFn: async (id: string) =>
      unwrap(
        await supabase
          .from("team_memberships")
          .update({ is_active: false, ended_at: new Date().toISOString() })
          .eq("id", id),
      ),
    onSuccess: inv,
    onError: fail,
  });
  const addTarget = useMutation({
    mutationFn: async (v: Record<string, string>) =>
      unwrap(
        await supabase.from("user_targets").insert({
          user_id: v["user_id"],
          target_type: v["target_type"],
          target_value: Number(v["target_value"]),
          period_start: v["period_start"],
          period_end: v["period_end"],
          created_by: profile!.id,
        }),
      ),
    onSuccess: () => {
      setTargetDlg(false);
      toast.success("Target set");
    },
    onError: fail,
  });
  const userOpts = (people.data ?? [])
    .filter((p) => p.is_active)
    .map((p) => ({ value: p.id, label: `${p.full_name} (${ROLE_LABEL[p.role]})` }));

  return (
    <>
      <PageHeader
        title="Team management"
        subtitle="Accounts, roles, teams and targets (admin only)"
        actions={
          <Button size="sm" onClick={() => setInvite(true)}>
            <UserPlus className="size-4" /> Add user
          </Button>
        }
      />
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="targets">Targets</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-3">
          {people.isLoading ? (
            <LoadingBlock />
          ) : people.isError ? (
            <ErrorBlock error={people.error} />
          ) : (
            <div className="surface overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Today's attendance</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(people.data ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.full_name || "—"}</TableCell>
                      <TableCell className="text-xs">{p.email}</TableCell>
                      <TableCell>
                        <SelectBox
                          value={p.role}
                          onChange={(v) => doRole.mutate({ userId: p.id, role: v as Role })}
                          options={ROLES}
                          className="h-8 w-36 text-xs"
                          disabled={p.id === profile?.id}
                          ariaLabel={`Role of ${p.full_name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <StatusPill value={p.is_active ? "active" : "paused"} />
                      </TableCell>
                      <TableCell>
                        <TodayCell row={attendance.byUser.get(p.id)} />
                      </TableCell>
                      <TableCell className="space-x-1 text-right">
                        {p.id !== profile?.id ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirm({ p, active: !p.is_active })}
                          >
                            {p.is_active ? "Deactivate" : "Reactivate"}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => doReset.mutate(p.email)}>
                          Reset password
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => doResetMfa.mutate(p.id)}>
                          Reset 2FA
                        </Button>
                        {p.id !== profile?.id && p.is_active ? (
                          <Button size="sm" variant="ghost" onClick={() => setOff(p)}>
                            Offboard
                          </Button>
                        ) : null}
                        {p.id !== profile?.id ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => setDel(p)}
                          >
                            Delete
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="teams" className="mt-3 space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setTeamDlg(true)}>
              New team
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMemberDlg(true)}>
              Add member
            </Button>
          </div>
          {(teams.data?.teams ?? []).length === 0 ? (
            <EmptyState message="No teams yet." />
          ) : (
            (teams.data?.teams ?? []).map((t) => (
              <SectionCard key={t.id} title={t.name}>
                <ul className="space-y-1 text-sm">
                  {(teams.data?.members ?? [])
                    .filter((m) => m.team_id === t.id)
                    .map((m) => (
                      <li key={m.id} className="flex items-center justify-between">
                        <span>
                          {userName(m.user_id)}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({m.membership_role})
                          </span>
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => endMember.mutate(m.id)}>
                          Remove
                        </Button>
                      </li>
                    ))}
                </ul>
              </SectionCard>
            ))
          )}
        </TabsContent>
        <TabsContent value="targets" className="mt-3">
          <Button size="sm" onClick={() => setTargetDlg(true)}>
            Set a target
          </Button>
          <p className="mt-2 text-sm text-muted-foreground">
            Progress appears on each person&apos;s dashboard and in Reports → Targets.
          </p>
        </TabsContent>
      </Tabs>

      <RecordDialog
        open={invite}
        onOpenChange={setInvite}
        title="Add user"
        description="Set a temporary password and share it with them. They can sign in with it and reset it later."
        submitting={doInvite.isPending}
        initial={{ role: "bds_employee" }}
        fields={[
          { name: "full_name", required: true },
          { name: "email", type: "email", required: true },
          { name: "password", label: "Temporary password (min 10 chars)", required: true },
          { name: "role", type: "select", options: ROLES },
          {
            name: "team_id",
            label: "Team (optional)",
            type: "select",
            options: (teams.data?.teams ?? []).map((t) => ({ value: t.id, label: t.name })),
          },
        ]}
        onSubmit={(v) => doInvite.mutate(v)}
      />
      <RecordDialog
        open={teamDlg}
        onOpenChange={setTeamDlg}
        title="New team"
        submitting={addTeam.isPending}
        fields={[
          { name: "name", required: true },
          { name: "description", type: "textarea" },
        ]}
        onSubmit={(v) => addTeam.mutate(v)}
      />
      <RecordDialog
        open={memberDlg}
        onOpenChange={setMemberDlg}
        title="Add team member"
        submitting={addMember.isPending}
        initial={{ membership_role: "member" }}
        fields={[
          {
            name: "team_id",
            label: "Team",
            type: "select",
            options: (teams.data?.teams ?? []).map((t) => ({ value: t.id, label: t.name })),
          },
          { name: "user_id", label: "Person", type: "select", options: userOpts },
          {
            name: "membership_role",
            label: "Role in team",
            type: "select",
            options: [
              { value: "member", label: "Member" },
              { value: "mentor", label: "Mentor (supervises the team)" },
            ],
          },
        ]}
        onSubmit={(v) => addMember.mutate(v)}
      />
      <RecordDialog
        open={targetDlg}
        onOpenChange={setTargetDlg}
        title="Set target"
        submitting={addTarget.isPending}
        initial={{ target_type: "qualified_leads" }}
        fields={[
          { name: "user_id", label: "Person", type: "select", options: userOpts },
          {
            name: "target_type",
            label: "Metric",
            type: "select",
            options: [
              "new_leads",
              "qualified_leads",
              "outreach",
              "meetings",
              "proposals",
              "conversions",
              "won_value",
            ].map((v) => ({ value: v, label: v.replace(/_/g, " ") })),
          },
          { name: "target_value", type: "number", required: true },
          { name: "period_start", type: "date", required: true },
          { name: "period_end", type: "date", required: true },
        ]}
        onSubmit={(v) => addTarget.mutate(v)}
      />
      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.active ? "Reactivate" : "Deactivate"} {confirm?.p.full_name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.active
                ? "They will be able to sign in again."
                : "They lose access immediately, including with an existing session. Their records are kept."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirm && doActive.mutate({ userId: confirm.p.id, active: confirm.active })
              }
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RecordDialog
        open={!!off}
        onOpenChange={(o) => !o && setOff(null)}
        title={`Offboard ${off?.full_name ?? ""}`}
        description="Open leads, open tasks and client relationships move to the person you choose, team memberships end, and the account is deactivated and blocked. Closed deals keep their history."
        submitting={doOffboard.isPending}
        fields={[
          {
            name: "handover_to",
            label: "Hand work over to",
            type: "select",
            required: true,
            options: (people.data ?? [])
              .filter((x) => x.is_active && x.id !== off?.id)
              .map((x) => ({
                value: x.id,
                label: `${x.full_name || x.email} (${ROLE_LABEL[x.role]})`,
              })),
          },
        ]}
        onSubmit={(v) =>
          off &&
          v["handover_to"] &&
          doOffboard.mutate({ userId: off.id, handoverTo: v["handover_to"] })
        }
      />
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {del?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the account and cannot be undone. It only works for users
              with no records; otherwise deactivate them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del && doDelete.mutate(del.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type Emp = {
  user_id: string;
  full_name: string;
  active_leads: number;
  outreach: number;
  meetings: number;
  conversions: number;
  tasks_completed: number;
};
function MentorTeam() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const range = {
    p_from: new Date(Date.now() - 30 * 864e5).toISOString(),
    p_to: new Date(Date.now() + 60_000).toISOString(),
  };
  const emp = useReport<Emp>("report_by_employee", range);
  const { data: dir } = useDirectory();
  const notes = useQuery({
    queryKey: ["coaching"],
    queryFn: async () =>
      unwrap(
        await supabase
          .from("coaching_notes")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(30),
      ) as {
        id: string;
        employee_id: string;
        mentor_id: string;
        note: string;
        created_at: string;
      }[],
  });
  const userName = useUserName();
  const attendance = useTodayAttendance();
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const add = useMutation({
    mutationFn: async (v: Record<string, string>) =>
      unwrap(
        await supabase
          .from("coaching_notes")
          .insert({ employee_id: target!.id, mentor_id: profile!.id, note: v["note"] }),
      ),
    onSuccess: () => {
      setTarget(null);
      void qc.invalidateQueries({ queryKey: ["coaching"] });
      toast.success("Coaching note saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = (emp.data ?? []).filter(
    (e) => e.user_id !== profile?.id && dir?.byId.has(e.user_id),
  );
  return (
    <>
      <PageHeader title="My team" subtitle="Last 30 days · only your own team is visible" />
      {emp.isLoading ? (
        <LoadingBlock />
      ) : emp.isError ? (
        <ErrorBlock error={emp.error} />
      ) : rows.length === 0 ? (
        <EmptyState message="No team members assigned to you yet. Ask an admin." />
      ) : (
        <div className="surface overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Today's attendance</TableHead>
                <TableHead className="text-right">Active leads</TableHead>
                <TableHead className="text-right">Outreach</TableHead>
                <TableHead className="text-right">Meetings</TableHead>
                <TableHead className="text-right">Won</TableHead>
                <TableHead className="text-right">Tasks done</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.user_id}>
                  <TableCell className="font-medium">{e.full_name}</TableCell>
                  <TableCell>
                    <TodayCell row={attendance.byUser.get(e.user_id)} />
                  </TableCell>
                  <TableCell className="text-right">{e.active_leads}</TableCell>
                  <TableCell className="text-right">{num(e.outreach)}</TableCell>
                  <TableCell className="text-right">{num(e.meetings)}</TableCell>
                  <TableCell className="text-right">{num(e.conversions)}</TableCell>
                  <TableCell className="text-right">{num(e.tasks_completed)}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTarget({ id: e.user_id, name: e.full_name })}
                    >
                      Coaching note
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <SectionCard title="Recent coaching notes" className="mt-4">
        {(notes.data ?? []).length === 0 ? (
          <EmptyState message="None yet." />
        ) : (
          <ul className="space-y-2 text-sm">
            {(notes.data ?? []).map((n) => (
              <li key={n.id}>
                <span className="font-medium">{userName(n.employee_id)}</span>: {n.note}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <RecordDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={`Coaching note — ${target?.name ?? ""}`}
        submitting={add.isPending}
        fields={[{ name: "note", type: "textarea", required: true }]}
        onSubmit={(v) => add.mutate(v)}
      />
    </>
  );
}
