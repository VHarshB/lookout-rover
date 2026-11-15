(() => {
"use strict";
const AWS_URL = "https://dtswp7wigzuzuyhuqvkqnsvelu0tedst.lambda-url.us-east-2.on.aws/";   // ← from deploy.sh, e.g. https://abc123.lambda-url.us-east-1.on.aws/

const base = (new URLSearchParams(location.search).get("aws") || AWS_URL).replace(/\/?$/, "/");
const ready = /^https:\/\/.+/.test(base) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(base);
const session = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "") + "-" +
  Math.random().toString(36).slice(2, 6);
const queue = [];
let logged = 0, failed = false;

const bus = "BroadcastChannel" in window ? new BroadcastChannel("lookout-aws") : null;
const tell = msg => { try { bus?.postMessage({...msg, session, at: Date.now()}); } catch {} };


const HAZARDS = [
  [/obstacle/i, "obstacle_stop"], [/no echo/i, "no_echo"], [/no steering updates|no heading reply/i, "command_lost"],
  [/wheels not moving|stalled/i, "wheels_stalled"], [/power off/i, "power_off"], [/face out of frame/i, "face_lost"],
  [/^stopped/i, "voice_stop"],
];
const $ = id => document.getElementById(id);
const text = id => ($(id)?.textContent || "").replace(/\s+/g, " ").trim();
const number = id => { const n = parseFloat(text(id)); return Number.isFinite(n) ? n : null; };

function log(event, data = {}) {
  if (!ready) return;
  queue.push({t: Date.now(), event, data});
  if (queue.length > 400) queue.splice(0, queue.length - 400);
}

async function flush(useBeacon = false) {
  if (!ready || !queue.length) return;
  const events = queue.splice(0, 50);
  const body = JSON.stringify({session, events});
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(base + "log", new Blob([body], {type: "text/plain"}));
    return;
  }
  try {
    const r = await fetch(base + "log", {method: "POST", headers: {"content-type": "text/plain"}, body});
    if (!r.ok) throw new Error(r.status);
    logged += events.length; failed = false;
    tell({kind: "sent", events: events.map(e => e.event)});
  } catch {
    failed = true;
    tell({kind: "failed", count: events.length});
    queue.unshift(...events);       // try again on the next flush
  }
  paintBadge();
}


let lastState = "", lastCmd = "", wasConnected = false, faceGoneAt = 0;
function watch() {
  const state = text("state");
  if (state && state !== lastState) {
    lastState = state;
    const hit = HAZARDS.find(([re]) => re.test(state));
    log(hit ? hit[1] : "state_change", {state, distance: number("distance"), heading: number("heading")});
  }
  const vc = $("voice-command");
  const cmd = vc && vc.dataset.accepted === "true" ? text("voice-command") : "";
  if (cmd && cmd !== lastCmd) log("voice_command", {command: cmd.slice(0, 40)});
  lastCmd = cmd;
  const connected = document.body.dataset.connected === "true";
  if (connected !== wasConnected) {
    log(connected ? "link_up" : "link_lost", {state: text("connection")});
    wasConnected = connected;
  }
}
function telemetry() {
  if (document.body.dataset.connected !== "true") return;
  log("telemetry", {state: lastState, heading: number("heading"), distance: number("distance"), target: number("target")});
}


const CSS = `
.lr-aws{position:fixed;left:max(16px,env(safe-area-inset-left));bottom:max(14px,env(safe-area-inset-bottom));z-index:9;
  display:flex;align-items:center;gap:10px;padding:8px 8px 8px 14px;border-radius:999px;
  background:rgba(29,23,65,.88);border:1px solid rgba(236,198,106,.45);color:#fff3d6;
  font:500 14px/1.2 'Instrument Sans','Segoe UI',sans-serif;box-shadow:0 10px 30px -12px #000a;backdrop-filter:blur(6px)}
.lr-aws .lr-dot{width:9px;height:9px;border-radius:50%;background:#8d82ad}
.lr-aws[data-live="true"] .lr-dot{background:#ff9900;box-shadow:0 0 10px #ff9900}
.lr-aws[data-live="error"] .lr-dot{background:#ff6b81}
.lr-aws .lr-map{color:#ecc66a;font-weight:600;text-decoration:none;padding:0 4px}
.lr-aws .lr-map:hover{text-decoration:underline}
.lr-aws button{min-height:34px!important;padding:6px 14px!important;font:600 14px/1 'Instrument Sans','Segoe UI',sans-serif!important;
  border-radius:999px!important;border:0!important;color:#2a1405!important;background:linear-gradient(120deg,#ffb347,#ff8a3d)!important;cursor:pointer}
.lr-dialog{width:min(620px,calc(100vw - 32px));border:1px solid rgba(236,198,106,.5);border-radius:22px;padding:0;
  background:#1a1438;color:#fff3d6;box-shadow:0 30px 80px -20px #000c}
.lr-dialog::backdrop{background:rgba(10,7,26,.66);backdrop-filter:blur(3px)}
.lr-in{padding:24px 26px 22px}
.lr-in h2{margin:0;font:700 30px/1.15 'Fraunces',Georgia,serif;font-variation-settings:'SOFT' 100,'WONK' 1}
.lr-by{margin:6px 0 16px;color:#b9add6;font:500 14px/1.4 'Instrument Sans','Segoe UI',sans-serif}
.lr-text{margin:0;font:400 18px/1.6 'Instrument Sans','Segoe UI',sans-serif;min-height:3em;white-space:pre-wrap}
.lr-stats{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 0;padding:0;list-style:none}
.lr-stats li{padding:6px 12px;border-radius:999px;background:rgba(205,184,244,.12);border:1px solid rgba(205,184,244,.25);
  font:500 14px/1.2 'Instrument Sans','Segoe UI',sans-serif}
.lr-stats b{font-family:'IBM Plex Mono',Consolas,monospace;color:#ecc66a}
.lr-row{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
.lr-row button{min-height:44px!important;padding:10px 18px!important;font-size:16px!important;border-radius:12px!important}
.lr-play{background:linear-gradient(120deg,#ffb347,#ff8a3d)!important;color:#2a1405!important;border:0!important}
@media (max-width:640px){.lr-aws{font-size:13px;bottom:max(12px,env(safe-area-inset-bottom))}}
`;
let badge, dialog, audio = null;

