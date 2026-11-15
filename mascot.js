/*! Hoot — the Lookout Rover mascot. No dependencies.
 *
 * Add to index.html (2 lines):
 *   <div id="mascot"></div>          ← where Hoot should appear
 *   <script src="mascot.js"></script> ← just before </body>
 *
 * Hoot reads the page's #state, #target, #heading, #distance and #heard
 * elements, so the steering/safety code is never touched.
 *   - Eyes  = where the driver is looking (#target)
 *   - Head  = where the rover is actually facing (#heading)
 *   - Mood  = the rover/firmware state (#state)
 */
(() => {
"use strict";

const CONFIG = {
  name: "Hoot",
  maxAngle: 55,        // matches MAX_YAW / MAX_TARGET
  sound: false,        // start muted; press M or the voice button to enable
  audioBase: null,     // e.g. "voice" → plays voice/<lineId>.mp3 made with Amazon Polly
  fps: 30,             // capped so face tracking keeps the CPU
  dozeAfter: 30000,    // ms of no driving before Hoot dozes off
};

// Spoken lines. They never contain the voice commands (stop, halt, brake, freeze,
// resume, center, forward, reverse, back, left, right, go, turn, ahead, straight, roll), so the
// mic can't mistake Hoot for the driver. Captions may show command words.
const LINES = {
  hello:    {say: "Hi, I'm Hoot! I'll keep watch."},
  wake:     {say: "Camera on. Let me see you."},
  focus:    {say: "Look at me and hold still."},
  ready:    {say: "Locked in. Move your head, and I'll follow."},
  search:   {say: "Hey, where are you? I can't see your face."},
  obstacle: {say: "Whoa! Something's in my way!"},
  noecho:   {say: "Hmm. My distance sensor sees nothing."},
  lost:     {say: "I lost your signal, so I'm holding still."},
  unplugged:{say: "Lost the link! The rover froze safely.", caption: "Lost the link! The rover froze safely."},
  stuck:    {say: "Ugh, I'm stuck. My wheels won't budge."},
  power:    {say: "My wheels are out of power."},
  hold:     {say: "Holding still. I'm listening.", caption: "Holding still. Say “resume” when you're ready."},
  error:    {say: "Uh oh. I can't see through the camera."},
  sleep:    {say: null, caption: "Zzz… connect the Red Board to wake me up."},
  hi:       {say: "Oh, hi! I see you!"},
  hiFocus:  {say: "Oh, hi! I see you! Now look at me and hold still."},
  tickle1:  {say: "Hee hee, that tickles!"},
  tickle2:  {say: "Hoo hoo! Hello there!"},
  tickle3:  {say: "Watch this!"},
  tickle4:  {say: "Hey, I'm on lookout duty!"},
  yawn:     {say: "Yaaawn. Wake me up when you need me.", caption: "*yawn* …wake me up when you need me."},
  awake:    {say: "I'm up! I'm up!"},
};
const FACE_MOODS = new Set(["focus", "happy", "turning", "driving", "reversing", "startled", "confused", "holding"]);

const BASE = {lidTop: .1, lidAngle: 0, lidBottom: 0, asym: 0, pupil: 1, eye: 1, brow: 0,
  browLift: 0, bob: 3, shake: 0, wing: 0, blush: 0, tilt: 0, tuft: 0, wander: 0, wheel: 0, puff: 0};

const MOODS = {
  sleep:    {p: {lidTop: 1, bob: 1.5, tuft: -6}, glow: "#5b6aa0", iris: "#a8894f", fx: "zzz", label: "Sleeping", line: "sleep"},
  idle:     {p: {wander: .35}, glow: "#ffb547", iris: "#ffb547", label: "On watch"},
  waking:   {p: {lidTop: .35, wander: .2}, glow: "#ffcf6e", iris: "#ffc65a", label: "Waking up", line: "wake", chirp: "hoo"},
  search:   {p: {wander: 1, lidTop: .12, brow: -8, tilt: 7, tuft: 4}, glow: "#7fb8ff", iris: "#ffc65a", fx: "question", label: "Looking for you", line: "search", chirp: "worry"},
  focus:    {p: {pupil: 1.2, lidTop: .02, tuft: 6}, glow: "#ffd27a", iris: "#ffd27a", fx: "ring", label: "Calibrating", line: "focus"},
  happy:    {p: {lidBottom: .55, lidTop: 0, blush: 1, bob: 4, wing: .25, tuft: 4}, glow: "#ffc857", iris: "#ffc857", fx: "sparkle", label: "Aligned"},
  turning:  {p: {lidTop: .08, tuft: 2}, glow: "#ffb547", iris: "#ffb547", label: "Turning"},
  driving:  {p: {lidTop: .3, lidAngle: 10, brow: 10, wheel: 1, bob: 2}, glow: "#ffa53a", iris: "#ffa53a", fx: "speed", label: "Driving"},
  reversing:{p: {lidTop: .15, lidAngle: -6, brow: -8, wheel: -.7, bob: 2}, glow: "#ffb547", iris: "#ffb547", fx: "beep", label: "Reversing"},
  startled: {p: {eye: 1.12, pupil: .55, lidTop: 0, brow: -14, browLift: 8, shake: 1.6, wing: 1, puff: .05, tuft: 12}, glow: "#ff6b4a", iris: "#ff9a3d", fx: "bang", label: "Obstacle!", line: "obstacle", chirp: "alert", repeat: 6000},
  confused: {p: {tilt: 12, lidTop: .22, asym: .35, brow: -6}, glow: "#b39cff", iris: "#ffc65a", fx: "question", label: "No echo", line: "noecho", chirp: "worry"},
  worried:  {p: {lidAngle: -14, brow: -16, lidTop: .2, pupil: .85, bob: 1, tuft: -4}, glow: "#6fa8ff", iris: "#9cc4ff", fx: "signal", label: "Signal lost", line: "lost", chirp: "worry"},
  stuck:    {p: {lidTop: .45, lidAngle: 16, brow: 16, shake: 2.6, wheel: .12}, glow: "#ff7a59", iris: "#ff9a3d", fx: "sweat", label: "Stuck", line: "stuck", chirp: "sad"},
  power:    {p: {lidTop: .6, lidAngle: -6, brow: -6, bob: .6, tuft: -8}, glow: "#7d86a8", iris: "#c9a35e", fx: "battery", label: "Power off", line: "power", chirp: "sad"},
  holding:  {p: {lidTop: .04, pupil: 1.2, tuft: 10}, glow: "#9fe3b0", iris: "#ffd27a", fx: "ear", label: "Holding", line: "hold", chirp: "ack"},
  error:    {p: {lidTop: .3, asym: .45, tilt: -8, brow: -10}, glow: "#ff8f8f", iris: "#ffb547", fx: "question", label: "Camera problem", line: "error", chirp: "sad"},
};
const ACTIVE = new Set(["happy", "turning", "driving", "reversing", "startled", "confused", "stuck", "worried", "holding", "focus"]);

// Page/firmware state text → mood. Matches index.html render() and the
// XRP firmware reasons (OBSTACLE, NO_ECHO, COMMAND_LOST, WHEELS_STALLED, POWER_OFF).
function moodFor(text) {
  const s = (text || "").toLowerCase();
  if (!s || s.includes("usb disconnected") || s.includes("connect the red board")) return "sleep";
  if (s.includes("steering off")) return "idle";
  if (s.includes("stopped") || s.includes("page inactive")) return "holding";
  if (s.includes("camera unavailable") || s.includes("camera permission") || s.includes("camera disconnected") ||
      s.includes("model unavailable") || s.includes("tracking restarting")) return "error";
  if (s.includes("starting camera")) return "waking";
  if (s.includes("face out of frame")) return "search";
  if (s === "centering" || s.includes("look straight") || s.includes("heading zero") || s.includes("waiting for rover")) return "focus";
  if (s.includes("no heading reply") || s.includes("no steering updates") || s.includes("command_lost")) return "worried";
  if (s.includes("power off") || s.includes("power_off")) return "power";
  if (s.includes("wheels not moving") || s.includes("stalled")) return "stuck";
  if (s.includes("obstacle")) return "startled";
  if (s.includes("no echo") || s.includes("no_echo")) return "confused";
  if (s.includes("driving forward") || s === "driving") return "driving";
  if (s.includes("reversing")) return "reversing";
  if (s.includes("aligned")) return "happy";
  if (s.includes("turning")) return "turning";
  return "idle";
}

const parseDeg = t => {
  if (!t || !/\d/.test(t)) return null;
  const n = parseFloat(t);
  return /right/i.test(t) ? -n : n;      // page shows "12° left" for +12
};
const parseDist = t => {
  if (!t || t === "—") return undefined;
  if (/no echo/i.test(t)) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mixHex = (a, b, t) => {
  const A = hexToRgb(a), B = hexToRgb(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

const CSS = `
.lk-card{--lk-glow:#ffb547;position:relative;border-radius:1rem;padding:.55rem .75rem .65rem;
  background:radial-gradient(120% 85% at 50% 42%,color-mix(in srgb,var(--lk-glow) 20%,#0d1424) 0%,#0a101b 72%);
  border:1px solid #2a3a52;color:#e8eefc;font:500 .85rem Inter,system-ui,sans-serif;overflow:hidden;
  transition:background .8s;user-select:none;margin-bottom:.8rem}
.lk-say{min-height:2.9em;display:flex;align-items:flex-end;justify-content:center}
.lk-bubble{position:relative;max-width:94%;background:#f7f1e3;color:#1a2133;border-radius:.9rem;
  padding:.42rem .75rem;font-weight:650;font-size:.92rem;line-height:1.25;text-align:center;
  box-shadow:0 6px 18px #0007;opacity:0;transform:translateY(4px) scale(.97);transition:opacity .25s,transform .25s}
.lk-bubble.show{opacity:1;transform:none}
.lk-bubble::after{content:"";position:absolute;left:50%;bottom:-7px;margin-left:-7px;border:7px solid transparent;
  border-bottom:0;border-top-color:#f7f1e3}
.lk-stage{position:relative;width:100%;max-width:330px;margin:0 auto;aspect-ratio:320/340;cursor:pointer;touch-action:manipulation}
.lk-svg{width:100%;height:100%;display:block;overflow:visible}
.lk-bar{display:flex;align-items:center;gap:.5rem;margin-top:.25rem}
.lk-mood{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.lk-name{font-weight:800;letter-spacing:.02em;padding:.15rem .55rem;border-radius:999px;
  background:var(--lk-glow);color:#141a28;transition:background .8s}
.lk-mood{font-weight:650;color:#e8eefc}
.lk-grow{flex:1}
.lk-meter{display:flex;align-items:center;gap:.3rem}
.lk-meter i{display:block;width:3.2rem;height:.42rem;border-radius:9px;background:#26324a;overflow:hidden}
.lk-meter i b{display:block;height:100%;width:0;border-radius:9px;background:#5fd38d;transition:width .2s,background .3s}
.lk-snd{min-height:auto!important;padding:.2rem .5rem!important;font-size:.78rem!important;border-radius:999px!important;
  background:#1f2a40!important;border:1px solid #3a4a68!important;color:#e8eefc!important;cursor:pointer}
.lk-read{margin-top:.3rem;font-size:.76rem;color:#9fb0cf;display:flex;gap:.9rem;justify-content:center;font-variant-numeric:tabular-nums}
.lk-read span b{color:#e8eefc;font-weight:650}
.lk-fx>g{display:none}
.lk-card[data-fx="zzz"] .lk-fx-zzz,.lk-card[data-fx="bang"] .lk-fx-bang,.lk-card[data-fx="question"] .lk-fx-question,
.lk-card[data-fx="sweat"] .lk-fx-sweat,.lk-card[data-fx="speed"] .lk-fx-speed,.lk-card[data-fx="battery"] .lk-fx-battery,
.lk-card[data-fx="signal"] .lk-fx-signal,.lk-card[data-fx="ring"] .lk-fx-ring,.lk-card[data-fx="ear"] .lk-fx-ear,
.lk-card[data-fx="sparkle"] .lk-fx-sparkle,.lk-card[data-fx="beep"] .lk-fx-beep{display:inline}
.lk-fx *{transform-box:fill-box}
@media (prefers-reduced-motion:reduce){.lk-sheen{display:none}}
.lk-fx-zzz text{animation:lk-float 2.4s infinite ease-out;opacity:0;transform-origin:center}
.lk-fx-zzz text:nth-child(2){animation-delay:.8s}.lk-fx-zzz text:nth-child(3){animation-delay:1.6s}
@keyframes lk-float{0%{opacity:0;transform:translate(0,6px) scale(.7)}25%{opacity:1}100%{opacity:0;transform:translate(16px,-34px) scale(1.15)}}
.lk-fx-bang,.lk-fx-question,.lk-fx-battery,.lk-fx-signal,.lk-fx-ear{transform-origin:center}
.lk-card[data-fx="bang"] .lk-fx-bang,.lk-card[data-fx="question"] .lk-fx-question{animation:lk-pop .45s cubic-bezier(.3,1.6,.5,1)}
@keyframes lk-pop{0%{transform:scale(.1)}100%{transform:scale(1)}}
.lk-fx-question text{animation:lk-wob 1.6s infinite ease-in-out;transform-origin:center}
@keyframes lk-wob{50%{transform:rotate(12deg) translateY(-3px)}}
.lk-fx-sweat path{animation:lk-drip 1.2s infinite ease-in}
@keyframes lk-drip{0%{transform:translateY(-4px);opacity:0}30%{opacity:1}100%{transform:translateY(16px);opacity:0}}
.lk-fx-speed line{stroke-dasharray:14 22;animation:lk-dash .5s linear infinite}
@keyframes lk-dash{to{stroke-dashoffset:36}}
.lk-fx-ring circle{stroke-dasharray:10 14;animation:lk-spin 3s linear infinite;transform-origin:center}
@keyframes lk-spin{to{transform:rotate(360deg)}}
.lk-fx-battery rect.lk-lvl{animation:lk-low 1s steps(2) infinite}
@keyframes lk-low{50%{opacity:.15}}
.lk-fx-signal path{animation:lk-sig 1.4s infinite}
.lk-fx-signal path:nth-child(2){animation-delay:.2s}.lk-fx-signal path:nth-child(3){animation-delay:.4s}
@keyframes lk-sig{0%,100%{opacity:.25}50%{opacity:1}}
.lk-fx-ear path,.lk-fx-beep text{animation:lk-sig 1s infinite}
.lk-fx-sparkle text{animation:lk-twinkle 1.8s infinite ease-in-out;transform-origin:center}
.lk-fx-sparkle text:nth-child(2){animation-delay:.6s}.lk-fx-sparkle text:nth-child(3){animation-delay:1.2s}
@keyframes lk-twinkle{0%,100%{opacity:0;transform:scale(.4)}50%{opacity:1;transform:scale(1)}}
.lk-led{animation:lk-led 1.8s infinite}
@keyframes lk-led{0%,100%{opacity:1}50%{opacity:.35}}
.lk-card.lk-big{height:100vh;box-sizing:border-box;border-radius:0;border:0;margin:0;display:flex;flex-direction:column;justify-content:center}
.lk-card.lk-big .lk-stage{max-width:min(78vh,92vw)}
.lk-card.lk-big .lk-bubble{font-size:clamp(1rem,3.4vh,2rem)}
.lk-card.lk-big .lk-say{min-height:4.2em}
.lk-card.lk-big .lk-bar{justify-content:center;font-size:clamp(.9rem,2.2vh,1.4rem)}
.lk-card.lk-big .lk-grow{display:none}
.lk-card.lk-big .lk-read{font-size:clamp(.8rem,1.8vh,1.1rem)}
`;

// Eye centres and radius (viewBox 0 0 320 340).
const L = {x: 116, y: 150}, R = {x: 204, y: 150}, ER = 36;
const DISC = "#cdb8f4";          // lilac face discs (eyelids use the same colour)
const GOLD = "#ecc66a";          // thin golden outline

const eyeSVG = (side, c) => `
  <g class="lk-eye${side}">
    <g clip-path="url(#lkClip${side})">
      <circle cx="${c.x}" cy="${c.y}" r="${ER}" fill="#1b1436"/>
      <g class="lk-look${side}">
        <circle cx="${c.x}" cy="${c.y}" r="31" fill="url(#lkIris)"/>
        <circle class="lk-pup${side}" cx="${c.x}" cy="${c.y}" r="13" fill="#120d06"/>
        <circle cx="${c.x - 9}" cy="${c.y - 10}" r="5.5" fill="#fff" opacity=".92"/>
        <circle cx="${c.x + 8}" cy="${c.y + 8}" r="2.4" fill="#fff" opacity=".55"/>
      </g>
      <rect class="lk-lid${side}" x="${c.x - 64}" y="${c.y - ER - 90}" width="128" height="90" fill="${DISC}"/>
      <ellipse class="lk-low${side}" cx="${c.x}" cy="${c.y + 82}" rx="52" ry="44" fill="${DISC}"/>
    </g>
    <circle cx="${c.x}" cy="${c.y}" r="${ER}" fill="none" stroke="${GOLD}" stroke-width="2.2"/>
    <path class="lk-shut" d="M${c.x - 22} ${c.y + 2} q22 14 44 0" fill="none" stroke="#4b2a7a" stroke-width="5" stroke-linecap="round" opacity="0"/>
  </g>`;

const wheelSVG = (x) => `
  <g>
    <circle cx="${x}" cy="312" r="21" fill="#1d1638"/><circle cx="${x}" cy="312" r="20" fill="none" stroke="${GOLD}" stroke-width="1.6"/>
    <g class="lk-spokes" data-x="${x}">
      <line x1="${x}" y1="296" x2="${x}" y2="328" stroke="#cdb8f4" stroke-width="3" stroke-linecap="round"/>
      <line x1="${x - 16}" y1="312" x2="${x + 16}" y2="312" stroke="#cdb8f4" stroke-width="3" stroke-linecap="round"/>
    </g>
    <circle cx="${x}" cy="312" r="5" fill="${GOLD}"/>
  </g>`;

const FEATHER = {o: "#ff8a3d", c: "#d7263d", p: "#ff7eb6"};   // orange, crimson, pink tips
const chevrons = () => {
  const rows = [[236, [[136, "o"], [160, "c"], [184, "o"]]],
                [256, [[124, "p"], [148, "o"], [172, "o"], [196, "p"]]],
                [276, [[136, "c"], [160, "p"], [184, "c"]]]];
  let out = "";
  for (const [y, feathers] of rows) {
    for (const [x, k] of feathers) {
      out += `<path d="M${x - 8} ${y}q8 8 16 0" fill="none" stroke="${FEATHER[k]}" stroke-width="3" stroke-linecap="round"/>`;
    }
  }
  return out;
};

const SVG = `
<svg class="lk-svg" viewBox="0 0 320 340" role="img" aria-label="${CONFIG.name} the Lookout owl">
  <defs>
    <radialGradient id="lkIris" cx="50%" cy="45%" r="55%">
      <stop class="lk-irisA" offset="0%" stop-color="#ffe39a"/>
      <stop class="lk-irisB" offset="70%" stop-color="#ffb547"/>
      <stop class="lk-irisC" offset="100%" stop-color="#c46a12"/>
    </radialGradient>
    <radialGradient id="lkHalo" cx="50%" cy="50%" r="50%">
      <stop class="lk-haloA" offset="0%" stop-color="#ffb547" stop-opacity=".55"/>
      <stop class="lk-haloB" offset="100%" stop-color="#ffb547" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="lkBody" x1="0" y1="0" x2=".35" y2="1">
      <stop offset="0%" stop-color="#7fdcf0"/><stop offset="38%" stop-color="#2f9ed3"/>
      <stop offset="78%" stop-color="#2463aa"/><stop offset="100%" stop-color="#4b3f9e"/>
    </linearGradient>
    <linearGradient id="lkSheen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e9fdff" stop-opacity="0"/>
      <stop offset=".42" stop-color="#e9fdff" stop-opacity="0"/>
      <stop offset=".5" stop-color="#e9fdff" stop-opacity=".5"/>
      <stop offset=".58" stop-color="#e9fdff" stop-opacity="0"/>
      <stop offset="1" stop-color="#e9fdff" stop-opacity="0"/>
      <animateTransform attributeName="gradientTransform" type="translate" values="-1 -1; 1 1; 1 1" keyTimes="0; .4; 1" dur="5.5s" repeatCount="indefinite"/>
    </linearGradient>
    <linearGradient id="lkBelly" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff4c4"/><stop offset="100%" stop-color="#ffd98c"/>
    </linearGradient>
    <linearGradient id="lkWing" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#cdb8f4"/><stop offset="45%" stop-color="#e2557a"/><stop offset="100%" stop-color="#d7263d"/>
    </linearGradient>
    <linearGradient id="lkTuft" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffb347"/><stop offset="100%" stop-color="#e2452f"/>
    </linearGradient>
    <clipPath id="lkWingClipL"><ellipse cx="58" cy="232" rx="25" ry="58"/></clipPath>
    <clipPath id="lkWingClipR"><ellipse cx="262" cy="232" rx="25" ry="58"/></clipPath>
    <clipPath id="lkClipL"><circle cx="${L.x}" cy="${L.y}" r="${ER}"/></clipPath>
    <clipPath id="lkClipR"><circle cx="${R.x}" cy="${R.y}" r="${ER}"/></clipPath>
  </defs>
  <ellipse cx="160" cy="333" rx="96" ry="8" fill="#000" opacity=".35"/>
  <g class="lk-all">
    <g class="lk-wheels">${wheelSVG(108)}${wheelSVG(212)}</g>
    <g class="lk-wingL"><ellipse cx="58" cy="232" rx="25" ry="58" fill="url(#lkWing)"/>
      <g clip-path="url(#lkWingClipL)" fill="#ff7eb6"><circle cx="44" cy="290" r="11"/><circle cx="58" cy="294" r="11"/><circle cx="72" cy="290" r="11"/></g>
      <path d="M50 200q8 30 0 62M64 196q8 34 2 70" fill="none" stroke="#fbe3ff" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>
      <ellipse cx="58" cy="232" rx="25" ry="58" fill="none" stroke="${GOLD}" stroke-width="1.6"/></g>
    <g class="lk-wingR"><ellipse cx="262" cy="232" rx="25" ry="58" fill="url(#lkWing)"/>
      <g clip-path="url(#lkWingClipR)" fill="#ff7eb6"><circle cx="248" cy="290" r="11"/><circle cx="262" cy="294" r="11"/><circle cx="276" cy="290" r="11"/></g>
      <path d="M270 200q-8 30 0 62M256 196q-8 34-2 70" fill="none" stroke="#fbe3ff" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>
      <ellipse cx="262" cy="232" rx="25" ry="58" fill="none" stroke="${GOLD}" stroke-width="1.6"/></g>
    <g class="lk-tuftL"><path d="M66 132 L72 50 L130 104 Z" fill="url(#lkTuft)"/><path d="M69 84 L72 50 L95 74 Z" fill="#ff7eb6"/><path d="M66 132 L72 50 L130 104 Z" fill="none" stroke="${GOLD}" stroke-width="1.6" stroke-linejoin="round"/>
      <circle class="lk-led lk-ledL" cx="73" cy="54" r="7" fill="#ffb547"/></g>
    <g class="lk-tuftR"><path d="M254 132 L248 50 L190 104 Z" fill="url(#lkTuft)"/><path d="M251 84 L248 50 L225 74 Z" fill="#ff7eb6"/><path d="M254 132 L248 50 L190 104 Z" fill="none" stroke="${GOLD}" stroke-width="1.6" stroke-linejoin="round"/>
      <circle class="lk-led lk-ledR" cx="247" cy="54" r="7" fill="#ffb547"/></g>
    <ellipse cx="160" cy="205" rx="112" ry="116" fill="url(#lkBody)"/>
    <ellipse class="lk-sheen" cx="160" cy="205" rx="112" ry="116" fill="url(#lkSheen)"/>
    <ellipse cx="160" cy="205" rx="112" ry="116" fill="none" stroke="${GOLD}" stroke-width="2"/>
    <ellipse cx="160" cy="258" rx="66" ry="50" fill="url(#lkBelly)" stroke="${GOLD}" stroke-width="1.6"/>
    ${chevrons()}
    <g class="lk-head">
      <circle class="lk-halo" cx="160" cy="150" r="118" fill="url(#lkHalo)"/>
      <circle cx="${L.x}" cy="${L.y}" r="52.8" fill="${GOLD}"/><circle cx="${R.x}" cy="${R.y}" r="52.8" fill="${GOLD}"/>
      <circle cx="${L.x}" cy="${L.y}" r="51" fill="${DISC}"/><circle cx="${R.x}" cy="${R.y}" r="51" fill="${DISC}"/>
      ${eyeSVG("L", L)}${eyeSVG("R", R)}
      <line class="lk-browL" x1="${L.x - 30}" y1="${L.y - 52}" x2="${L.x + 26}" y2="${L.y - 48}" stroke="#5b2a86" stroke-width="7" stroke-linecap="round"/>
      <line class="lk-browR" x1="${R.x + 30}" y1="${R.y - 52}" x2="${R.x - 26}" y2="${R.y - 48}" stroke="#5b2a86" stroke-width="7" stroke-linecap="round"/>
      <ellipse class="lk-blush" cx="88" cy="200" rx="15" ry="7" fill="#ff7eb6" opacity="0"/>
      <ellipse class="lk-blush" cx="232" cy="200" rx="15" ry="7" fill="#ff7eb6" opacity="0"/>
      <path class="lk-beakLo" d="M150 189 L170 189 L160 205 Z" fill="#f6a12a" stroke="#b8862b" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M147 189 L160 171 L173 189 Z" fill="#ffd84f" stroke="#b8862b" stroke-width="1.6" stroke-linejoin="round"/>
    </g>
  </g>
  <g class="lk-fx">
    <g class="lk-fx-zzz" fill="#cdd6ff" font-weight="800" font-family="system-ui,sans-serif">
      <text x="246" y="76" font-size="22">z</text><text x="258" y="60" font-size="28">z</text><text x="272" y="42" font-size="34">Z</text></g>
    <g class="lk-fx-bang"><text x="262" y="74" font-size="58" font-weight="900" fill="#ff6b4a" stroke="#2a0e08" stroke-width="2" font-family="system-ui,sans-serif">!</text></g>
    <g class="lk-fx-question"><text x="254" y="72" font-size="48" font-weight="900" fill="#c8b6ff" stroke="#1d1538" stroke-width="2" font-family="system-ui,sans-serif">?</text></g>
    <g class="lk-fx-sweat"><path d="M262 92 q8 12 0 18 q-8 -6 0 -18Z" fill="#8fd3ff" stroke="#2c5d80" stroke-width="1.5"/></g>
    <g class="lk-fx-speed" stroke="#ffd59a" stroke-width="4" stroke-linecap="round" opacity=".8">
      <line x1="4" y1="200" x2="40" y2="200"/><line x1="0" y1="232" x2="34" y2="232"/><line x1="10" y1="264" x2="38" y2="264"/></g>
    <g class="lk-fx-beep" fill="#ffd59a" font-weight="800" font-size="16" font-family="system-ui,sans-serif">
      <text x="250" y="70">beep</text><text x="262" y="92">beep</text></g>
    <g class="lk-fx-battery"><rect x="248" y="44" width="40" height="20" rx="4" fill="none" stroke="#e7ecff" stroke-width="3"/>
      <rect x="289" y="50" width="5" height="8" rx="1.5" fill="#e7ecff"/>
      <rect class="lk-lvl" x="252" y="48" width="9" height="12" rx="2" fill="#ff5a5a"/></g>
    <g class="lk-fx-signal" fill="none" stroke="#9cc4ff" stroke-width="4" stroke-linecap="round">
      <path d="M262 78 a4 4 0 0 1 8 0"/><path d="M254 70 a14 14 0 0 1 24 0"/><path d="M246 62 a24 24 0 0 1 40 0"/>
      <line x1="248" y1="42" x2="284" y2="84" stroke="#ff7a7a"/></g>
    <g class="lk-fx-ring"><circle cx="160" cy="150" r="108" fill="none" stroke="#ffd27a" stroke-width="3" opacity=".7"/></g>
    <g class="lk-fx-ear" fill="none" stroke="#9fe3b0" stroke-width="3.5" stroke-linecap="round">
      <path d="M40 60 a22 22 0 0 0 0 30"/><path d="M28 52 a34 34 0 0 0 0 46"/>
      <path d="M280 60 a22 22 0 0 1 0 30"/><path d="M292 52 a34 34 0 0 1 0 46"/></g>
    <g class="lk-fx-sparkle" fill="#ffe08a" font-family="system-ui,sans-serif">
      <text x="40" y="96" font-size="22">✦</text><text x="262" y="84" font-size="26">✦</text><text x="276" y="170" font-size="16">✦</text></g>
  </g>
</svg>`;

class Mascot {
  constructor(host, opts = {}) {
    this.opts = {...CONFIG, ...opts};
    if (!document.getElementById("lk-style")) {
      const style = document.createElement("style");
      style.id = "lk-style";
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    host.innerHTML = `
      <div class="lk-card" data-fx="">
        <div class="lk-say"><div class="lk-bubble" aria-live="polite"></div></div>
        <div class="lk-stage" tabindex="0" role="button" aria-label="Interact with Hoot">${SVG}</div>
        <div class="lk-bar">
          <span class="lk-name">${this.opts.name}</span><span class="lk-mood">On watch</span><span class="lk-grow"></span>
          <button type="button" class="lk-snd" aria-pressed="false" aria-label="Enable Hoot voice" title="Enable Hoot voice (M)"></button>
        </div>
        <div class="lk-read"><span>You look <b class="lk-you">—</b></span><span>Rover faces <b class="lk-rov">—</b></span>
          <span class="lk-meter" title="Front distance">Front <i><b></b></i><b class="lk-dist">—</b></span></div>
      </div>`;
    this.root = host.querySelector(".lk-card");
    const q = s => this.root.querySelector(s);
    this.el = {
      all: q(".lk-all"), head: q(".lk-head"), wingL: q(".lk-wingL"), wingR: q(".lk-wingR"),
      tuftL: q(".lk-tuftL"), tuftR: q(".lk-tuftR"), eyeL: q(".lk-eyeL"), eyeR: q(".lk-eyeR"),
      lookL: q(".lk-lookL"), lookR: q(".lk-lookR"), pupL: q(".lk-pupL"), pupR: q(".lk-pupR"),
      lidL: q(".lk-lidL"), lidR: q(".lk-lidR"), lowL: q(".lk-lowL"), lowR: q(".lk-lowR"),
      browL: q(".lk-browL"), browR: q(".lk-browR"), blush: [...this.root.querySelectorAll(".lk-blush")],
      beak: q(".lk-beakLo"), spokes: [...this.root.querySelectorAll(".lk-spokes")],
      leds: [...this.root.querySelectorAll(".lk-led")], irisA: q(".lk-irisA"), irisB: q(".lk-irisB"),
      irisC: q(".lk-irisC"), haloA: q(".lk-haloA"), haloB: q(".lk-haloB"),
      bubble: q(".lk-bubble"), mood: q(".lk-mood"), dist: q(".lk-dist"), meter: q(".lk-meter i b"),
      shut: [...this.root.querySelectorAll(".lk-shut")],
      you: q(".lk-you"), rov: q(".lk-rov"), snd: q(".lk-snd"),
    };
    this.cur = {...BASE};
    this.tgt = {...BASE};
    this.glow = "#ffb547"; this.glowT = "#ffb547";
    this.iris = "#ffb547"; this.irisT = "#ffb547";
    this.mood = null; this.moodAt = 0; this.override = null;
    this.look = 0; this.lookT = null;     // driver look, -1..1 (screen units)
    this.turn = 0; this.turnT = 0;        // rover heading, -1..1
    this.distance = undefined;
    this.gaze = {x: 0, y: 0, tx: 0, ty: 0, next: 0};
    this.blinkAt = performance.now() + 1500; this.blinkUntil = 0;
    this.nodUntil = 0; this.spin = 0; this.speaking = false;
    this.lastSpoken = {}; this.lastSpeakAt = 0; this.bubbleUntil = 0; this.greeted = false; this.readySaid = false;
    this.sound = false;
    this.audioGeneration = 0;
    this.voiceAudio = null;
    this.tones = new Set();
    this.lastActive = performance.now(); this.drowsy = false; this.yawnUntil = 0;
    this.pokeAt = 0; this.pokeUntil = 0; this.pokes = 0; this.spinAt = 0; this.lastGreet = -1e9;
    this._refLook = null; this._refHead = null;
    this.channel = "BroadcastChannel" in window ? new BroadcastChannel("lookout-mascot") : null;
    this.el.snd.addEventListener("click", event => {
      event.stopPropagation();
      this.toggleSound();
    });
    this.root.querySelector(".lk-stage").addEventListener("pointerdown", () => this.poke());
    this.root.querySelector(".lk-stage").addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.poke();
      }
    });
    this.setSound(this.sound);
    this.setMood("sleep", true);
    this._frame = this._frame.bind(this);
    this._last = performance.now();
    requestAnimationFrame(this._frame);
  }

  // ---------- public API ----------
  setReason(text) {
    const mood = moodFor(text);
    // Pulling the USB cable mid-drive: say what the firmware did, then sleep.
    if (mood === "sleep" && ACTIVE.has(this.mood)) {
      this.override = {until: performance.now() + 3500};
      this.setMood("worried", false, "unplugged");
      return;
    }
    if (this.override && performance.now() < this.override.until) return;
    this.override = null;
    this.setMood(mood);
  }
  setLook(deg) {           // driver target, + = left
    this.lookT = deg == null ? null : clamp(-deg / this.opts.maxAngle, -1, 1);
    this.el.you.textContent = deg == null ? "—" : fmtDeg(deg);
    if (deg != null) {
      if (this._refLook != null && Math.abs(deg - this._refLook) > 3) this.markActive();
      if (this._refLook == null || Math.abs(deg - this._refLook) > 3) this._refLook = deg;
    }
  }
  setHeading(deg) {        // rover heading, + = left
    this.turnT = deg == null ? 0 : clamp(-deg / this.opts.maxAngle, -1, 1);
    this.el.rov.textContent = deg == null ? "—" : fmtDeg(deg);
    if (deg != null) {
      if (this._refHead != null && Math.abs(deg - this._refHead) > 3) this.markActive();
      if (this._refHead == null || Math.abs(deg - this._refHead) > 3) this._refHead = deg;
    }
  }
  // Tap/click Hoot: giggle and wiggle; every 3rd tap he spins his head like a real owl.
  poke() {
    const now = performance.now();
    if (this.markActive()) return;            // a tap wakes a dozing Hoot
    if (now < this.pokeUntil - 350) return;   // ignore rapid double taps
    this.pokes++;
    this.pokeAt = now; this.pokeUntil = now + 1100;
    if (this.stage) return;                   // stage view animates silently
    const spin = this.pokes % 3 === 0;
    if (spin) this.spinAt = now + 250;
    this.chirp(spin ? "hoo" : "giggle");
    this.tickles = (this.tickles || 0) + (spin ? 0 : 1);
    this.say(spin ? "tickle3" : ["tickle1", "tickle2", "tickle4"][(this.tickles - 1) % 3]);
  }
  // Any driving activity resets the doze timer and wakes a dozing Hoot.
  markActive() {
    this.lastActive = performance.now();
    if (!this.drowsy) return false;
    this.drowsy = false;
    const m = MOODS[this.mood] || MOODS.idle;
    this.root.dataset.fx = m.fx || "";
    this.el.mood.textContent = m.label;
    this.nodUntil = performance.now() + 420;
    this.chirp("ack");
    this.say("awake");
    return true;
  }
  doze() {
    this.drowsy = true;
    this.yawnUntil = performance.now() + 1800;
    this.root.dataset.fx = "zzz";
    this.el.mood.textContent = "Dozing…";
    this.chirp("yawn");
    this.say("yawn");
  }
  setDistance(cm) {        // number, null = no echo, undefined = unknown
    this.distance = cm;
    const m = this.el.meter;
    if (cm === undefined) { this.el.dist.textContent = "—"; m.style.width = "0"; return; }
    if (cm === null) { this.el.dist.textContent = "no echo"; m.style.width = "100%"; m.style.background = "#8a7dff"; return; }
    this.el.dist.textContent = Math.round(cm) + " cm";
    m.style.width = clamp(cm / 120, .04, 1) * 100 + "%";
    m.style.background = cm < 20 ? "#ff5a4a" : cm < 45 ? "#ffb547" : "#5fd38d";
  }
  heard(text) {            // a voice command was recognised
    if (!text) return;
    if (this.markActive()) return;
    this.nodUntil = performance.now() + 420;
    this.chirp("ack");
    this.showBubble("Heard: “" + text + "”", 1600);
  }
  say(id) {
    const line = LINES[id];
    if (!line) return;
    this.showBubble(line.caption || line.say, line.say ? 4200 : 1e9);
    if (line.say) this.speak(line.say, id);
  }
  toggleSound() {
    this.setSound(!this.sound);
    if (this.sound) {
      // Runs in the click/key gesture so the browser can unlock audio.
      this.chirp("ack");
      this.speak("Hoot voice on.", "sound-enabled");
    }
  }
  setSound(on) {
    this.sound = Boolean(on);
    this.el.snd.setAttribute("aria-pressed", String(this.sound));
    this.el.snd.setAttribute("aria-label", this.sound ? "Mute Hoot voice" : "Enable Hoot voice");
    this.el.snd.title = (this.sound ? "Mute" : "Enable") + " Hoot voice (M)";
    this.el.snd.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4 6 8H3v8h3l5 4z"/>${this.sound ? '<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>' : '<path d="m16 9 5 6m0-6-5 6"/>'}</svg>`;
    if (this.sound) {
      if (_ctx?.state === "suspended") void _ctx.resume().catch(() => {});
      if ("speechSynthesis" in window) speechSynthesis.resume();
      return;
    }
    // Invalidate async playback/error callbacks before stopping active sound.
    this.audioGeneration++;
    this.speaking = false;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    if (this.voiceAudio) {
      this.voiceAudio.onplay = this.voiceAudio.onended = this.voiceAudio.onerror = null;
      this.voiceAudio.pause();
      this.voiceAudio = null;
    }
    for (const oscillator of this.tones) {
      try { oscillator.stop(); } catch (_) {}
      oscillator.disconnect();
    }
    this.tones.clear();
  }

  // ---------- mood ----------
  setMood(name, silent = false, lineOverride = null) {
    const m = MOODS[name] || MOODS.idle;
    const now = performance.now();
    if (name === this.mood && !lineOverride) {
      if (m.repeat && now - (this.lastSpoken[name] || 0) > m.repeat) this._announce(name, m, m.line);
      return;
    }
    const prev = this.mood;
    this.mood = name; this.moodAt = now;
    this.lastActive = now; this.drowsy = false; this.yawnUntil = 0;
    this.tgt = {...BASE, ...m.p};
    this.glowT = m.glow; this.irisT = m.iris;
    this.root.dataset.fx = m.fx || "";
    this.root.dataset.mood = name;
    this.el.mood.textContent = lineOverride === "unplugged" ? "Link lost" : m.label;
    if (silent) { if (m.line) this.showBubble((LINES[m.line].caption || LINES[m.line].say), 1e9); return; }

    if (name === "sleep") { this.readySaid = false; }
    if (name === "idle" && prev === "sleep" && !this.greeted) { this.greeted = true; this.chirp("hoo"); this.say("hello"); return; }
    // A face shows up after being away: say hi (at most every 8 s).
    if (FACE_MOODS.has(name) && (prev === "search" || prev === "waking") && now - this.lastGreet > 8000) {
      if (name === "focus") { this.lastGreet = now; this.chirp("hoo"); this.say("hiFocus"); return; }
      if (!m.line) { this.lastGreet = now; this.chirp("hoo"); this.say("hi"); return; }
    }
    if ((name === "happy" || name === "turning") && prev === "focus" && !this.readySaid) {
      this.readySaid = true; this.chirp("hoo"); this.say("ready"); return;
    }
    const lineId = lineOverride || m.line;
    if (lineId) this._announce(name, m, lineId);
    else if (this.persistent) this.hideBubble();
  }
  _announce(name, m, lineId) {
    const now = performance.now();
    this.lastSpoken[name] = now;
    if (m.chirp) this.chirp(m.chirp);
    this.say(lineId);
  }

  // ---------- bubble + voice ----------
  showBubble(text, ms) {
    this.el.bubble.textContent = text;
    this.el.bubble.classList.add("show");
    this.persistent = ms >= 1e8;
    this.bubbleUntil = performance.now() + ms;
  }
  hideBubble() { this.el.bubble.classList.remove("show"); this.bubbleUntil = 0; this.persistent = false; }

  speak(text, id) {
    if (!this.sound) return;
    const now = performance.now();
    if (now - this.lastSpeakAt < 1200 && this.speaking) return;   // don't pile up lines
    this.lastSpeakAt = now;
    const generation = this.audioGeneration;
    const canPlay = () => this.sound && this.audioGeneration === generation;
    const tts = () => {
      if (!canPlay() || !("speechSynthesis" in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = 1.45; u.rate = 1.06; u.volume = 1;
      const v = pickVoice(); if (v) u.voice = v;
      u.onstart = () => { if (canPlay()) this.speaking = true; };
      u.onend = u.onerror = () => { if (canPlay()) this.speaking = false; };
      speechSynthesis.speak(u);
    };
    if (this.opts.audioBase) {
      const a = new Audio(this.opts.audioBase.replace(/\/$/, "") + "/" + id + ".mp3");
      if (this.voiceAudio) {
        this.voiceAudio.onplay = this.voiceAudio.onended = this.voiceAudio.onerror = null;
        this.voiceAudio.pause();
      }
      this.voiceAudio = a;
      a.onplay = () => { if (canPlay()) this.speaking = true; else a.pause(); };
      a.onended = () => { if (canPlay()) this.speaking = false; if (this.voiceAudio === a) this.voiceAudio = null; };
      a.onerror = () => { if (canPlay()) { this.speaking = false; tts(); } };
      a.play().catch(tts);
    } else tts();
  }

  chirp(kind) {
    if (!this.sound) return;
    const ctx = audio(); if (!ctx) return;
    const notes = {
      hoo:   [[520, 430, 0, .22], [470, 390, .28, .3]],
      alert: [[700, 1250, 0, .12], [900, 1400, .14, .12]],
      worry: [[620, 420, 0, .35]],
      sad:   [[440, 260, 0, .45]],
      ack:   [[880, 1040, 0, .08]],
      giggle:[[900, 1150, 0, .06], [1000, 1300, .09, .06], [1150, 1500, .18, .08]],
      yawn:  [[520, 300, 0, .8]],
    }[kind];
    if (!notes) return;
    const t0 = ctx.currentTime + .01;
    for (const [f1, f2, at, dur] of notes) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      this.tones.add(o);
      o.onended = () => { this.tones.delete(o); o.disconnect(); g.disconnect(); };
      o.type = kind === "alert" ? "triangle" : "sine";
      o.frequency.setValueAtTime(f1, t0 + at);
      o.frequency.exponentialRampToValueAtTime(f2, t0 + at + dur);
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(.09, t0 + at + .03);
      g.gain.exponentialRampToValueAtTime(.0008, t0 + at + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + at); o.stop(t0 + at + dur + .05);
    }
  }

  // ---------- animation ----------
  _frame(now) {
    requestAnimationFrame(this._frame);
    if (now - this._last < 1000 / this.opts.fps - 1) return;
    const dt = Math.min(.1, (now - this._last) / 1000);
    this._last = now;
    const t = now / 1000, k = 1 - Math.exp(-dt * 9), c = this.cur, g = this.tgt;

    if (this.override && now >= this.override.until && this.mood === "worried") {
      this.override = null; this.setMood("sleep");
    }
    if (this.bubbleUntil && now > this.bubbleUntil && !this.speaking) this.hideBubble();

    for (const key in g) c[key] += (g[key] - c[key]) * k;
    if (this.glow !== this.glowT) { this.glow = mixHex(this.glow, this.glowT, Math.min(1, k * 1.4)); if (k > .99) this.glow = this.glowT; }
    if (this.iris !== this.irisT) { this.iris = mixHex(this.iris, this.irisT, Math.min(1, k * 1.4)); }

    // Distance anticipation: eyes widen as an obstacle gets close.
    let eye = c.eye, pupil = c.pupil;
    if (typeof this.distance === "number" && (this.mood === "driving" || this.mood === "startled")) {
      const near = clamp((60 - this.distance) / 45, 0, 1);
      eye += near * .1; pupil *= 1 - near * .3;
    }

    // Gaze: driver look when known, otherwise wander.
    if (now > this.gaze.next) {
      this.gaze.tx = (Math.random() * 2 - 1) * c.wander;
      this.gaze.ty = (Math.random() * 2 - 1) * c.wander * .6;
      this.gaze.next = now + 700 + Math.random() * 1600;
    }
    const wantX = this.lookT != null && this.mood !== "sleep" ? this.lookT : this.gaze.tx;
    const wantY = this.lookT != null && this.mood !== "sleep" ? 0 : this.gaze.ty;
    this.gaze.x += (wantX - this.gaze.x) * Math.min(1, k * 1.6);
    this.gaze.y += (wantY - this.gaze.y) * Math.min(1, k * 1.6);
    this.turn += (this.turnT - this.turn) * k;

    // Blink.
    if (now > this.blinkAt) {
      this.blinkUntil = now + 170;
      this.blinkAt = now + 2200 + Math.random() * 3800 + (Math.random() < .2 ? -1900 : 0);
    }
    const blink = now < this.blinkUntil ? 1 - Math.abs((this.blinkUntil - now) / 85 - 1) : 0;

    // Overlays: doze, yawn, tickle, owl head spin.
    if (!this.stage && !this.drowsy && (this.mood === "idle" || this.mood === "happy") &&
        now - this.lastActive > this.opts.dozeAfter) this.doze();
    let lidTop = c.lidTop, lidBottom = c.lidBottom, blush = c.blush, tilt = c.tilt, wing = c.wing, yawn = 0, spinDeg = 0;
    if (this.drowsy) lidTop = Math.max(lidTop, .72 + .08 * Math.sin(t * 1.3));
    if (now < this.yawnUntil) {
      yawn = Math.sin(Math.PI * clamp(1 - (this.yawnUntil - now) / 1800, 0, 1));
      lidTop = Math.max(lidTop, .45 + .45 * yawn);
    }
    if (now < this.pokeUntil) {
      const p = clamp((now - this.pokeAt) / 1100, 0, 1), env = Math.sin(Math.PI * p);
      lidBottom = Math.max(lidBottom, .55 * env); blush = Math.max(blush, env);
      lidTop = Math.min(lidTop, .1); tilt += Math.sin(p * 26) * 8 * env; wing = Math.max(wing, .8 * env);
    }
    if (this.spinAt && now > this.spinAt && now - this.spinAt < 900) {
      const p = (now - this.spinAt) / 900;
      spinDeg = 360 * (p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
    }

    const nod = now < this.nodUntil ? Math.sin((1 - (this.nodUntil - now) / 420) * Math.PI) : 0;
    const bob = Math.sin(t * 2.2) * c.bob;
    const sx = c.shake ? (Math.random() * 2 - 1) * c.shake : 0;
    const sy = c.shake ? (Math.random() * 2 - 1) * c.shake * .5 : 0;
    const puff = 1 + c.puff;
    this.el.all.setAttribute("transform",
      `translate(${160 + sx} ${210 + bob + sy}) scale(${puff}) translate(-160 -210)`);

    const tx = this.turn * 24;
    this.el.head.setAttribute("transform", `translate(${tx} ${-nod * 7}) rotate(${tilt + spinDeg} 160 175)`);
    this.el.tuftL.setAttribute("transform", `rotate(${spinDeg} 160 175) translate(${tx * .55} ${-nod * 5}) rotate(${-c.tuft} 98 118)`);
    this.el.tuftR.setAttribute("transform", `rotate(${spinDeg} 160 175) translate(${tx * .55} ${-nod * 5}) rotate(${c.tuft} 222 118)`);

    const flap = wing * 16 * Math.abs(Math.sin(t * (wing > .6 ? 16 : 5)));
    this.el.wingL.setAttribute("transform", `rotate(${8 + flap} 74 190)`);
    this.el.wingR.setAttribute("transform", `rotate(${-8 - flap} 246 190)`);

    for (const [side, ctr, sign] of [["L", L, 1], ["R", R, -1]]) {
      const lid = Math.max(lidTop + (side === "R" ? c.asym : 0), blink, 0);
      this.el["eye" + side].setAttribute("transform",
        `translate(${ctr.x} ${ctr.y}) scale(${eye}) translate(${-ctr.x} ${-ctr.y})`);
      this.el["look" + side].setAttribute("transform", `translate(${this.gaze.x * 11} ${this.gaze.y * 8})`);
      this.el["pup" + side].setAttribute("r", (13 * pupil).toFixed(2));
      this.el["lid" + side].setAttribute("transform",
        `rotate(${c.lidAngle * sign} ${ctr.x} ${ctr.y}) translate(0 ${Math.min(1, lid) * 74})`);
      this.el["low" + side].setAttribute("transform", `translate(0 ${-lidBottom * 62})`);
      this.el["brow" + side].setAttribute("transform",
        `translate(0 ${-c.browLift}) rotate(${c.brow * sign} ${ctr.x} ${ctr.y - 50})`);
    }
    for (const b of this.el.blush) b.setAttribute("opacity", (blush * .65).toFixed(2));
    const shut = clamp((lidTop - .8) / .2, 0, 1).toFixed(2);
    for (const s of this.el.shut) s.setAttribute("opacity", shut);

    const talk = this.speaking ? .25 + .75 * Math.abs(Math.sin(t * 17) * Math.sin(t * 7.3)) : 0;
    this.el.beak.setAttribute("transform", `translate(0 ${talk * 7 + yawn * 13})`);

    this.spin += c.wheel * dt * 540;
    for (const s of this.el.spokes) s.setAttribute("transform", `rotate(${this.spin % 360} ${s.dataset.x} 312)`);

    // Colours.
    this.root.style.setProperty("--lk-glow", this.glow);
    this.el.haloA.setAttribute("stop-color", this.glow);
    this.el.haloB.setAttribute("stop-color", this.glow);
    this.el.irisB.setAttribute("stop-color", this.iris);
    this.el.irisA.setAttribute("stop-color", mixHex(this.iris, "#ffffff", .55));
    this.el.irisC.setAttribute("stop-color", mixHex(this.iris, "#3a1a00", .55));
    for (const led of this.el.leds) led.setAttribute("fill", this.glow);

    if (this.channel && !this.stage && (!this._bcAt || now - this._bcAt > 66)) {
      this._bcAt = now;
      this.channel.postMessage({
        mood: this.mood, fx: this.root.dataset.fx, label: this.el.mood.textContent,
        lookT: this.lookT, turnT: this.turnT, distance: this.distance,
        you: this.el.you.textContent, rov: this.el.rov.textContent, speaking: this.speaking,
        drowsy: this.drowsy, yawn: now < this.yawnUntil, poke: now < this.pokeUntil,
        spin: this.spinAt > 0 && now - this.spinAt < 900,
        bubble: this.el.bubble.classList.contains("show") ? this.el.bubble.textContent : "",
        nod: this.nodUntil > now,
      });
    }
  }

  // ---------- modes ----------
  watchPage() {             // read the Lookout page every 100 ms
    const $ = id => document.getElementById(id);
    let lastState = null;
    let lastHeard = ($("voice-command") || $("heard"))?.textContent?.replace(/^heard:\s*/i, "").trim() ?? "";
    setInterval(() => {
      const state = $("state")?.textContent?.trim() ?? "";
      if (state !== lastState) { lastState = state; this.setReason(state); }
      this.setLook(parseDeg($("target")?.textContent));
      this.setHeading(parseDeg($("heading")?.textContent));
      this.setDistance(parseDist($("distance")?.textContent));
      // Newer page: #voice-command shows only commands the rover accepted
      // ("Command: forward · local"). Older page: #heard shows the command.
      const vc = $("voice-command");
      if (vc) {
        const cmd = vc.textContent.trim();
        if (cmd !== lastHeard && (/^command:/i.test(cmd) || vc.dataset.accepted === "true")) this.heard(cmd.replace(/^command:\s*/i, "").replace(/\s*·.*$/, ""));
        lastHeard = cmd;
      } else {
        const heard = ($("heard")?.textContent ?? "").replace(/^heard:\s*/i, "").trim();
        if (heard && heard !== "—" && heard !== lastHeard) this.heard(heard);
        lastHeard = heard;
      }
    }, 100);
  }
  stageMode() {             // mirror the driver page in another window/monitor
    this.stage = true;
    this.sound = false;
    this.root.classList.add("lk-big");
    this.el.snd.remove();
    this.channel?.addEventListener("message", ({data: d}) => {
      if (d.mood !== this.mood) {
        const m = MOODS[d.mood] || MOODS.idle;
        this.mood = d.mood; this.tgt = {...BASE, ...m.p}; this.glowT = m.glow; this.irisT = m.iris;
        this.root.dataset.mood = d.mood;
      }
      this.root.dataset.fx = d.fx;
      this.el.mood.textContent = d.label;
      this.lookT = d.lookT; this.turnT = d.turnT; this.speaking = d.speaking;
      this.el.you.textContent = d.you; this.el.rov.textContent = d.rov;
      this.setDistance(d.distance);
      if (d.nod) this.nodUntil = performance.now() + 200;
      const n = performance.now();
      this.drowsy = d.drowsy;
      if (d.yawn && n >= this.yawnUntil) this.yawnUntil = n + 1800;
      if (d.poke && n >= this.pokeUntil) { this.pokeAt = n; this.pokeUntil = n + 1100; }
      if (d.spin && !(this.spinAt && n - this.spinAt < 900)) this.spinAt = n;
      if (d.bubble) { if (this.el.bubble.textContent !== d.bubble) this.showBubble(d.bubble, 1e9); this.bubbleUntil = performance.now() + 400; }
    });
  }
}

const fmtDeg = d => Math.abs(d) < 1 ? "0°" : Math.round(Math.abs(d)) + "° " + (d > 0 ? "L" : "R");

let _ctx = null;
function audio() {
  if (_ctx) return _ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !navigator.userActivation?.hasBeenActive) return null;
  _ctx = new AC();
  return _ctx;
}
let _voice;
function pickVoice() {
  if (_voice !== undefined) return _voice;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  _voice = voices.find(v => /Samantha|Google US English|Aria|Jenny|Ava|Zira/i.test(v.name) && /^en/i.test(v.lang))
    || voices.find(v => /^en-US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
  return _voice;
}
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => { _voice = undefined; };

document.addEventListener("keydown", e => {
  if ((e.key === "m" || e.key === "M") && !/input|textarea|select/i.test(e.target.tagName) && window.hoot) {
    window.hoot.toggleSound();
  }
});

function boot() {
  const host = document.getElementById("mascot") || document.querySelector("[data-lookout-mascot]");
  if (!host) return;
  const hoot = new Mascot(host);
  window.hoot = hoot;
  if (new URLSearchParams(location.search).has("stage")) hoot.stageMode();
  else if (document.getElementById("state")) hoot.watchPage();
  // On the demo page (no #state), mascot.html drives Hoot with the API.
}
window.LookoutMascot = {Mascot, MOODS, LINES, moodFor};
// Start now if the host is already on the page (script at the end of <body>),
// otherwise wait for the page to finish loading.
if (document.readyState !== "loading" || document.getElementById("mascot")) boot();
else document.addEventListener("DOMContentLoaded", boot);
})();
