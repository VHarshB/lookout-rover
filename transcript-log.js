// Voice transcript log for the Lookout Rover console.
//
// Keeps every voice exchange in this browser's IndexedDB so it survives reloads:
//   speaker "operator" – what the mic heard (final phrases, plus interim phrases
//                        that already moved or stopped the rover)
//   speaker "rover"    – the console's reply to that phrase (accepted / rejected)
//   speaker "hoot"     – lines Hoot showed or spoke
// Nothing leaves the machine; use the panel's download buttons to export.
//
// API: window.LookoutTranscript.add(entry) → Promise<id>
//      .update(id, patch), .all(), .clear(), .download("csv" | "json"), .sessionId
(() => {
"use strict";

const DB_NAME = "lookout-rover";
const STORE = "voice-transcript";
const MAX_ENTRIES = 5000;      // oldest entries are pruned beyond this
const SHOWN = 200;             // entries rendered in the panel
const sessionId = new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 6);

let dbPromise = null;
let memory = [];               // fallback when IndexedDB is unavailable (private mode, blocked storage)
let memoryId = 0;
let recent = [];               // newest last, capped at SHOWN, for rendering
const listeners = new Set();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, {keyPath: "id", autoIncrement: true});
      store.createIndex("at", "at");
      store.createIndex("session", "session");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  }).catch(error => { dbPromise = Promise.resolve(null); console.warn("Transcript kept in memory only:", error); return null; });
  return dbPromise;
}

function tx(db, mode, run) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

function clean(entry) {
  const out = {
    at: new Date().toISOString(),
    session: sessionId,
    speaker: entry.speaker,
    text: String(entry.text ?? "").slice(0, 500),
  };
  for (const key of ["kind", "command", "outcome", "source", "lineId", "replyTo"]) {
    if (entry[key] !== undefined && entry[key] !== null && entry[key] !== "") out[key] = entry[key];
  }
  if (typeof entry.final === "boolean") out.final = entry.final;
  if (typeof entry.audible === "boolean") out.audible = entry.audible;
  return out;
}

function remember(record) {
  const i = recent.findIndex(r => r.id === record.id);
  if (i >= 0) recent[i] = record;
  else { recent.push(record); if (recent.length > SHOWN) recent.shift(); }
  for (const fn of listeners) { try { fn(record); } catch (_) {} }
}

let pruneTimer = 0;
function schedulePrune() {
  clearTimeout(pruneTimer);
  pruneTimer = setTimeout(async () => {
    const db = await openDb();
    if (!db) { if (memory.length > MAX_ENTRIES) memory.splice(0, memory.length - MAX_ENTRIES); return; }
    try {
      const count = await tx(db, "readonly", s => s.count());
      let excess = count - MAX_ENTRIES;
      if (excess <= 0) return;
      await tx(db, "readwrite", s => {
        s.openCursor().onsuccess = e => {
          const cursor = e.target.result;
          if (!cursor || excess-- <= 0) return;
          cursor.delete();
          cursor.continue();
        };
      });
    } catch (_) {}
  }, 2000);
}

async function add(entry) {
  if (!entry || !entry.speaker || !String(entry.text ?? "").trim()) return null;
  const record = clean(entry);
  const db = await openDb();
  if (db) {
    try { record.id = await tx(db, "readwrite", s => s.add(record)); }
    catch (_) { record.id = "m" + (++memoryId); memory.push(record); }
  } else {
    record.id = "m" + (++memoryId);
    memory.push(record);
  }
  remember(record);
  schedulePrune();
  return record.id;
}

async function update(id, patch) {
  if (id === null || id === undefined) return;
  const current = recent.find(r => r.id === id) || memory.find(r => r.id === id);
  const db = await openDb();
  let record = current;
  if (!record && db && typeof id === "number") {
    try { record = await tx(db, "readonly", s => s.get(id)); } catch (_) {}
  }
  if (!record) return;
  const next = {...record, ...clean({...record, ...patch}), id, at: record.at, session: record.session};
  if (db && typeof id === "number") { try { await tx(db, "readwrite", s => s.put(next)); } catch (_) {} }
  else { const i = memory.findIndex(r => r.id === id); if (i >= 0) memory[i] = next; }
  remember(next);
}

