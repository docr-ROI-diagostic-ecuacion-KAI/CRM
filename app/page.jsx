"use client";

import { useEffect, useMemo, useState } from "react";

const LOGO_URL = "https://docroi.marketing/wp-content/uploads/2024/12/Logo_Doctor_ROI.jpg";
const LOCAL_KEY = "docroi_crm_estudiantes_v1";

const emptyRecord = () => ({
  id: "",
  nombre_alumno: "",
  alias: "",
  telefono: "",
  buyer_persona: "",
  notas_generales: "",
  campaign_name: "Botiquin Doc ROI Estudiantes",
  envio_comunicacion: false,
  fecha_envio: new Date().toISOString().slice(0, 10),
  respuesta: "",
  respuesta_check: false
});

function slugifyCampaign(name = "") {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "campana";
}

function campaignHeaders(name) {
  const slug = slugifyCampaign(name);
  return {
    sent: `campana_${slug}_envio_comunicacion`,
    date: `campana_${slug}_fecha_envio`,
    response: `campana_${slug}_respuesta`,
    responseCheck: `campana_${slug}_respuesta_check`
  };
}

function isYes(value) {
  return ["Si", "Sí", "true", true, "1"].includes(value);
}

function recordToForm(record, campaignName) {
  const base = emptyRecord();
  const name = campaignName || record?.campaign_name || base.campaign_name;
  const campaign = campaignHeaders(name);
  return {
    ...base,
    ...record,
    campaign_name: name,
    envio_comunicacion: isYes(record?.[campaign.sent]) || record?.envio_comunicacion === true,
    fecha_envio: record?.[campaign.date] || record?.fecha_envio || base.fecha_envio,
    respuesta: record?.[campaign.response] || record?.respuesta || "",
    respuesta_check: isYes(record?.[campaign.responseCheck]) || record?.respuesta_check === true
  };
}

function extractCampaigns(headers = [], records = []) {
  const found = new Map();
  headers.forEach((header) => {
    const match = String(header).match(/^campana_(.+)_(envio_comunicacion|fecha_envio|respuesta|respuesta_check)$/);
    if (match) found.set(match[1], match[1]);
  });
  records.forEach((record) => {
    if (record.campaign_name) found.set(slugifyCampaign(record.campaign_name), record.campaign_name);
  });
  if (!found.size) return [{ slug: "botiquin_doc_roi_estudiantes", label: "Botiquin Doc ROI Estudiantes" }];
  return Array.from(found.entries()).map(([slug, label]) => ({
    slug,
    label: String(label).split("_").filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
  }));
}

