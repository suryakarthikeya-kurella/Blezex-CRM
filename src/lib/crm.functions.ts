import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SHEET_COLUMNS, type TabName } from "./crm-schema";

const tabSchema = z.enum(["Leads", "Clients", "Activities", "Tasks", "Settings"]);

export const fetchTable = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ tab: tabSchema }).parse(data))
  .handler(async ({ data }) => {
    const { readTable } = await import("./sheets.server");
    return readTable(data.tab as TabName);
  });

const recordSchema = z.record(z.string(), z.string());

export const createRecord = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ tab: tabSchema, record: recordSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    const { appendRecord } = await import("./sheets.server");
    await appendRecord(data.tab as TabName, data.record);
    return { ok: true };
  });

export const saveRecord = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ tab: tabSchema, row: z.number().int().min(2), record: recordSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    const { updateRecord } = await import("./sheets.server");
    await updateRecord(data.tab as TabName, data.row, data.record);
    return { ok: true };
  });

export const removeRecord = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ tab: tabSchema, row: z.number().int().min(2) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { deleteRecord } = await import("./sheets.server");
    await deleteRecord(data.tab as TabName, data.row);
    return { ok: true };
  });

export const tableColumns = SHEET_COLUMNS;