async function all() {
  const db = await openDb();
  let stored = [];
  if (db) { try { stored = await tx(db, "readonly", s => s.getAll()); } catch (_) {} }
  return stored.concat(memory).sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
}

async function clear() {
  const db = await openDb();
  if (db) { try { await tx(db, "readwrite", s => s.clear()); } catch (_) {} }
  memory = [];
  recent = [];
  for (const fn of listeners) { try { fn(null); } catch (_) {} }
}

const COLUMNS = ["at", "session", "speaker", "kind", "text", "command", "outcome", "source", "final", "audible", "lineId", "id", "replyTo"];
function toCsv(rows) {
  const cell = v => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [COLUMNS.join(",")].concat(rows.map(r => COLUMNS.map(c => cell(r[c])).join(","))).join("\r\n");
}

async function download(format = "csv") {
  const rows = await all();
  const body = format === "json" ? JSON.stringify(rows, null, 2) : toCsv(rows);
  const blob = new Blob([body], {type: format === "json" ? "application/json" : "text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lookout-rover-voice-transcript-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + "." + (format === "json" ? "json" : "csv");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rows.length;
}

// ---------- panel ----------
const SPEAKER = {operator: "You", rover: "Rover", hoot: "Hoot"};

function bindPanel() {
  const panel = document.getElementById("transcript-panel");
  const list = document.getElementById("transcript-list");
  const status = document.getElementById("transcript-status");
  if (!panel || !list) return;

  const render = () => {
    if (!panel.open) return;
    const rows = recent.slice().reverse();
    list.replaceChildren(...rows.map(r => {
      const li = document.createElement("li");
      li.dataset.speaker = r.speaker;
      if (r.outcome) li.dataset.outcome = r.outcome;
      const time = document.createElement("time");
      time.dateTime = r.at;
      time.textContent = new Date(r.at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"});
      const who = document.createElement("b");
      who.textContent = SPEAKER[r.speaker] || r.speaker;
      const text = document.createElement("span");
      text.textContent = r.text;
      const meta = [r.command && "→ " + r.command, r.outcome, r.source, r.final === false && "interim",
        r.speaker === "hoot" && r.audible === false && "muted"].filter(Boolean).join(" · ");
      li.append(time, who, text);
      if (meta) { const m = document.createElement("small"); m.textContent = meta; li.append(m); }
      return li;
    }));
    if (status) status.textContent = rows.length
      ? "Showing the latest " + rows.length + " entries. Stored only in this browser."
      : "No voice activity recorded yet. Stored only in this browser.";
  };

  let queued = false;
  listeners.add(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; render(); }); } });
  panel.addEventListener("toggle", render);

  document.getElementById("transcript-csv")?.addEventListener("click", async () => {
    const n = await download("csv");
    if (status) status.textContent = "Downloaded " + n + " entries as CSV.";
  });
  document.getElementById("transcript-json")?.addEventListener("click", async () => {
    const n = await download("json");
    if (status) status.textContent = "Downloaded " + n + " entries as JSON.";
  });
  document.getElementById("transcript-clear")?.addEventListener("click", async () => {
    if (!confirm("Delete the whole voice transcript stored in this browser?")) return;
    await clear();
    if (status) status.textContent = "Transcript cleared.";
  });

  // Seed the panel with the most recent stored entries.
  all().then(rows => {
    const stored = new Set(rows.map(r => r.id));
    recent = rows.concat(recent.filter(r => !stored.has(r.id))).slice(-SHOWN);
    render();
  });
}

window.LookoutTranscript = {add, update, all, clear, download, sessionId};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindPanel);
else bindPanel();
})();
