import { NextResponse } from "next/server";
import { listRecords, upsertRecord } from "../../../lib/sheets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await listRecords();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ mode: "error", error: "No se pudo leer Google Sheets.", detail: error?.message || String(error) }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const data = await upsertRecord(payload);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ mode: "error", error: "No se pudo guardar la ficha.", detail: error?.message || String(error) }, { status: 500 });
  }
}