export default function Home() {
  const [records, setRecords] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mode, setMode] = useState("cargando");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(emptyRecord());
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("Preparado para diagnostico y seguimiento.");

  useEffect(() => { loadRecords(); }, []);

  async function loadRecords() {
    setError("");
    try {
      const response = await fetch("/api/records", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.mode === "error") throw new Error(data.detail || data.error || "Error de lectura");
      if (data.mode === "local") {
        const stored = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
        setRecords(stored);
        setHeaders(data.headers || []);
        setMode("local");
        if (stored.length) setForm(recordToForm(stored[0], stored[0].campaign_name));
        setStatus("Modo local activo hasta configurar Google Sheets en Vercel.");
        return;
      }
      const nextRecords = data.records || [];
      setRecords(nextRecords);
      setHeaders(data.headers || []);
      setMode(data.mode || "sheets");
      setForm(nextRecords.length ? recordToForm(nextRecords[0], form.campaign_name) : emptyRecord());
      setStatus("CRM conectado a Google Sheets.");
    } catch (err) {
      const stored = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
      setRecords(stored);
      setMode("local");
      setError(err?.message || "No se pudo conectar con la API.");
      if (stored.length) setForm(recordToForm(stored[0], stored[0].campaign_name));
      setStatus("Modo local de seguridad. Revisa variables de entorno si esperabas Google Sheets.");
    }
  }

  const campaigns = useMemo(() => extractCampaigns(headers, records), [headers, records]);
  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return records;
    return records.filter((record) => [record.nombre_alumno, record.alias, record.telefono, record.buyer_persona].join(" ").toLowerCase().includes(clean));
  }, [records, query]);

  const progress = useMemo(() => {
    const campaign = campaignHeaders(form.campaign_name);
    return records.reduce((acc, record) => {
      acc.total += 1;
      if (isYes(record[campaign.sent]) || record.envio_comunicacion) acc.sent += 1;
      if (isYes(record[campaign.responseCheck]) || record.respuesta_check) acc.answered += 1;
      return acc;
    }, { sent: 0, answered: 0, total: 0 });
  }, [records, form.campaign_name]);

  function updateForm(name, value) { setForm((current) => ({ ...current, [name]: value })); }

  function selectRecord(position) {
    if (!filtered.length) return;
    const safe = Math.max(0, Math.min(position, filtered.length - 1));
    const selected = filtered[safe];
    setForm(recordToForm(selected, form.campaign_name));
    setStatus(`Ficha ${safe + 1} de ${filtered.length}.`);
  }

  function previousRecord() {
    const current = Math.max(0, filtered.findIndex((record) => record.id === form.id));
    selectRecord(current - 1);
  }

  function nextRecord() {
    const current = Math.max(0, filtered.findIndex((record) => record.id === form.id));
    selectRecord(current + 1);
  }

  function newRecord() {
    setForm(emptyRecord());
    setStatus("Nueva ficha preparada. Completa los datos y guarda.");
  }

  function addCampaign() {
    const name = window.prompt("Nombre de la nueva campaña", form.campaign_name || "Nueva campaña Doc ROI");
    if (!name) return;
    updateForm("campaign_name", name.trim());
    setStatus("Campaña añadida. Al guardar, la hoja crecerá con columnas de seguimiento.");
  }

  function upsertLocal(payload) {
    const campaign = campaignHeaders(payload.campaign_name);
    const record = {
      ...payload,
      [campaign.sent]: payload.envio_comunicacion ? "Si" : "No",
      [campaign.date]: payload.fecha_envio || "",
      [campaign.response]: payload.respuesta || "",
      [campaign.responseCheck]: payload.respuesta_check ? "Si" : "No",
      updated_at: new Date().toISOString(),
      created_at: payload.created_at || new Date().toISOString()
    };
    const pos = records.findIndex((item) => item.id === record.id);
    if (pos >= 0) return records.map((item, itemIndex) => itemIndex === pos ? record : item);
    return [record, ...records];
  }

  async function saveRecord(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const payload = { ...form, id: form.id || `docroi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
    try {
      if (mode === "local") {
        const next = upsertLocal(payload);
        setRecords(next);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
        setForm(payload);
        setStatus("Ficha guardada en modo local.");
        return;
      }
      const response = await fetch("/api/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok || data.mode === "error") throw new Error(data.detail || data.error || "Error de guardado");
      await loadRecords();
      setStatus("Ficha guardada en Google Sheets.");
    } catch (err) {
      const next = upsertLocal(payload);
      setRecords(next);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      setMode("local");
      setError(err?.message || "No se pudo guardar en Google Sheets.");
      setStatus("Ficha guardada en local. Revisa la conexion con Google Sheets.");
    } finally { setSaving(false); }
  }

  const position = filtered.length ? Math.max(1, filtered.findIndex((record) => record.id === form.id) + 1) : 0;

  return (
    <main className="docroi-shell">
      <section className="docroi-hero">
        <nav className="docroi-nav" aria-label="Navegacion principal">
          <img src={LOGO_URL} alt="Doc ROI" className="docroi-logo" />
          <div className="docroi-nav-copy"><strong>CRM Doc ROI</strong><span>Canal Estudiantes · Seguimiento de envios</span></div>
          <span className={`docroi-mode ${mode === "sheets" ? "is-live" : ""}`}>{mode === "sheets" ? "Google Sheets" : mode === "cargando" ? "Cargando" : "Modo local"}</span>
        </nav>
        <div className="docroi-hero-grid">
          <div>
            <p className="docroi-eyebrow">Diagnostico comercial · Activacion del dato · Easy Deep</p>
            <h1>Seguimiento clínico de envíos al canal estudiante.</h1>
            <p className="docroi-lead">Primera version del CRM Doc ROI para registrar alumnos, campañas, comunicaciones enviadas y respuestas recibidas sin perder trazabilidad.</p>
            <div className="docroi-actions"><button className="docroi-btn docroi-btn-primary" type="button" onClick={newRecord}>Nueva ficha</button><button className="docroi-btn docroi-btn-secondary" type="button" onClick={loadRecords}>Actualizar datos</button></div>
          </div>
          <aside className="docroi-diagnostic-card" aria-label="Resumen operativo"><span className="docroi-card-label">Pulso de campaña</span><div className="docroi-metrics"><div><strong>{progress.total}</strong><span>fichas</span></div><div><strong>{progress.sent}</strong><span>envios</span></div><div><strong>{progress.answered}</strong><span>respuestas</span></div></div><p>{status}</p></aside>
        </div>
      </section>

      <section className="docroi-workspace">
        <div className="docroi-toolbar">
          <label className="docroi-search"><span>Buscar ficha</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, alias, telefono o buyer persona" /></label>
          <div className="docroi-pagination" aria-label="Recorrer fichas"><button type="button" onClick={previousRecord} disabled={!filtered.length}>←</button><span>{position} / {filtered.length}</span><button type="button" onClick={nextRecord} disabled={!filtered.length}>→</button></div>
        </div>

        <form className="docroi-form-card" onSubmit={saveRecord}>
          <div className="docroi-section-head"><div><p className="docroi-eyebrow">Ficha HTML · CRM v1</p><h2>Datos del alumno</h2></div><button className="docroi-btn docroi-btn-secondary" type="button" onClick={addCampaign}>Añadir campaña</button></div>
          <div className="docroi-form-grid">
            <label><span>Nombre del alumno</span><input value={form.nombre_alumno} onChange={(event) => updateForm("nombre_alumno", event.target.value)} placeholder="Ej. Karla Duran" required /></label>
            <label><span>Alias</span><input value={form.alias} onChange={(event) => updateForm("alias", event.target.value)} placeholder="Ej. Karla UDIMA" /></label>
            <label><span>Telefono</span><input value={form.telefono} onChange={(event) => updateForm("telefono", event.target.value)} placeholder="Ej. +34 600 000 000" inputMode="tel" /></label>
            <label><span>Buyer Persona</span><input value={form.buyer_persona} onChange={(event) => updateForm("buyer_persona", event.target.value)} placeholder="Ej. Alumno master · IA aplicada" /></label>
          </div>
          <div className="docroi-divider" />
          <div className="docroi-section-head compact"><div><p className="docroi-eyebrow">Campaña activa</p><h2>Seguimiento de comunicación</h2></div></div>
          <div className="docroi-form-grid">
            <label className="docroi-wide"><span>Nombre de la campaña</span><input list="campaigns" value={form.campaign_name} onChange={(event) => updateForm("campaign_name", event.target.value)} required /><datalist id="campaigns">{campaigns.map((campaign) => <option key={campaign.slug} value={campaign.label} />)}</datalist></label>
            <label><span>Fecha de envio</span><input type="date" value={form.fecha_envio} onChange={(event) => updateForm("fecha_envio", event.target.value)} /></label>
            <label className="docroi-check"><input type="checkbox" checked={form.envio_comunicacion} onChange={(event) => updateForm("envio_comunicacion", event.target.checked)} /><span>Envio comunicacion realizado</span></label>
            <label className="docroi-check"><input type="checkbox" checked={form.respuesta_check} onChange={(event) => updateForm("respuesta_check", event.target.checked)} /><span>Respuesta recibida</span></label>
            <label className="docroi-wide"><span>Respuesta</span><textarea value={form.respuesta} onChange={(event) => updateForm("respuesta", event.target.value)} placeholder="Resume la reaccion, interes, objecion o siguiente paso." rows={5} /></label>
            <label className="docroi-wide"><span>Notas generales</span><textarea value={form.notas_generales} onChange={(event) => updateForm("notas_generales", event.target.value)} placeholder="Contexto de relacion, tono recomendado, canal u observaciones." rows={4} /></label>
          </div>
          {error ? <p className="docroi-error">{error}</p> : null}
          <div className="docroi-submit-row"><p>Al guardar una campaña nueva, el sistema crea en la hoja columnas de envio, fecha, respuesta y check.</p><button className="docroi-btn docroi-btn-primary" type="submit" disabled={saving}>{saving ? "Guardando" : "Guardar ficha"}</button></div>
        </form>

        <aside className="docroi-list-card"><div className="docroi-section-head compact"><div><p className="docroi-eyebrow">Base viva</p><h2>Ultimas fichas</h2></div></div><div className="docroi-record-list">{filtered.length ? filtered.slice(0, 12).map((record, pos) => (<button key={record.id || pos} type="button" onClick={() => selectRecord(pos)} className={record.id === form.id ? "is-active" : ""}><strong>{record.nombre_alumno || "Sin nombre"}</strong><span>{record.alias || record.telefono || "Ficha pendiente"}</span></button>)) : <p className="docroi-empty">Aun no hay fichas. Crea la primera y empieza el seguimiento.</p>}</div></aside>
      </section>

      <section className="docroi-method"><div><p className="docroi-eyebrow">DIIIP aplicado al CRM</p><h2>Del contacto disperso a la trazabilidad comercial.</h2></div><p>Data → Information → Intelligence → Insights → Personalization of Actions. Este CRM v1 no sustituye la Ecuacion KAI·ROI; actua como capa operativa para ordenar comunicaciones, respuestas y aprendizaje sobre el canal estudiante.</p></section>
      <footer className="docroi-footer"><span>Doc ROI · Clinica ejecutiva de conocimiento</span><span>CRM v1 · Canal Estudiantes · Google Sheets + Vercel</span></footer>
    </main>
  );
}
