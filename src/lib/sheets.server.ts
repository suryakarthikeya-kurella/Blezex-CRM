import { SHEET_COLUMNS, type TabName } from "./crm-schema";

const SPREADSHEET_ID = "1hHD7Xf4XEIvxokTonf7kFagv4XqYkEOBogRf9zFCZK4";
const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

export const SHEET_IDS: Record<TabName, number> = {
  Leads: 358902115,
  Clients: 664431564,
  Activities: 1779427596,
  Tasks: 797567263,
  Settings: 1390753343,
};

function headers() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connKey = process.env["GOOGLE_SHEETS_API_KEY"];
  if (!lovableKey || !connKey) {
    throw new Error("Google Sheets connection is not configured for this project.");
  }
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
    "Content-Type": "application/json",
  };
}

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${GATEWAY}/spreadsheets/${SPREADSHEET_ID}${path}`, {
    ...init,
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Sheets request failed [${res.status}]: ${body}`);
    throw new Error(`Google Sheets request failed [${res.status}]: ${body}`);
  }
  return res.json();
}

function colLetter(n: number) {
  let s = "";
  let i = n;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

export async function readTable(tab: TabName) {
  const cols = SHEET_COLUMNS[tab];
  const range = `${tab}!A2:${colLetter(cols.length)}`;
  const data = (await call(`/values/${range}`)) as { values?: string[][] };
  const values = data.values ?? [];
  return values
    .map((row, index) => {
      const obj: Record<string, string> = {};
      cols.forEach((c, i) => {
        obj[c] = row[i] ?? "";
      });
      return { ...obj, __row: index + 2 } as Record<string, string> & { __row: number };
    })
    .filter((r) => cols.some((c) => (r[c] ?? "") !== ""));
}

function toValues(tab: TabName, record: Record<string, string>) {
  return SHEET_COLUMNS[tab].map((c) => record[c] ?? "");
}

export async function appendRecord(tab: TabName, record: Record<string, string>) {
  const cols = SHEET_COLUMNS[tab];
  const range = `${tab}!A:${colLetter(cols.length)}`;
  await call(`/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values: [toValues(tab, record)] }),
  });
}

export async function updateRecord(tab: TabName, row: number, record: Record<string, string>) {
  const cols = SHEET_COLUMNS[tab];
  const range = `${tab}!A${row}:${colLetter(cols.length)}${row}`;
  await call(`/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [toValues(tab, record)] }),
  });
}

export async function deleteRecord(tab: TabName, row: number) {
  await call(`:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: SHEET_IDS[tab],
              dimension: "ROWS",
              startIndex: row - 1,
              endIndex: row,
            },
          },
        },
      ],
    }),
  });
}
