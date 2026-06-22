import { google } from "googleapis";

const DEFAULT_TAB = process.env.GOOGLE_SHEET_TAB || "CRM";
const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1Mq5Md3s_uuZTru79A4u86-PdvxuF__LBZDLVxYFup9o";

export const BASE_HEADERS = ["id","created_at","updated_at","nombre_alumno","alias","telefono","buyer_persona","notas_generales"];

export function hasSheetsConfig() {
  return Boolean(SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

function privateKey() {
  return (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

async function sheetsClient() {
  if (!hasSheetsConfig()) return null;
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

export function slugifyCampaign(name = "") {
  return String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "campana";
}

export function campaignHeaders(campaignName) {
  const slug = slugifyCampaign(campaignName);
  return [`campana_${slug}_envio_comunicacion`,`campana_${slug}_fecha_envio`,`campana_${slug}_respuesta`,`campana_${slug}_respuesta_check`];
}

export function extractCampaigns(headers = []) {
  const map = new Map();
  headers.forEach((header) => {
    const match = String(header).match(/^campana_(.+)_(envio_comunicacion|fecha_envio|respuesta|respuesta_check)$/);
    if (match) {
      const slug = match[1];
      if (!map.has(slug)) map.set(slug, { slug, label: slug.split("_").filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "), headers: campaignHeaders(slug) });
    }
  });
  return Array.from(map.values());
}

function normalizeRow(row = [], headers = []) {
  return headers.reduce((acc, header, index) => { acc[header] = row[index] ?? ""; return acc; }, {});
}

function colLetter(index) {
  let temp = index + 1;
  let letter = "";
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

async function ensureSheetExists(sheets) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = spreadsheet.data.sheets?.some((sheet) => sheet.properties?.title === DEFAULT_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: DEFAULT_TAB, gridProperties: { rowCount: 1000, columnCount: 120 } } } }] } });
  }
}

async function readValues(sheets) {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${DEFAULT_TAB}!A1:ZZ` });
  return response.data.values || [];
}

async function ensureHeaders(sheets, requestedHeaders = []) {
  await ensureSheetExists(sheets);
  const values = await readValues(sheets);
  let headers = values[0] || [];
  const required = Array.from(new Set([...BASE_HEADERS, ...requestedHeaders]));
  const missing = required.filter((header) => !headers.includes(header));
  if (headers.length === 0) {
    headers = required;
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${DEFAULT_TAB}!A1:${colLetter(headers.length - 1)}1`, valueInputOption: "RAW", requestBody: { values: [headers] } });
    return { headers, rows: [] };
  }
  if (missing.length > 0) {
    headers = [...headers, ...missing];
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${DEFAULT_TAB}!A1:${colLetter(headers.length - 1)}1`, valueInputOption: "RAW", requestBody: { values: [headers] } });
  }
  const refreshed = await readValues(sheets);
  return { headers: refreshed[0] || headers, rows: refreshed.slice(1) };
}

export async function listRecords() {
  const sheets = await sheetsClient();
  if (!sheets) return { mode: "local", headers: BASE_HEADERS, campaigns: [], records: [] };
  const { headers, rows } = await ensureHeaders(sheets);
  const records = rows.map((row) => normalizeRow(row, headers)).filter((record) => Object.values(record).some((value) => String(value).trim() !== ""));
  return { mode: "sheets", headers, campaigns: extractCampaigns(headers), records };
}

function buildRow(record, headers) {
  return headers.map((header) => record[header] ?? "");
}

export async function upsertRecord(payload) {
  const sheets = await sheetsClient();
  if (!sheets) return { mode: "local", record: payload, message: "Google Sheets no esta configurado. El frontend usara almacenamiento local." };
  const campaignName = payload?.campaign_name || "";
  const requestedHeaders = campaignName ? campaignHeaders(campaignName) : [];
  const { headers, rows } = await ensureHeaders(sheets, requestedHeaders);
  const now = new Date().toISOString();
  const id = payload.id || `docroi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const existingIndex = rows.findIndex((row) => row[headers.indexOf("id")] === id);
  const current = existingIndex >= 0 ? normalizeRow(rows[existingIndex], headers) : {};
  const next = { ...current, ...payload, id, created_at: current.created_at || payload.created_at || now, updated_at: now };
  delete next.campaign_name;
  if (campaignName) {
    const [sentHeader, dateHeader, responseHeader, responseCheckHeader] = campaignHeaders(campaignName);
    next[sentHeader] = payload.envio_comunicacion ? "Si" : "No";
    next[dateHeader] = payload.fecha_envio || "";
    next[responseHeader] = payload.respuesta || "";
    next[responseCheckHeader] = payload.respuesta_check ? "Si" : "No";
  }
  const row = buildRow(next, headers);
  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${DEFAULT_TAB}!A${rowNumber}:${colLetter(headers.length - 1)}${rowNumber}`, valueInputOption: "USER_ENTERED", requestBody: { values: [row] } });
  } else {
    await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: `${DEFAULT_TAB}!A:${colLetter(headers.length - 1)}`, valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS", requestBody: { values: [row] } });
  }
  return { mode: "sheets", record: next, headers, campaigns: extractCampaigns(headers) };
}
