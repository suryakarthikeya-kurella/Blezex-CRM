export type TabName = "Leads" | "Clients" | "Activities" | "Tasks" | "Settings";

export const SHEET_COLUMNS: Record<TabName, string[]> = {
  Leads: [
    "Lead ID",
    "Company Name",
    "Contact Person",
    "Phone Number",
    "Email Address",
    "Service Requirement",
    "Lead Source",
    "Assigned To",
    "Priority",
    "Status",
    "Last Follow-up Date",
    "Next Follow-up Date",
    "Expected Deal Value",
    "Probability %",
    "Expected Closing Date",
    "Notes",
    "Created By",
    "Created Date",
    "Last Updated By",
    "Last Updated Date",
  ],
  Clients: [
    "Client ID",
    "Company Name",
    "Contact Person",
    "Phone Number",
    "Email Address",
    "Service Purchased",
    "Project Value",
    "Account Manager",
    "Start Date",
    "Completion Date",
    "Project Status",
    "Payment Status",
    "Amount Paid",
    "Balance Amount",
    "Notes",
    "Created By",
    "Created Date",
    "Last Updated By",
    "Last Updated Date",
  ],
  Activities: [
    "Activity ID",
    "Date",
    "Company",
    "Contact Person",
    "Activity Type",
    "Discussion Summary",
    "Outcome",
    "Next Action",
    "Next Follow-up Date",
    "Owner",
    "Created By",
    "Created Date",
    "Last Updated By",
    "Last Updated Date",
  ],
  Tasks: [
    "Task ID",
    "Task Title",
    "Description",
    "Assigned To",
    "Priority",
    "Due Date",
    "Status",
    "Created By",
    "Created Date",
    "Last Updated By",
    "Last Updated Date",
  ],
  Settings: ["Key", "Value"],
};

/* Sheet rows are dynamic: column names come from SHEET_COLUMNS at runtime. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SheetRow = { __row: number } & Record<string, any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CrmRecord = Record<string, any>;

export const LEAD_STATUSES = [
  "New Lead",
  "Contacted",
  "Meeting Scheduled",
  "Proposal Sent",
  "Negotiation",
  "Converted Client",
  "Lost",
  "On Hold",
] as const;

export const KANBAN_STAGES = [
  "New Lead",
  "Contacted",
  "Meeting Scheduled",
  "Proposal Sent",
  "Negotiation",
  "Converted Client",
  "Lost",
] as const;

export const PRIORITIES = ["High", "Medium", "Low"] as const;

export const LEAD_SOURCES = [
  "Website",
  "Referral",
  "LinkedIn",
  "Cold Call",
  "Email Campaign",
  "Social Media",
  "Event",
  "Other",
] as const;

export const SERVICES = [
  "IT Solutions",
  "Custom Software Development",
  "Web Application Development",
  "SaaS Development",
  "AI Solutions",
  "Automation Solutions",
  "CRM Development",
  "Mobile App Development",
  "Business Websites",
  "Cloud Solutions",
  "Graphic Design",
  "Logo Design",
  "Brand Identity",
  "Social Media Creatives",
  "Brochures",
  "Marketing Materials",
  "Presentations",
  "Digital Marketing",
  "SEO",
  "Social Media Marketing",
  "Lead Generation",
  "Performance Marketing",
  "Email Marketing",
  "Content Creation",
  "Website Content",
  "Social Media Content",
  "Blog Writing",
  "Marketing Content",
  "Video Content Planning",
] as const;

export const PROJECT_STATUSES = [
  "Onboarding",
  "In Progress",
  "Waiting for Client",
  "Completed",
  "Maintenance",
  "Renewal Due",
] as const;

export const PAYMENT_STATUSES = ["Pending", "Partial", "Paid"] as const;

export const ACTIVITY_TYPES = [
  "Call",
  "WhatsApp",
  "Email",
  "Meeting",
  "Demo",
  "Proposal Discussion",
  "Follow-up",
  "Client Review",
] as const;

export const TASK_STATUSES = ["To Do", "In Progress", "Completed"] as const;

export const statusTone = (status: string): "info" | "success" | "warning" | "danger" | "muted" => {
  switch (status) {
    case "Converted Client":
    case "Completed":
    case "Paid":
      return "success";
    case "Lost":
      return "danger";
    case "Negotiation":
    case "Proposal Sent":
    case "On Hold":
    case "Waiting for Client":
    case "Partial":
    case "Renewal Due":
    case "In Progress":
      return "warning";
    case "New Lead":
    case "Contacted":
    case "Meeting Scheduled":
    case "Onboarding":
    case "Maintenance":
      return "info";
    default:
      return "muted";
  }
};