function paintBadge() {
  if (!badge) return;
  const label = badge.querySelector(".lr-label");
  if (!ready) { badge.dataset.live = "false"; label.textContent = "AWS: add the link in aws.js"; return; }
  badge.dataset.live = failed ? "error" : "true";
  label.textContent = failed ? "AWS: retrying…" : `AWS mission log · ${logged} events`;
}

function buildUI() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  badge = document.createElement("div");
  badge.className = "lr-aws";
  badge.setAttribute("role", "status");
  badge.innerHTML = `<span class="lr-dot" aria-hidden="true"></span><span class="lr-label"></span>
    <a class="lr-map" href="aws-live.html" target="_blank" rel="noopener">Live map</a>
    <button type="button" class="lr-open">Mission report</button>`;
  document.body.appendChild(badge);
  dialog = document.createElement("dialog");
  dialog.className = "lr-dialog";
  dialog.setAttribute("aria-labelledby", "lr-title");
  dialog.innerHTML = `<div class="lr-in"><h2 id="lr-title">Mission report</h2>
    <p class="lr-by">Written by Amazon Bedrock · read aloud by Amazon Polly · logged in DynamoDB</p>
    <p class="lr-text" aria-live="polite"></p><ul class="lr-stats"></ul>
    <div class="lr-row"><button type="button" class="lr-play">Play again</button><button type="button" class="lr-close">Close</button></div></div>`;
  document.body.appendChild(dialog);
  badge.querySelector(".lr-open").addEventListener("click", openReport);
  dialog.querySelector(".lr-close").addEventListener("click", () => { stopAudio(); dialog.close(); });
  dialog.querySelector(".lr-play").addEventListener("click", playAudio);
  dialog.addEventListener("close", stopAudio);
  paintBadge();
}

function stopAudio() {
  if (audio) { audio.pause(); audio.currentTime = 0; }
  if (window.hoot) window.hoot.speaking = false;
}
function playAudio() {
  if (!audio) return;
  stopAudio();
  const hoot = window.hoot;
  audio.onplay = () => { if (hoot) hoot.speaking = true; };
  audio.onended = audio.onpause = () => { if (hoot) hoot.speaking = false; };
  audio.play().catch(() => {});
}

async function openReport() {
  const out = dialog.querySelector(".lr-text"), stats = dialog.querySelector(".lr-stats"), by = dialog.querySelector(".lr-by");
  stats.innerHTML = "";
  dialog.showModal();
  if (!ready) { out.textContent = "Add your AWS link to aws.js (line 12) to turn on mission reports."; return; }
  out.textContent = "Hoot is writing the report with Amazon Bedrock…";
  window.hoot?.showBubble?.("Writing my mission report…", 4000);
  log("report_requested");
  await flush();
  tell({kind: "report-start"});
  try {
    const r = await fetch(base + "report", {method: "POST", headers: {"content-type": "text/plain"}, body: JSON.stringify({session})});
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || r.status);
    out.textContent = data.report;
    by.textContent = (data.model === "template" ? "Template report (Bedrock unavailable)" : `Written by Amazon Bedrock (${data.model})`) +
      (data.audio ? ` · read aloud by Amazon Polly (${data.voice})` : "") + " · logged in DynamoDB";
    const s = data.stats || {}, c = s.counts || {};
    const chips = [["Minutes", s.minutes], ["Events", s.events_logged], ["Obstacle stops", c.obstacle_stop || 0],
      ["Voice commands", c.voice_command || 0], ["Closest obstacle", s.closest_obstacle_cm != null ? s.closest_obstacle_cm + " cm" : "—"],
      ["Link drops", (c.link_lost || 0) + (c.command_lost || 0)]];
    stats.innerHTML = chips.map(([k, v]) => `<li>${k} <b>${v ?? 0}</b></li>`).join("");
    audio = data.audio ? new Audio("data:audio/mpeg;base64," + data.audio) : null;
    window.hoot?.showBubble?.("Here's my mission report!", 4000);
    tell({kind: "report-done", model: data.model, audio: Boolean(data.audio)});
    playAudio();
  } catch (err) {
    tell({kind: "report-error"});
    out.textContent = "Couldn't reach AWS just now. The rover still works; try again in a moment.";
  }
}


function start() {
  buildUI();
  if (!ready) return;
  log("session_start", {page: location.host || "local", state: text("state")});
  setInterval(watch, 150);
  setInterval(telemetry, 2000);
  setInterval(() => flush(), 3000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true); });
  window.lookoutAws = {session, log, flush};
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
})();
