/* Optional local companion. With no injected local config this file is inert. */
(() => {
"use strict";
const config = window.LookoutService;
if (!config || !window.LookoutRover) return;
const rover = window.LookoutRover;
const client = crypto.randomUUID();
let active = false, revision = 0, commandValue = null, commandAt = 0;
let heldReason = "";
let proposal = null, observation = null, observationAt = 0, selected = null;
let framePending = null, frameBusy = false, tickBusy = false, thinking = false;
let visionCommand = false, claiming = false, permitted = false;
let lastTick = 0, lastStream = "", listenOnce = false, busyAction = false;
const panel = document.createElement("details");
panel.className = "assist-panel";
panel.id = "assist-panel";
panel.innerHTML = [
 '<summary>Assisted vision &amp; voice</summary>',
 '<p>Local vision and AWS command understanding. Manual control is unchanged when this mode is off.</p>',
 '<div class="assist-row"><button id="assist-mode" type="button" aria-pressed="false">Enable Assisted mode</button><button id="assist-manual" type="button">Return to manual</button></div>',
 '<p id="assist-status" role="status">Checking local service…</p>',
 '<p id="assist-health"></p>',
 '<p>Detector vocabulary includes people, chairs, bottles, tables, plants, sofas, monitors and common animals/vehicles. Unrecognized objects require clarification.</p>',
 '<div class="assist-row"><input id="assist-import-link" type="text" aria-label="Existing saved phone link" placeholder="Paste existing phone link to keep its pairing"><button id="assist-import" type="button">Use existing phone link</button></div>',
 '<div class="assist-row"><input id="assist-text" type="text" maxlength="500" aria-label="Natural-language command" placeholder="Approach the person on the right"><button id="assist-send" type="button">Understand command</button><button id="assist-listen" type="button">Use next spoken phrase</button></div>',
 '<p>Say “Rover” before a request, or select Use next spoken phrase. Stop and Esc stay local. Say “Rover confirm” to confirm a proposal.</p>',
 '<div id="assist-targets" class="assist-targets" role="group" aria-label="Visible targets"></div>',
 '<p id="assist-proposal"></p>',
 '<label><input type="checkbox" id="assist-direction">I verified camera/turn direction with wheels lifted.</label>',
 '<div class="assist-row"><label>Camera direction <select id="assist-polarity"><option value="1">Normal rear camera</option><option value="-1">Reversed camera axis</option></select></label><button id="assist-confirm" type="button" disabled>Confirm command</button><button id="assist-cancel" type="button">Cancel / stop</button></div>',
 '<div id="assist-range-panel" hidden><p>Target centered. Before driving, verify a clear floor and that the front sensor measures the selected target, not another surface. Measure its current distance with a tape.</p>',
 '<label><input type="checkbox" id="assist-range-check">The selected target is in the front sensor beam, the route is clear, and the target is stationary.</label>',
 '<div class="assist-row"><label>Measured distance (cm) <input id="assist-range" type="number" min="70" max="300" step="1" value="100"></label><button id="assist-range-confirm" type="button">Verify range and approach</button></div></div>',
 '<p>Approach stops at 60 cm, on uncertainty, or after 8 seconds. No route-around-obstacle or continuous following. Keep your face visible; head yaw is reserved for manual mode.</p>'
].join("");
document.querySelector("main").appendChild(panel);
const $ = id => document.getElementById(id);
const overlay = document.createElement("div");
overlay.className = "assist-overlay";
document.querySelector("#phone-panel .camera").appendChild(overlay);
const status = text => { $("assist-status").textContent = text; };
const telemetry = () => rover.snapshot();

async function api(path, body, timeout = 2000) {
 const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
 try {
  const response = await fetch(config.api + path, {
   method: body === undefined ? "GET" : "POST",
   headers: {"Content-Type":"application/json", "X-Lookout-Token":config.token, "X-Lookout-Client":client},
   body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache:"no-store"
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Local service unavailable");
  return result;
 } finally { clearTimeout(timer); }
}
function clearMotion(message) {
 revision++; permitted = false; heldReason = message;
 commandValue = null; commandAt = 0; proposal = null;
 $("assist-proposal").textContent = "";
 $("assist-confirm").disabled = true;
 $("assist-range-panel").hidden = true;
 $("assist-range-check").checked = false;
 status(message);
}
function cancel(message = "Stopped") {
 clearMotion(message);
 if (active) api("/cancel", {}).catch(() => {});
}
function release(message = "Manual control") {
 if (!active) return;
 active = false;
 clearMotion(message);
 overlay.replaceChildren();
 $("assist-targets").replaceChildren();
 $("assist-mode").textContent = "Enable Assisted mode";
 $("assist-mode").setAttribute("aria-pressed","false");
 api("/session",{enabled:false}).catch(() => {});
 rover.quiet(message);
}
window.LookoutAssist = Object.freeze({
 get active() { return active; },
 cancel,
 release,
 motionLabel() {
  const c = this.command(performance.now());
  if (!c) return "Assisted waiting";
  if (c.base > 0) return "Driving forward";
  if (c.base < 0) return "Reversing";
  return Math.abs(c.angle-telemetry().heading)>2.5 ? "Turning" : "Aligned";
 },
 command(now) {
  if (!active) return undefined;
  if (!permitted || !commandValue) return null;
  if (now-commandAt > 220 || now-lastTick > 300) {
   cancel("Local control expired. Confirm a new command."); return null;
  }
  if (visionCommand && (!observation || !observation.progress || now-observationAt>650 ||
      !observation.tracks.some(t=>t.id===selected && t.fresh))) {
   cancel("Target/video freshness lost. Select and confirm again."); return null;
  }
  const s = telemetry(), c = commandValue;
  if (!s.enabled || !s.ready || !s.armed || !s.face_fresh || s.stopped || s.fault || s.hidden || s.age_ms > 650 || s.version !== 2) {
   cancel("Rover safety gate blocked. Confirm again after recovery."); return null;
  }
  if (![c.angle,c.base,c.rate].every(Number.isFinite) || Math.abs(c.angle)>50 || Math.abs(c.base)>.22 || c.rate!==0) return null;
  if (c.base>0 && (s.distance===null || s.distance<30)) {
   cancel("Front range blocked movement."); return null;
  }
  return c;
 },
 hear(text) {
  const wake = /^\s*(?:(?:hey|okay|ok|please)[\s,]+)?rover\b[\s,.:;!?-]*/i;
  const addressed = wake.test(text);
  if (!active || (!listenOnce && !addressed)) return;
  listenOnce = false;
  $("assist-listen").textContent = "Use next spoken phrase";
  const phrase = text.replace(wake,"").trim();
  const range = /^verify sensor target at (\d{2,3}) (?:centimeters|centimetres|cm) and clear path[.!]?$/i.exec(phrase);
  if (range) {
   if ($("assist-range-panel").hidden) { status("Align with the selected target before verifying range."); return; }
   $("assist-range").value = range[1];
   $("assist-range-check").checked = true;
   $("assist-range-confirm").click();
   return;
  }
  if (/^(?:confirm|yes|yes proceed|proceed)$/i.test(phrase)) { void confirm(); return; }
  if (/^(?:cancel|stop|halt|freeze)$/i.test(phrase)) { rover.stop("Assisted voice Stop"); return; }
  if (/^(?:manual|manual mode|return to manual)$/i.test(phrase)) { release(); return; }
  $("assist-text").value = phrase;
  void understand();
 }
});
window.addEventListener("lookout-stop", event => cancel(event.detail || "Stop"));
document.addEventListener("visibilitychange", () => { if (document.hidden && active) cancel("Browser tab inactive"); });
window.addEventListener("pagehide", () => { if (active) rover.quiet("Console closed"); });
$("assist-import").addEventListener("click", () => {
 try {
  const url = new URL($("assist-import-link").value.trim());
  const pairing = window.LookoutPhoneVideo.fromBookmark(url.hash);
  if (!pairing) throw new Error("Invalid phone pairing link");
  rover.stop("Importing existing phone pairing");
  localStorage.setItem("lookout-rover.phone-pairing.v1", JSON.stringify(pairing));
  location.reload();
 } catch(error) { status("Paste the full saved phone link copied from Phone camera setup."); }
});
$("assist-mode").addEventListener("click", async () => {
 if (active) { release(); return; }
 if (busyAction) return;
 busyAction = true; claiming = true; active = true;
 clearMotion("Connecting Assisted mode...");
 const mine = revision;
 $("assist-mode").textContent = "Connecting Assisted mode...";
 $("assist-mode").setAttribute("aria-pressed","true");
 rover.quiet("Assisted mode requested");
 try {
  await api("/session",{enabled:true});
  if (!active || mine!==revision) { api("/session",{enabled:false}).catch(()=>{}); return; }
  clearMotion("Assisted mode ready. Select a visible target or enter a command.");
  selected = null; observation = null;
  $("assist-direction").checked = false;
  $("assist-mode").textContent = "Assisted mode on";
  $("assist-mode").setAttribute("aria-pressed","true");
  rover.quiet("Assisted mode selected");
 } catch(error) { $("assist-mode").textContent="Assisted mode blocked";status(error.message); }
 finally { busyAction = false; claiming = false; }
});
$("assist-manual").addEventListener("click", () => release());
$("assist-cancel").addEventListener("click", () => rover.stop("Assisted cancel"));
$("assist-listen").addEventListener("click", () => {
 listenOnce = active && !listenOnce;
 $("assist-listen").textContent = listenOnce ? "Waiting for your next phrase…" : "Use next spoken phrase";
});
$("assist-send").addEventListener("click", () => void understand());
$("assist-text").addEventListener("keydown", event => { if (event.key==="Enter") { event.preventDefault(); void understand(); } });
$("assist-confirm").addEventListener("click", () => void confirm());

async function understand() {
 if (!active) { status("Enable Assisted mode first."); return; }
 if (thinking || busyAction) { status("Wait for the current request, or press Stop."); return; }
 const text = $("assist-text").value.trim();
 if (!text) return;
 rover.quiet("Interpreting a new request");
 clearMotion("Understanding request…");
 const mine = revision; thinking = true; $("assist-send").disabled = true;
 try {
  const result = await api("/interpret",{text},11000);
  if (!active || mine!==revision) return;
  if (result.intent.action==="stop") { rover.stop("Interpreted Stop"); return; }
  proposal = result.proposal || null;
  if (!proposal) { status(result.message || "Please clarify your request."); return; }
  const intent = result.intent;
  const selectedTrack = observation?.tracks.find(t => t.id === intent.target_id);
  const summary = intent.action === "approach" ? "Approach " + (selectedTrack?.label || "target") + " (" + intent.target_id + ")" :
   intent.action === "drive" ? "Drive " + intent.direction + " at " + intent.speed + " speed for " + (intent.duration_ms/1000) + " seconds" :
   "Turn " + intent.direction + " " + intent.angle_deg + " degrees";
  $("assist-proposal").textContent = "Understood: " + summary;
  $("assist-confirm").disabled = false;drawTargets();
  status("Review the target and action. Confirm to execute; Stop cancels.");
 } catch(error) { if (mine===revision) status(error.message); }
 finally { thinking = false; $("assist-send").disabled = false; }
}
async function confirm() {
 if (!active || !proposal || busyAction || thinking) return;
 if (!$("assist-direction").checked) { status("Verify the camera/turn direction with wheels lifted first."); return; }
 busyAction = true;
 const mine=revision, current=proposal;
 try {
  await api("/confirm",{proposal_id:current.id,telemetry:telemetry(),polarity:Number($("assist-polarity").value)});
  if (!active || mine!==revision) { api("/cancel",{}).catch(()=>{}); return; }
  permitted=true; heldReason="";
  if (current.intent.action==="approach") selected=current.intent.target_id;
  rover.accepted(current.intent.action==="approach" ? "approach" : current.intent.direction);
  proposal=null; $("assist-confirm").disabled=true;
  drawTargets();status("Command confirmed. Monitoring local feedback.");
 } catch(error) { if (mine===revision) status(error.message); }
 finally { busyAction=false; }
}
$("assist-range-confirm").addEventListener("click", async () => {
 if (!active || busyAction) return;
 if (!$("assist-range-check").checked) { status("Verify sensor/target association and clear floor first."); return; }
 busyAction=true; const mine=revision;
 try {
  await api("/range",{measured_cm:Number($("assist-range").value),telemetry:telemetry()});
  if (mine!==revision) { api("/cancel",{}).catch(()=>{}); return; }
  $("assist-range-panel").hidden=true;
  status("Approaching the range-validated target.");
 } catch(error) { if (mine===revision) status(error.message); }
 finally { busyAction=false; }
});
async function select(id) {
 if (!active || busyAction) return;
 busyAction=true; rover.quiet("Target selection");clearMotion("Selecting target…");
 const mine=revision;
 try {
  await api("/select",{target_id:id});
  if (mine!==revision || !active) return;
  selected=id;status("Selected " + id + ". Ask to approach this target.");
  drawTargets();
 } catch(error) { if (mine===revision) status(error.message); }
 finally { busyAction=false; }
}
function drawTargets() {
 overlay.replaceChildren();$("assist-targets").replaceChildren();
 if (!active || !observation || performance.now()-observationAt>650) return;
 const indicated=proposal?.intent.target_id || selected;
 const parent=overlay.parentElement, width=parent.clientWidth, height=parent.clientHeight;
 const scale=Math.min(width/observation.width,height/observation.height);
 const w=observation.width*scale,h=observation.height*scale;
 for (const track of observation.tracks) {
  if (!track.fresh) continue;
  const label=track.label+" "+track.id+" · "+Math.round(track.confidence*100)+"%";
  const button=document.createElement("button");button.type="button";button.className="assist-box";
  button.setAttribute("aria-label","Select "+label);button.setAttribute("aria-pressed",String(indicated===track.id));
  button.style.left=((width-w)/2+track.box[0]*w)+"px";
  button.style.top=((height-h)/2+track.box[1]*h)+"px";
  button.style.width=((track.box[2]-track.box[0])*w)+"px";
  button.style.height=((track.box[3]-track.box[1])*h)+"px";
  const span=document.createElement("span");span.textContent=label;button.appendChild(span);
  button.addEventListener("click",()=>void select(track.id));overlay.appendChild(button);
  const item=document.createElement("button");item.type="button";item.textContent=label;
  item.setAttribute("aria-pressed",String(indicated===track.id));item.addEventListener("click",()=>void select(track.id));
  $("assist-targets").appendChild(item);
 }
}
new ResizeObserver(drawTargets).observe(overlay.parentElement);

const videoFrame = $("rover-video");
window.addEventListener("message", event => {
 if (!framePending || event.source!==videoFrame.contentWindow || event.origin!=="https://vdo.ninja") return;
 const value=event.data?.action==="image-frame-capture" ? event.data.value : event.data;
 if (!value || value.cib!==framePending.id || (value.streamID && value.streamID!==framePending.stream)) return;
 const image=value.imageData || value.frame;
 if (!(image instanceof Blob) && !(typeof image==="string" && image.startsWith("data:image/"))) return;
 framePending.resolve(image);
});
async function capture() {
 if (!active || claiming || frameBusy || document.hidden) return;
 let stream;
 try { stream=new URL(videoFrame.src).searchParams.get("view"); } catch (_) { return; }
 if (!stream || videoFrame.hidden) return;
 if (lastStream && stream!==lastStream) { cancel("Phone pairing changed. Select a target again.");selected=null; }
 lastStream=stream;frameBusy=true;
 const started=performance.now(),mine=revision,id=crypto.randomUUID();
 let timer;
 try {
  const image=await new Promise((resolve,reject)=>{
   framePending={id,stream,resolve};
   timer=setTimeout(()=>reject(new Error("Phone frame unavailable; keep the sender open.")),900);
   videoFrame.contentWindow.postMessage({getVideoFrame:true,streamID:stream,cib:id},"https://vdo.ninja");
  });
  clearTimeout(timer);framePending=null;
  const blob=image instanceof Blob ? image : await (await fetch(image)).blob();
  if (blob.size>8_000_000) throw new Error("Phone frame too large");
  const bitmap=await createImageBitmap(blob),c=document.createElement("canvas");
  const portrait=bitmap.height>bitmap.width;
  const sourceW=portrait?bitmap.height:bitmap.width,sourceH=portrait?bitmap.width:bitmap.height;
  c.width=Math.min(sourceW,640);c.height=Math.round(sourceH*c.width/sourceW);
  const ctx=c.getContext("2d");ctx.scale(c.width/sourceW,c.height/sourceH);
  if (portrait) { ctx.translate(0,bitmap.width);ctx.rotate(-Math.PI/2); }
  ctx.drawImage(bitmap,0,0);bitmap.close();
  if (performance.now()-started>650) throw new Error("Phone frame arrived too late");
  const result=await api("/frame",{image:c.toDataURL("image/jpeg",.72),frame_id:id});
  if (!active || mine!==revision) return;
  if (performance.now()-started>650 || result.frame_id!==id) throw new Error("Vision result arrived too late");
  observation=result;observationAt=started;
  drawTargets();
  if (!result.progress) { commandValue=null;status("Phone picture is unchanged; approach is paused."); }
 } catch(error) {
  observation=null;commandValue=null;drawTargets();
  if (active && commandAt && performance.now()-observationAt>650) cancel("Phone video unavailable; command cancelled.");
  if (active && !thinking && !proposal && !busyAction) status(error.message);
 } finally { clearTimeout(timer);framePending=null;frameBusy=false; }
}
async function tick() {
 if (!active || claiming || tickBusy || document.hidden) return;
 tickBusy=true;const mine=revision,started=performance.now();
 try {
  const result=await api("/tick",{telemetry:telemetry()});
  if (!active || mine!==revision) return;
  if (performance.now()-started>200) {
   if (permitted) cancel("Local response too slow. Confirm a new command.");
   else status("Local response too slow; movement withheld.");
   commandValue=null;return;
  }
  if (!permitted && result.command) {
   commandValue=null;api("/cancel",{}).catch(()=>{});return;
  }
  commandValue=result.command;visionCommand=["aligning","approaching"].includes(result.state);
  commandAt=performance.now();lastTick=commandAt;
  if (!thinking && !proposal && !busyAction) status(!permitted && ["stopped","paused"].includes(result.state) && heldReason ? heldReason : result.message);
  $("assist-range-panel").hidden=result.state!=="awaiting_range";
  if (result.state!=="awaiting_range") $("assist-range-check").checked=false;
  if (observation && performance.now()-observationAt>650) drawTargets();
 } catch(error) {
  commandValue=null;
  if (active && permitted) cancel("Local control unavailable. Confirm a new command.");
  else if (active && !thinking) status(error.message);
 }
 finally { tickBusy=false; }
}
setInterval(()=>void capture(),220);
setInterval(()=>void tick(),100);
api("/health").then(result=>{
 $("assist-health").textContent=(result.vision_ready?"Vision model ready. ":"Run python -m companion.setup_models. ")+
  (result.aws_configured && result.region_configured?"AWS model configured; access checked on first request.":"Run python -m companion.configure to set AWS profile, region and model.");
 status("Assisted mode off. Manual control remains available.");
}).catch(error=>status(error.message));
})();
