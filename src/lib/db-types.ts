/**
 * Row types for the tables the UI reads. Hand-maintained for now; regenerate with
 * `supabase gen types typescript --linked > src/lib/database.types.ts` once a project is linked.
 */
export type Priority = "low" | "medium" | "high";
export type Stage = {
  key: string;
  label: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
  is_active: boolean;
};
export type Lookup = { id: string; name?: string; label?: string; is_active: boolean };
export type DirectoryUser = {
  id: string;
  full_name: string;
  role: "admin" | "mentor" | "bds_employee";
};

export type Lead = {
  id: string;
  lead_number: string;
  legacy_id: string | null;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  industry: string | null;
  company_size: string | null;
  lead_source_id: string | null;
  lead_source_details: string | null;
  service_id: string | null;
  stage: string;
  priority: Priority;
  estimated_value: number | null;
  currency: string;
  probability: number | null;
  expected_close_date: string | null;
  owner_id: string | null;
  created_by: string | null;
  next_follow_up_at: string | null;
  last_contacted_at: string | null;
  qualification_notes: string | null;
  decision_maker: string | null;
  notes: string | null;
  lost_reason_id: string | null;
  lost_reason_note: string | null;
  converted_client_id: string | null;
  converted_at: string | null;
  archived_at: string | null;
  row_version: number;
  created_at: string;
  updated_at: string;
};
export type Activity = {
  id: string;
  lead_id: string | null;
  client_id: string | null;
  user_id: string;
  activity_type: string;
  subject: string | null;
  description: string | null;
  outcome: string | null;
  next_action: string | null;
  next_follow_up_at: string | null;
  occurred_at: string;
  lead?: { company_name: string; lead_number: string } | null;
};
export type Task = {
  id: string;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "completed" | "cancelled";
  priority: Priority;
  assigned_to: string;
  created_by: string | null;
  lead_id: string | null;
  client_id: string | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  lead?: { company_name: string } | null;
};
export type Client = {
  id: string;
  client_number: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  source_lead_id: string | null;
  relationship_owner_id: string | null;
  status: "onboarding" | "active" | "paused" | "churned";
  notes: string | null;
  created_at: string;
};
export type Notification = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};
export type DashboardSummary = {
  active_leads: number;
  by_stage: { stage: string; label: string; count: number; value: number }[];
  new_leads: number;
  qualified: number;
  meetings_booked: number;
  proposals_sent: number;
  won: number;
  lost: number;
  pipeline_value: number;
  won_value: number;
  follow_ups_today: number;
  overdue_follow_ups: number;
  stale_leads: number;
  tasks_due_today: number;
  overdue_tasks: number;
  pending_approvals: number;
};
