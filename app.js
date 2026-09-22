import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Chart from "https://esm.sh/chart.js@4.4.3/auto";

// Viktige hendelser som tegnes som loddrette markører på alle grafer
const LIFE_EVENTS = [
  { date: "2026-02-02", label: "❤️", color: "#ef4444" },
];

// Innebygd Chart.js-plugin som tegner loddrette markører for LIFE_EVENTS.
// Holdes lokal her – ingen ekstern avhengighet, ingen risiko for at en
// CDN-import ødelegger hele appen.
const lifeEventsPlugin = {
  id: "lifeEvents",
  afterDatasetsDraw(chart, _args, opts) {
    const events = (opts && opts.events) || [];
    if (!events.length) return;
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    if (!xScale || !yScale) return;
    const ctx = chart.ctx;
    events.forEach((ev) => {
      const floor = Math.floor(ev.position);
      const frac = ev.position - floor;
      const x1 = xScale.getPixelForValue(floor);
      const x2 = xScale.getPixelForValue(floor + 1);
      const x = Number.isFinite(x1) && Number.isFinite(x2) ? x1 + (x2 - x1) * frac : xScale.getPixelForValue(ev.position);
      const top = yScale.top;
      const bottom = yScale.bottom;
      ctx.save();
      ctx.strokeStyle = ev.color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 13px -apple-system, system-ui, sans-serif';
      const text = ev.label;
      const tw = ctx.measureText(text).width;
      const padX = 5, padY = 3, h = 14 + padY * 2;
      let lx = x + 4;
      if (lx + tw + padX * 2 > xScale.right) lx = x - tw - padX * 2 - 4;
      const ly = top + 4;
      // Hvit boks med tynn rød kant
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = ev.color;
      ctx.lineWidth = 1;
      const r = 4;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(lx, ly, tw + padX * 2, h, r);
      else ctx.rect(lx, ly, tw + padX * 2, h);
      ctx.fill();
      ctx.stroke();
      // Emoji rendrer med sin egen farge
      ctx.textBaseline = "top";
      ctx.fillStyle = "#000";
      ctx.fillText(text, lx + padX, ly + padY);
      ctx.restore();
    });
  },
};
Chart.register(lifeEventsPlugin);

// ===================================================================
//  Oppsett / tilstand
// ===================================================================
const LS = {
  url: "sb_url",
  key: "sb_key",
  doge: "doge_on",
  draftPrefix: "draft_", // + ISO-dato: lokalt utkast av ulagret økt
};

const APP_VERSION = "1.9";
const ALLOWED_EMAIL = "marteri9@gmail.com";

// Spor ulagrede endringer i Logg-fanen
let logDirty = false;
let renderedDate = null;
let currentSession = null;     // dagens sessions-rad (dagsform + kommentar) fra sist renderLog
let currentSuggestions = [];   // underholdnings-forslag, gjenbrukes ved hurtig-lagt-til øvelse
let dateDebounce = null;

const DEFAULT_EXERCISES = [
  // navn, type
  ["Sykling", "cardio"],
  ["Roing", "cardio"],
  ["Jogging", "cardio"],
  ["Legpress", "strength"],
  ["Leg extension", "strength"],
  ["Nedtrekk", "strength"],
  ["Sittende romaskin", "strength"],
  ["Omvendt sittende romaskin", "strength"],
  ["Situps", "bodyweight"],
  ["Knebøy knelende", "bodyweight"],
];

const TYPE_LABEL = {
  cardio: "Kondisjon · minutter",
  strength: "Styrke · kg × reps × sett",
  bodyweight: "Kropp/matte · reps × sett",
};

// dagsform: nøkkel, etikett, emoji
const ENERGY = [
  ["syk", "Syk", "🤒"],
  ["slapp", "Slapp", "😪"],
  ["ok", "Ok", "🙂"],
  ["flott", "Flott", "💪"],
];

// Farge på dagsform i progresjonsgrafen
const ENERGY_COLOR = {
  syk: "#ef4444",    // rød
  slapp: "#f59e0b",  // oransje
  ok: "#22c55e",     // grønn
  flott: "#22c55e",  // grønn
};
const POINT_DEFAULT = "#64748b"; // grå når dagsform ikke er valgt

let sb = null;
let user = null;
let exercisesCache = [];
let chart = null;
let pendingEmail = "";

// ===================================================================
//  Småhjelpere
// ===================================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
function todayStr() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
function isoToDmy(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
function dmyToIso(s) {
  const m = (s || "").trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];
  const month = Number(mm), day = Number(dd);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const test = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  if (test.getFullYear() !== Number(yyyy) || test.getMonth() + 1 !== month || test.getDate() !== day) return null;
  return `${yyyy}-${mm}-${dd}`;
}
function getLogDateIso() {
  return dmyToIso($("#log-date").value);
}
function setLogDateIso(iso) {
  $("#log-date").value = isoToDmy(iso);
  $("#log-weekday").textContent = iso ? cap(weekdayName(iso)) : "";
  updateDateShortcuts(iso);
}
function updateDateShortcuts(iso) {
  const todayBtn = document.getElementById("date-today");
  if (!todayBtn) return;
  todayBtn.classList.toggle("hidden", !iso || iso === todayStr());
}
function shiftLogDate(deltaDays) {
  const iso = getLogDateIso() || todayStr();
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  jumpLogDate(next);
}
function jumpLogDate(iso) {
  setLogDateIso(iso);
  maybeRenderForDate(iso);
}
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }
function num(v) {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
let dogeTimer;
function praiseDoge() {
  if (localStorage.getItem(LS.doge) === "off") return;
  const d = $("#doge-praise");
  if (!d) return;
  d.classList.remove("show");
  d.classList.remove("hidden");
  // Tving reflow så animasjonen restartes
  void d.offsetWidth;
  d.classList.add("show");
  clearTimeout(dogeTimer);
  dogeTimer = setTimeout(() => {
    d.classList.add("hidden");
    d.classList.remove("show");
  }, 2900);
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2400);
}

// ===================================================================
//  Init
// ===================================================================
function getConfig() {
  const url = localStorage.getItem(LS.url) || (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || "";
  const key = localStorage.getItem(LS.key) || (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_ANON_KEY) || "";
  return { url: url.trim(), key: key.trim() };
}

async function init() {
  registerSW();
  wireStaticUI();

  const { url, key } = getConfig();
  if (!url || !key) {
    show($("#setup-screen"));
    return;
  }
  try {
    sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  } catch (e) {
    show($("#setup-screen"));
    $("#setup-msg").textContent = "Kunne ikke koble til: " + e.message;
    $("#setup-msg").className = "auth-msg err";
    return;
  }

  const { data } = await sb.auth.getSession();
  if (data.session) {
    await onLoggedIn(data.session.user);
  } else {
    show($("#auth-screen"));
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (!session) {
      // Utlogget eller utløpt session -> tilbake til innlogging.
      user = null;
      hide($("#app"));
      show($("#auth-screen"));
    } else if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && $("#app").classList.contains("hidden")) {
      // Innlogget på nytt (eller token oppfrisket) mens appen var skjult.
      onLoggedIn(session.user);
    }
  });
}

function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
}

async function onLoggedIn(u) {
  user = u;
  pruneDrafts();
  hide($("#auth-screen"));
  hide($("#setup-screen"));
  show($("#app"));
  $("#settings-email").textContent = u.email || "";

  await ensureDefaults();
  await loadExercises();
  setLogDateIso(todayStr());
  await renderLog();
}

// ===================================================================
//  Auth-flyt
// ===================================================================
function wireAuth() {
  $("#auth-send").addEventListener("click", async () => {
    setBtnLoading($("#auth-send"), true, "Sender…");
    const { error } = await sb.auth.signInWithOtp({
      email: ALLOWED_EMAIL,
      options: { shouldCreateUser: false },
    });
    setBtnLoading($("#auth-send"), false, "Send engangskode til e-posten min");
    if (error) return authMsg("Kunne ikke sende kode.", true);
    pendingEmail = ALLOWED_EMAIL;
    hide($("#auth-step-email"));
    show($("#auth-step-code"));
    authMsg("Engangskode er sendt.");
  });

  $("#auth-verify").addEventListener("click", async () => {
    const token = $("#auth-code").value.trim();
    if (!token) return authMsg("Skriv inn koden fra e-posten.", true);
    setBtnLoading($("#auth-verify"), true, "Logger inn…");
    const { data, error } = await sb.auth.verifyOtp({ email: pendingEmail, token, type: "email" });
    setBtnLoading($("#auth-verify"), false, "Logg inn");
    if (error) return authMsg("Feil kode. Prøv igjen.", true);
    authMsg("");
    await onLoggedIn(data.user);
  });
}
function authMsg(msg, isErr = false) {
  const m = $("#auth-msg");
  m.textContent = msg;
  m.className = "auth-msg " + (isErr ? "err" : "ok");
}
function setBtnLoading(btn, loading, idleText) {
  btn.disabled = loading;
  btn.innerHTML = loading ? '<span class="spinner"></span> ' + idleText : idleText;
}

// ===================================================================
//  Øvelser
// ===================================================================
async function ensureDefaults() {
  const { count, error } = await sb
    .from("exercises")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (error) { console.warn(error); return; }
  if (count && count > 0) return;
  const rows = DEFAULT_EXERCISES.map(([name, type], i) => ({
    user_id: user.id, name, type, sort_order: i,
  }));
  const { error: insErr } = await sb.from("exercises").insert(rows);
  if (insErr) console.warn(insErr);
}

async function loadExercises() {
  const { data, error } = await sb
    .from("exercises")
    .select("*")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) { toast("Feil ved lasting av øvelser", true); return; }
  exercisesCache = data || [];
}

function activeExercises() {
  return exercisesCache.filter((e) => !e.archived);
}

// ===================================================================
//  Lokalt utkast – overlever refresh, låst skjerm og fanebytte
// ===================================================================
// Alt du taster i Logg-fanen speiles til localStorage (én nøkkel per dato)
// ved hvert tastetrykk. Når dagen åpnes igjen legges utkastet oppå det som
// ligger i databasen, og regnes som ulagret til du trykker «Lagre økt».
let draftTimer = null;

function draftKey(date) { return LS.draftPrefix + date; }

// Leser skjemaet slik det står nå. Kun kort med innhold tas med, og verdiene
// lagres som tekst – nøyaktig slik de ble tastet.
function serializeDraft() {
  const out = {};
  for (const card of $$(".ex-card")) {
    const exId = card.dataset.exId;
    if (card.dataset.exType === "cardio") {
      const minutes = (card.querySelector(".f-minutes").value || "").trim();
      const entertainment = (card.querySelector(".f-entertainment").value || "").trim();
      if (minutes || entertainment) out[exId] = { minutes, entertainment };
    } else {
      const sets = Array.from(card.querySelectorAll(".set-row")).map((row) => {
        const w = row.querySelector(".s-weight");
        return { w: w ? (w.value || "").trim() : "", r: (row.querySelector(".s-reps").value || "").trim() };
      });
      if (sets.some((s) => s.w || s.r)) out[exId] = { sets };
    }
  }
  return out;
}

function saveDraft() {
  if (!renderedDate) return;
  // Ikke skriv mens loggen laster (ingen kort i DOM) – da ville vi
  // overskrevet et ekte utkast med et tomt.
  if (!$$(".ex-card").length) return;
  const data = serializeDraft();
  try {
    if (Object.keys(data).length === 0) localStorage.removeItem(draftKey(renderedDate));
    else localStorage.setItem(draftKey(renderedDate), JSON.stringify({ savedAt: Date.now(), data }));
  } catch (e) { /* fullt lager e.l. – ikke kritisk */ }
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 250);
}

// Skriv med en gang – brukes når siden går i bakgrunnen eller lukkes.
function flushDraft() {
  clearTimeout(draftTimer);
  saveDraft();
}

function clearDraft(date) {
  clearTimeout(draftTimer);
  try { localStorage.removeItem(draftKey(date)); } catch (e) { /* ignorer */ }
}

// Legger utkastet oppå kortene som allerede er tegnet fra databasen.
// Returnerer true hvis noe faktisk ble gjenopprettet.
function restoreDraft(date) {
  let raw = null;
  try { raw = localStorage.getItem(draftKey(date)); } catch (e) { return false; }
  if (!raw) return false;
  let draft;
  try { draft = JSON.parse(raw); } catch (e) { clearDraft(date); return false; }
  const data = draft && draft.data ? draft.data : {};
  let restored = 0;
  for (const exId of Object.keys(data)) {
    const card = document.querySelector(`.ex-card[data-ex-id="${exId}"]`);
    if (!card) continue; // øvelsen er arkivert/slettet siden utkastet ble laget
    const d = data[exId];
    if (card.dataset.exType === "cardio") {
      if (d.minutes) card.querySelector(".f-minutes").value = d.minutes;
      if (d.entertainment) card.querySelector(".f-entertainment").value = d.entertainment;
    } else {
      const wrap = card.querySelector(".sets-wrap");
      if (!wrap || !Array.isArray(d.sets)) continue;
      wrap.innerHTML = "";
      d.sets.forEach((s, i) => wrap.appendChild(buildSetRow(i + 1, s.w, s.r, card.dataset.exType)));
    }
    card.classList.remove("collapsed"); // vis det som ble hentet fram
    restored++;
  }
  if (restored === 0) { clearDraft(date); return false; }
  const t = draft.savedAt ? new Date(draft.savedAt) : null;
  const when = t
    ? " fra kl. " + String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0")
    : "";
  toast("Gjenopprettet ulagrede endringer" + when);
  return true;
}

// Rydder bort utkast eldre enn 30 dager, så lageret ikke vokser evig.
function pruneDrafts() {
  try {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LS.draftPrefix)) continue;
      let savedAt = 0;
      try { savedAt = (JSON.parse(localStorage.getItem(k)) || {}).savedAt || 0; } catch (e) { /* ugyldig -> slettes */ }
      if (savedAt < cutoff) localStorage.removeItem(k);
    }
  } catch (e) { /* ignorer */ }
}

// ===================================================================
//  LOGG-fane
// ===================================================================
async function renderLog() {
  const date = getLogDateIso() || todayStr();
  const box = $("#log-content");
  box.innerHTML = '<div class="empty">Laster…</div>';

  const list = activeExercises();
  if (list.length === 0) {
    box.innerHTML = '<div class="empty">Ingen øvelser enda. Legg til under «Øvelser».</div>';
    return;
  }

  // Uka (man–søn) som valgt dato ligger i – for ukeslinja i dag-kortet.
  const dObj = parseLocal(date);
  const dow = (dObj.getDay() + 6) % 7; // 0 = mandag
  const mon = new Date(dObj); mon.setDate(dObj.getDate() - dow);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const toIso = (dt) => new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  // Hent alt parallelt: dagens oppføringer, forslag, dagsform, tidligere
  // økter (for «Sist gang»-hint på hvert øvelseskort) og ukas økter.
  const [todayRes, suggestions, session, priorRes, weekRes] = await Promise.all([
    sb.from("entries").select("*, sets(*)").eq("user_id", user.id).eq("performed_on", date),
    entertainmentSuggestions(),
    loadSession(date),
    sb.from("entries").select("*, sets(*)").eq("user_id", user.id)
      .lt("performed_on", date).order("performed_on", { ascending: false }).limit(400),
    sb.from("entries").select("performed_on").eq("user_id", user.id)
      .gte("performed_on", toIso(mon)).lte("performed_on", toIso(sun)),
  ]);

  const week = {
    count: new Set((weekRes.data || []).map((e) => e.performed_on)).size,
    last: priorRes.data && priorRes.data.length ? priorRes.data[0].performed_on : null,
  };

  const byEx = {};
  (todayRes.data || []).forEach((e) => { byEx[e.exercise_id] = e; });

  // Siste oppføring per øvelse FØR valgt dato (først i lista = nyest)
  const lastByEx = {};
  (priorRes.data || []).forEach((e) => {
    if (!lastByEx[e.exercise_id]) lastByEx[e.exercise_id] = e;
  });

  currentSession = session;
  currentSuggestions = suggestions;

  box.innerHTML = "";
  box.appendChild(buildDayCard(date, session, week));

  let lastType = null;
  for (const ex of list) {
    if (ex.type !== lastType) {
      box.appendChild(el("div", "section-title", TYPE_LABEL[ex.type].split(" · ")[0]));
      lastType = ex.type;
    }
    box.appendChild(buildExerciseCard(ex, byEx[ex.id], suggestions, lastByEx[ex.id]));
  }

  // Hurtig-legg-til øvelse rett fra loggen
  box.appendChild(buildQuickAddButton());

  // Lagre-knapp
  const bar = el("div", "savebar");
  const btn = el("button", "primary", "Lagre økt");
  btn.id = "save-session";
  btn.addEventListener("click", saveSession);
  bar.appendChild(btn);
  box.appendChild(bar);

  // Frisk visning fra databasen. Finnes et lokalt utkast for dagen (f.eks.
  // etter en refresh midt i økta) legges det oppå – og regnes som ulagret.
  renderedDate = date;
  logDirty = restoreDraft(date);
}

function lastEntryHint(ex, last) {
  if (!last) return null;
  let summary = "";
  if (ex.type === "cardio") {
    if (last.minutes != null) summary = last.minutes + " min";
    if (last.entertainment) summary += (summary ? " · " : "") + last.entertainment;
  } else {
    const ss = (last.sets || []).slice().sort((a, b) => a.position - b.position);
    summary = ss.map((s) => (s.weight != null ? s.weight + "kg×" : "") + (s.reps ?? "?")).join(", ");
  }
  if (!summary) return null;
  return `Sist (${fmtDate(last.performed_on)}): ${summary}`;
}

function buildDayCard(date, session, week) {
  const card = el("div", "card day-card");
  const head = el("div", "day-head");
  head.innerHTML =
    `<div class="weekday">${cap(weekdayName(date))}</div>` +
    `<div class="muted">${fullDate(date)}</div>`;
  card.appendChild(head);

  const meta = el("div", "day-meta");

  // Ukeslinje: antall økter denne uka, og når forrige økt var.
  let weekTxt = week.count === 0
    ? "Ingen økter denne uka enda"
    : week.count + (week.count === 1 ? " økt" : " økter") + " denne uka";
  if (week.last) weekTxt += " · sist " + fmtDate(week.last);
  meta.appendChild(el("div", "day-week", weekTxt));

  // Retrospekt fra sist lagring (dagsform + kommentar). Endres via «Lagre økt».
  if (session && (session.energy || session.comment)) {
    const parts = [];
    if (session.energy) {
      const e = ENERGY.find((x) => x[0] === session.energy);
      if (e) parts.push(`<span class="emoji">${e[2]}</span> ${e[1]}`);
    }
    if (session.comment) parts.push("💬 " + escapeHtml(session.comment));
    meta.appendChild(el("div", "day-retro", parts.join(" · ")));
  }
  card.appendChild(meta);

  const cloneBtn = el("button", "clone-btn", "📋 Klon forrige trening");
  cloneBtn.type = "button";
  cloneBtn.addEventListener("click", cloneLastSession);
  card.appendChild(cloneBtn);

  return card;
}

function buildQuickAddButton() {
  const b = el("button", "quick-add-ex", "+ Legg til øvelse");
  b.type = "button";
  b.id = "quick-add-ex";
  b.addEventListener("click", quickAddExercise);
  return b;
}

// ===================================================================
//  Modaler
// ===================================================================
function openModal(modalEl) {
  const backdrop = el("div", "modal-backdrop");
  backdrop.appendChild(modalEl);
  document.body.appendChild(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("show"));
  return () => backdrop.remove();
}

// Retrospekt etter lagring: dagsform + kort kommentar (maks 100 tegn) i én
// popup. Eneste vei ut er OK – ingen valg / tom tekst betyr «ingen».
function promptRetro(session, dateIso) {
  return new Promise((resolve) => {
    const m = el("div", "modal");
    m.innerHTML =
      `<h3>Hvordan gikk økta?</h3>` +
      `<div class="muted small">${cap(weekdayName(dateIso))} ${fmtDate(dateIso)} · begge deler er valgfrie</div>`;

    let energy = session && session.energy ? session.energy : null;
    m.appendChild(el("div", "energy-label", "Dagsform"));
    const picker = el("div", "energy-picker");
    ENERGY.forEach(([val, label, emoji]) => {
      const b = el("button", "energy-btn" + (energy === val ? " active" : ""),
        `<span class="emoji">${emoji}</span>${label}`);
      b.type = "button";
      b.addEventListener("click", () => {
        energy = energy === val ? null : val; // trykk igjen for å fjerne valg
        picker.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b && energy != null));
      });
      picker.appendChild(b);
    });
    m.appendChild(picker);

    m.appendChild(el("div", "energy-label", "Kommentar · maks 100 tegn"));
    const ta = el("textarea");
    ta.maxLength = 100;
    ta.rows = 3;
    ta.placeholder = "F.eks. «Tung i beina, men bra pump»";
    ta.value = session && session.comment ? session.comment : "";
    const counter = el("div", "modal-counter");
    const updCount = () => { counter.textContent = ta.value.length + "/100"; };
    ta.addEventListener("input", updCount);
    updCount();
    const ok = el("button", "primary block", "OK");
    ok.type = "button";
    m.append(ta, counter, ok);

    const close = openModal(m);
    const done = () => {
      close();
      resolve({ energy, comment: ta.value.trim().slice(0, 100) || null });
    };
    ok.addEventListener("click", done);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) done();
    });
  });
}

// Navn + type for en ny øvelse. Avbryt gir null.
function promptNewExercise() {
  return new Promise((resolve) => {
    const m = el("div", "modal");
    m.innerHTML = `<h3>Ny øvelse</h3>`;
    const name = el("input");
    name.type = "text";
    name.placeholder = "Navn (f.eks. Skulderpress)";
    name.autocomplete = "off";

    let type = "strength";
    const picker = el("div", "type-picker");
    [
      ["cardio", "Kondisjon", "minutter"],
      ["strength", "Styrke", "kg × reps × sett"],
      ["bodyweight", "Kropp/matte", "reps × sett"],
    ].forEach(([t, label, sub]) => {
      const b = el("button", t === type ? "active" : "", `${label}<small>${sub}</small>`);
      b.type = "button";
      b.addEventListener("click", () => {
        type = t;
        picker.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      });
      picker.appendChild(b);
    });

    const actions = el("div", "modal-actions");
    const cancel = el("button", "ghost", "Avbryt");
    cancel.type = "button";
    const add = el("button", "primary", "Legg til");
    add.type = "button";
    actions.append(cancel, add);
    m.append(name, picker, actions);

    const close = openModal(m);
    setTimeout(() => name.focus(), 60);
    cancel.addEventListener("click", () => { close(); resolve(null); });
    const submit = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); toast("Skriv inn et navn", true); return; }
      close();
      resolve({ name: n, type });
    };
    add.addEventListener("click", submit);
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  });
}

// Legger til en øvelse og setter kortet rett inn i loggen – uten å
// re-rendre, slik at tall som allerede er tastet inn beholdes.
async function quickAddExercise() {
  const res = await promptNewExercise();
  if (!res) return;
  const maxOrder = exercisesCache.reduce((mx, e) => Math.max(mx, e.sort_order || 0), 0);
  const { data: ex, error } = await sb
    .from("exercises")
    .insert({ user_id: user.id, name: res.name, type: res.type, sort_order: maxOrder + 1 })
    .select()
    .single();
  if (error) { toast("Feil: " + error.message, true); return; }
  await loadExercises();

  const addBtn = $("#quick-add-ex");
  const parent = addBtn.parentElement;
  const cards = $$(".ex-card");
  const lastCard = cards[cards.length - 1];
  if (!lastCard || lastCard.dataset.exType !== ex.type) {
    parent.insertBefore(el("div", "section-title", TYPE_LABEL[ex.type].split(" · ")[0]), addBtn);
  }
  const card = buildExerciseCard(ex, null, currentSuggestions, null);
  card.classList.remove("collapsed"); // åpen og klar til å fylles inn
  parent.insertBefore(card, addBtn);
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  toast("La til «" + ex.name + "» ✓");
}

async function cloneLastSession() {
  const currentDate = getLogDateIso() || todayStr();
  const { data: recent, error: rErr } = await sb
    .from("entries")
    .select("performed_on")
    .eq("user_id", user.id)
    .lt("performed_on", currentDate)
    .order("performed_on", { ascending: false })
    .limit(1);
  if (rErr) { toast("Feil: " + rErr.message, true); return; }
  if (!recent || !recent.length) {
    toast("Ingen tidligere økt å klone fra", true);
    return;
  }
  const lastDate = recent[0].performed_on;
  const { data: entries, error: eErr } = await sb
    .from("entries")
    .select("*, sets(*)")
    .eq("user_id", user.id)
    .eq("performed_on", lastDate);
  if (eErr) { toast("Feil: " + eErr.message, true); return; }
  if (!entries || !entries.length) {
    toast("Ingen tidligere økt å klone fra", true);
    return;
  }

  let cloned = 0;
  for (const e of entries) {
    const card = document.querySelector(`.ex-card[data-ex-id="${e.exercise_id}"]`);
    if (!card) continue;
    const type = card.dataset.exType;
    if (type === "cardio") {
      const minIn = card.querySelector(".f-minutes");
      const entIn = card.querySelector(".f-entertainment");
      if (minIn && e.minutes != null) minIn.value = e.minutes;
      if (entIn && e.entertainment) entIn.value = e.entertainment;
    } else {
      const setsWrap = card.querySelector(".sets-wrap");
      if (!setsWrap) continue;
      setsWrap.innerHTML = "";
      const sorted = (e.sets || []).slice().sort((a, b) => a.position - b.position);
      const rows = sorted.length ? sorted : [{ weight: null, reps: null }];
      rows.forEach((s, i) => setsWrap.appendChild(buildSetRow(i + 1, s.weight, s.reps, type)));
    }
    cloned++;
  }
  if (cloned) scheduleDraftSave(); // klonede tall skal også overleve en refresh
  toast(cloned ? `Klonet fra ${fmtDate(lastDate)} ✓` : "Fant ingen aktive øvelser å klone");
}

function buildExerciseCard(ex, entry, suggestions, lastEntry) {
  const card = el("div", "ex-card collapsed");
  card.dataset.exId = ex.id;
  card.dataset.exType = ex.type;

  const head = el("div", "ex-head");
  const left = el("div", "ex-head-left");
  const nameSpan = el("span", "name");
  nameSpan.textContent = ex.name;
  left.appendChild(nameSpan);
  const chevron = el("span", "ex-chevron");
  chevron.textContent = "▾";
  left.appendChild(chevron);
  head.appendChild(left);

  const right = el("div", "ex-head-right");
  if (entry) {
    const delBtn = el("button", "ex-delete", "🗑");
    delBtn.type = "button";
    delBtn.title = "Slett denne oppføringen";
    delBtn.setAttribute("aria-label", "Slett oppføring");
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const dateLabel = fmtDate(getLogDateIso() || todayStr());
      if (!confirm(`Slette ${ex.name} for ${dateLabel}?`)) return;
      await deleteEntry(entry.id);
    });
    right.appendChild(delBtn);
  }
  const savedMark = entry ? ' <span class="ex-saved-tag">● lagret</span>' : "";
  right.insertAdjacentHTML("beforeend", `<span class="badge">${badgeText(ex.type)}${savedMark}</span>`);
  head.appendChild(right);

  head.addEventListener("click", (e) => {
    if (e.target.closest(".ex-delete")) return;
    card.classList.toggle("collapsed");
  });

  card.appendChild(head);

  const hint = lastEntryHint(ex, lastEntry);
  if (hint) {
    const h = el("div", "last-hint");
    h.textContent = hint;
    card.appendChild(h);
  }

  const body = el("div", "ex-body");

  if (ex.type === "cardio") {
    const row = el("div", "field-row");
    row.innerHTML = `<label>Minutter</label>`;
    const minIn = el("input");
    minIn.type = "number"; minIn.inputMode = "numeric"; minIn.placeholder = "f.eks. 30";
    minIn.className = "f-minutes";
    if (entry && entry.minutes != null) minIn.value = entry.minutes;
    row.appendChild(minIn);
    body.appendChild(row);

    // Underholdning – husker tidligere tekst via datalist
    const entRow = el("div", "field-row");
    entRow.innerHTML = `<label>Så på</label>`;
    const entIn = el("input");
    entIn.type = "text";
    entIn.placeholder = "Hva så du på?";
    entIn.className = "f-entertainment";
    entIn.setAttribute("list", "ent-suggestions");
    entIn.autocomplete = "off";
    if (entry && entry.entertainment) entIn.value = entry.entertainment;
    entRow.appendChild(entIn);
    body.appendChild(entRow);

    // delt datalist
    if (!document.getElementById("ent-suggestions")) {
      const dl = el("datalist");
      dl.id = "ent-suggestions";
      document.body.appendChild(dl);
    }
    const dl = document.getElementById("ent-suggestions");
    dl.innerHTML = suggestions.map((s) => `<option value="${escapeAttr(s)}"></option>`).join("");
  } else {
    // styrke / kroppsvekt: sett-rader
    const noWeight = ex.type === "bodyweight";
    const headCols = noWeight ? `<span>#</span><span>Reps</span><span></span>` : `<span>#</span><span>Kg</span><span>Reps</span><span></span>`;
    body.appendChild(el("div", "set-head" + (noWeight ? " no-weight" : ""), headCols));
    const setsWrap = el("div", "sets-wrap");
    body.appendChild(setsWrap);

    const existing = entry && entry.sets ? entry.sets.slice().sort((a, b) => a.position - b.position) : [];
    if (existing.length) {
      existing.forEach((s, i) => setsWrap.appendChild(buildSetRow(i + 1, s.weight, s.reps, ex.type)));
    } else {
      setsWrap.appendChild(buildSetRow(1, null, null, ex.type));
    }

    const addBtn = el("button", "add-set", "+ Legg til sett");
    addBtn.type = "button";
    addBtn.addEventListener("click", () => {
      const n = setsWrap.children.length + 1;
      const last = setsWrap.lastElementChild;
      const lastWInput = last && last.querySelector(".s-weight");
      const lastRInput = last && last.querySelector(".s-reps");
      const lastW = lastWInput ? lastWInput.value : "";
      const lastR = lastRInput ? lastRInput.value : "";
      setsWrap.appendChild(buildSetRow(n, lastW, lastR, ex.type));
      renumber(setsWrap);
    });
    body.appendChild(addBtn);
  }

  card.appendChild(body);
  return card;
}

function buildSetRow(n, weight, reps, type) {
  const noWeight = type === "bodyweight";
  const row = el("div", "set-row" + (noWeight ? " no-weight" : ""));
  row.innerHTML = `<span class="setno">${n}</span>`;
  let w = null;
  if (!noWeight) {
    w = el("input"); w.type = "number"; w.inputMode = "decimal"; w.placeholder = "kg"; w.className = "s-weight";
    if (weight != null && weight !== "") w.value = weight;
  }
  const r = el("input"); r.type = "number"; r.inputMode = "numeric"; r.placeholder = "reps"; r.className = "s-reps";
  if (reps != null && reps !== "") r.value = reps;
  const del = el("button", "del", "×"); del.type = "button";
  del.addEventListener("click", () => {
    const wrap = row.parentElement;
    if (wrap.children.length > 1) { row.remove(); renumber(wrap); }
    else { if (w) w.value = ""; r.value = ""; }
  });
  if (w) row.append(w, r, del);
  else row.append(r, del);
  return row;
}
function renumber(wrap) {
  Array.from(wrap.children).forEach((row, i) => {
    row.querySelector(".setno").textContent = i + 1;
  });
}

function badgeText(type) {
  if (type === "cardio") return "min";
  if (type === "strength") return "kg×reps";
  return "reps";
}

async function entertainmentSuggestions() {
  const { data } = await sb
    .from("entries")
    .select("entertainment")
    .eq("user_id", user.id)
    .not("entertainment", "is", null)
    .order("created_at", { ascending: false })
    .limit(300);
  const seen = new Set();
  const out = [];
  (data || []).forEach((r) => {
    const v = (r.entertainment || "").trim();
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  });
  return out.slice(0, 50);
}

async function saveSession() {
  const date = getLogDateIso() || todayStr();
  const btn = $("#save-session");
  setBtnLoading(btn, true, "Lagrer…");
  let savedCount = 0;
  try {
    // 1) Øvelsene lagres først. Det er de viktige dataene, og de skal være
    //    trygt i databasen før vi stopper opp og spør om en kommentar.
    for (const card of $$(".ex-card")) {
      const exId = card.dataset.exId;
      const type = card.dataset.exType;

      if (type === "cardio") {
        const minutes = num(card.querySelector(".f-minutes").value);
        const entertainment = (card.querySelector(".f-entertainment").value || "").trim() || null;
        if (minutes == null && !entertainment) continue;
        await upsertEntry(exId, date, { minutes, entertainment });
        savedCount++;
      } else {
        const rows = Array.from(card.querySelectorAll(".set-row"));
        const sets = [];
        rows.forEach((row, i) => {
          const wEl = row.querySelector(".s-weight");
          const w = wEl ? num(wEl.value) : null;
          const r = num(row.querySelector(".s-reps").value);
          if (r != null || w != null) sets.push({ position: i + 1, weight: w, reps: r });
        });
        if (sets.length === 0) continue;
        const entry = await upsertEntry(exId, date, {});
        // Trygt mot datatap: hent gamle sett-ID-er, sett inn de nye FØRST,
        // og slett de gamle først når innsettingen faktisk lyktes. Hvis nettet
        // faller ut midt i, beholdes de gamle settene i stedet for å forsvinne.
        const { data: oldSets } = await sb.from("sets").select("id").eq("entry_id", entry.id);
        const { error: insErr } = await sb.from("sets").insert(
          sets.map((s) => ({ user_id: user.id, entry_id: entry.id, ...s }))
        );
        if (insErr) throw insErr;
        const oldIds = (oldSets || []).map((s) => s.id);
        if (oldIds.length) {
          const { error: delErr } = await sb.from("sets").delete().in("id", oldIds);
          if (delErr) throw delErr;
        }
        savedCount++;
      }
    }
    // Øvelsene ligger i databasen nå – det lokale utkastet er overflødig.
    clearDraft(date);

    // 2) Retrospekt: dagsform + kort kommentar i én popup. Vises alltid –
    //    også uten øvelser, så en sykedag kan logges. Dukker opp FØR Doge.
    setBtnLoading(btn, false, "Lagre økt");
    const retro = await promptRetro(currentSession, date);
    const hadSession = !!currentSession;

    if (savedCount === 0 && retro.energy == null && retro.comment == null && !hadSession) {
      toast("Ingenting å lagre – fyll inn noe først", true);
      return;
    }

    // 3) Dagsform + kommentar i samme rad. Feiler dette er øvelsene
    //    likevel trygt lagret, så si det tydelig i stedet for «feil».
    setBtnLoading(btn, true, "Lagrer…");
    try {
      if (retro.energy != null || retro.comment != null || hadSession) {
        await upsertSession(date, { energy: retro.energy, comment: retro.comment });
      }
    } catch (se) {
      console.error(se);
      setBtnLoading(btn, false, "Lagre økt");
      toast("Øvelsene er lagret, men dagsform/kommentar feilet: " + (se.message || se), true);
      await renderLog();
      return;
    }
    setBtnLoading(btn, false, "Lagre økt");

    if (savedCount === 0) toast("Retrospekt lagret ✓");
    else {
      toast("Lagret " + savedCount + " øvelse" + (savedCount > 1 ? "r" : "") + " ✓");
      praiseDoge();
    }
    await renderLog();
  } catch (e) {
    console.error(e);
    setBtnLoading(btn, false, "Lagre økt");
    toast("Feil ved lagring: " + (e.message || e), true);
  }
}

async function loadSession(date) {
  const { data } = await sb
    .from("sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("performed_on", date)
    .maybeSingle();
  return data || null;
}

async function upsertSession(date, fields) {
  const payload = { user_id: user.id, performed_on: date };
  // Popupen viser alltid nåværende tilstand, så det som står der er sannheten:
  // null betyr «fjern», undefined betyr «ikke rør».
  if (fields.energy !== undefined) payload.energy = fields.energy;
  if (fields.comment !== undefined) payload.comment = fields.comment;
  const { error } = await sb
    .from("sessions")
    .upsert(payload, { onConflict: "user_id,performed_on" });
  if (error) throw error;
}

async function deleteEntry(entryId, opts = {}) {
  const { error: setsErr } = await sb.from("sets").delete().eq("entry_id", entryId);
  if (setsErr) { toast("Feil ved sletting: " + setsErr.message, true); return; }
  const { error } = await sb.from("entries").delete().eq("id", entryId);
  if (error) { toast("Feil ved sletting: " + error.message, true); return; }
  toast("Slettet ✓");
  if (!opts.silentReload) await renderLog();
}

async function upsertEntry(exId, date, fields) {
  const payload = {
    user_id: user.id,
    exercise_id: exId,
    performed_on: date,
    ...fields,
  };
  const { data, error } = await sb
    .from("entries")
    .upsert(payload, { onConflict: "user_id,exercise_id,performed_on" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ===================================================================
//  PROGRESJON-fane
// ===================================================================
async function fillProgressExercises() {
  const sel = $("#progress-exercise");
  const cur = sel.value;
  const { data: usedRows } = await sb
    .from("entries")
    .select("exercise_id")
    .eq("user_id", user.id);
  const usedIds = new Set((usedRows || []).map((r) => r.exercise_id));
  const list = activeExercises().filter((e) => usedIds.has(e.id));
  sel.innerHTML = list.map((e) => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
  if (cur && list.some((e) => e.id === cur)) sel.value = cur;
  return list;
}

async function renderProgress() {
  const withData = await fillProgressExercises();
  const sel = $("#progress-exercise");
  if (!sel.value && withData[0]) sel.value = withData[0].id;
  const ex = exercisesCache.find((e) => e.id === sel.value);
  if (!ex) {
    if (chart) { chart.destroy(); chart = null; }
    $("#progress-chart").getContext("2d").clearRect(0, 0, $("#progress-chart").width, $("#progress-chart").height);
    $("#progress-table").innerHTML = '<div class="empty">Ingen øvelser med logger enda. Lagre minst én økt først.</div>';
    return;
  }
  await drawProgress(ex);
}

async function drawProgress(ex) {
  const { data: entries, error } = await sb
    .from("entries")
    .select("*, sets(*)")
    .eq("user_id", user.id)
    .eq("exercise_id", ex.id)
    .order("performed_on", { ascending: true });
  if (error) { toast("Feil ved lasting", true); return; }

  if (!entries || entries.length === 0) {
    if (chart) { chart.destroy(); chart = null; }
    $("#progress-table").innerHTML = '<div class="empty">Ingen logger på «' + escapeHtml(ex.name) + '» enda.</div>';
    return;
  }

  // Dagsform og kommentar for disse datoene (farge på punktene + notat i tabellen)
  const dates = entries.map((e) => e.performed_on);
  const { energyByDate, commentByDate } = await loadSessionMaps(dates);

  const points = entries.map((e) => {
    const sets = e.sets || [];
    const weights = sets.map((s) => s.weight).filter((v) => v != null);
    const reps = sets.map((s) => s.reps).filter((v) => v != null);
    return {
      date: e.performed_on,
      energy: energyByDate[e.performed_on] || null,
      maxWeight: weights.length ? Math.max(...weights) : null,
      maxReps: reps.length ? Math.max(...reps) : null,
      minutes: e.minutes,
    };
  });

  drawChart(ex.type, points);
  drawTable(ex, entries.slice().reverse(), energyByDate, commentByDate);
}

async function loadSessionMaps(dates) {
  const energyByDate = {};
  const commentByDate = {};
  if (!dates.length) return { energyByDate, commentByDate };
  const { data } = await sb
    .from("sessions")
    .select("performed_on, energy, comment")
    .eq("user_id", user.id)
    .in("performed_on", dates);
  (data || []).forEach((s) => {
    if (s.energy) energyByDate[s.performed_on] = s.energy;
    if (s.comment) commentByDate[s.performed_on] = s.comment;
  });
  return { energyByDate, commentByDate };
}

function buildLifeEventMarkers(points) {
  const out = [];
  if (!points.length) return out;
  const first = points[0].date;
  const last = points[points.length - 1].date;
  LIFE_EVENTS.forEach((ev) => {
    if (ev.date < first || ev.date > last) return;
    let pos = null;
    for (let i = 0; i < points.length; i++) {
      if (points[i].date === ev.date) { pos = i; break; }
      if (points[i].date > ev.date) { pos = i - 0.5; break; }
    }
    if (pos === null) return;
    out.push({ position: pos, color: ev.color, label: ev.label });
  });
  return out;
}

function drawChart(type, points) {
  const ctx = $("#progress-chart").getContext("2d");
  if (chart) chart.destroy();
  const labels = points.map((p) => fmtDate(p.date));
  const colors = points.map((p) => (p.energy && ENERGY_COLOR[p.energy]) || POINT_DEFAULT);
  const lifeMarkers = buildLifeEventMarkers(points);

  const datasets = [];
  const scales = {
    x: { ticks: { color: "#93a4c4", maxRotation: 0, autoSkip: true }, grid: { color: "#1a2740" } },
  };

  const lineCommon = {
    tension: 0.25,
    pointBackgroundColor: colors,
    pointBorderColor: colors,
  };

  if (type === "cardio") {
    datasets.push({
      ...lineCommon,
      label: "Minutter",
      data: points.map((p) => p.minutes),
      borderColor: "#38bdf8",
      backgroundColor: "rgba(56,189,248,0.15)",
      fill: true,
      pointRadius: 6, pointHoverRadius: 8,
      yAxisID: "y",
    });
    scales.y = { beginAtZero: true, ticks: { color: "#93a4c4" }, grid: { color: "#1a2740" } };
  } else if (type === "bodyweight") {
    datasets.push({
      ...lineCommon,
      label: "Maks reps",
      data: points.map((p) => p.maxReps),
      borderColor: "#f97316",
      backgroundColor: "rgba(249,115,22,0.15)",
      fill: true,
      pointRadius: 6, pointHoverRadius: 8,
      yAxisID: "y",
    });
    scales.y = { beginAtZero: true, ticks: { color: "#93a4c4" }, grid: { color: "#1a2740" } };
  } else {
    // strength: dual akse (kg + reps)
    datasets.push({
      ...lineCommon,
      label: "Maks vekt (kg)",
      data: points.map((p) => p.maxWeight),
      borderColor: "#38bdf8",
      backgroundColor: "rgba(56,189,248,0.15)",
      fill: true,
      pointRadius: 6, pointHoverRadius: 8,
      yAxisID: "y",
    });
    datasets.push({
      ...lineCommon,
      label: "Maks reps",
      data: points.map((p) => p.maxReps),
      borderColor: "#f97316",
      backgroundColor: "rgba(249,115,22,0.06)",
      fill: false,
      pointRadius: 5, pointHoverRadius: 7,
      yAxisID: "y1",
    });
    scales.y = {
      type: "linear", position: "left", beginAtZero: true,
      title: { display: true, text: "kg", color: "#38bdf8", font: { weight: "600" } },
      ticks: { color: "#93a4c4" }, grid: { color: "#1a2740" },
    };
    scales.y1 = {
      type: "linear", position: "right", beginAtZero: true,
      title: { display: true, text: "reps", color: "#f97316", font: { weight: "600" } },
      ticks: { color: "#93a4c4" }, grid: { drawOnChartArea: false },
    };
  }

  chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#c3cee2", font: { weight: "600" } } },
        tooltip: {
          callbacks: {
            afterLabel: (item) => {
              const e = points[item.dataIndex] && points[item.dataIndex].energy;
              return e ? "Dagsform: " + cap(e) : "";
            },
          },
        },
        lifeEvents: { events: lifeMarkers },
      },
      scales,
    },
  });
}

function drawTable(ex, entries, energyByDate = {}, commentByDate = {}) {
  const rows = entries.map((e) => {
    let summary;
    if (ex.type === "cardio") {
      const ent = e.entertainment ? ` · ${escapeHtml(e.entertainment)}` : "";
      summary = `${e.minutes ?? "–"} min${ent}`;
    } else {
      const sets = (e.sets || []).slice().sort((a, b) => a.position - b.position);
      if (!sets.length) summary = "–";
      else summary = sets.map((s) => `${s.weight != null ? s.weight + "kg×" : ""}${s.reps ?? "?"}`).join(", ");
    }
    const energy = energyByDate[e.performed_on];
    const dot = energy
      ? `<span class="energy-dot" style="background:${ENERGY_COLOR[energy]}" title="${cap(energy)}"></span>`
      : `<span class="energy-dot" style="background:${POINT_DEFAULT};opacity:.4"></span>`;
    const comment = commentByDate[e.performed_on];
    const commentHtml = comment ? `<div class="progress-comment">💬 ${escapeHtml(comment)}</div>` : "";
    return `<tr data-entry-id="${e.id}" data-date="${e.performed_on}"><td>${dot}${fmtDate(e.performed_on)}</td><td>${summary}${commentHtml}</td><td class="progress-del-cell"><button type="button" class="progress-del" aria-label="Slett oppføring">🗑</button></td></tr>`;
  }).join("");
  const legend =
    `<div class="energy-legend">` +
    `<span><i style="background:#22c55e"></i>Ok/Flott</span>` +
    `<span><i style="background:#f59e0b"></i>Slapp</span>` +
    `<span><i style="background:#ef4444"></i>Syk</span>` +
    `</div>`;
  const tableHtml =
    legend +
    `<table><thead><tr><th>Dato</th><th>Resultat</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  const wrap = $("#progress-table");
  wrap.innerHTML = tableHtml;
  wrap.querySelectorAll(".progress-del").forEach((btn) => {
    btn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const tr = btn.closest("tr");
      const entryId = tr.dataset.entryId;
      const date = tr.dataset.date;
      if (!confirm(`Slette ${ex.name} for ${fmtDate(date)}?`)) return;
      await deleteEntry(entryId, { silentReload: true });
      await renderProgress();
    });
  });
}

// ===================================================================
//  ØVELSER-fane
// ===================================================================
let newExType = "strength";
function wireExercises() {
  $("#new-ex-type").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      $("#new-ex-type").querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      newExType = b.dataset.type;
    });
  });
  $("#add-ex-btn").addEventListener("click", async () => {
    const name = $("#new-ex-name").value.trim();
    if (!name) return toast("Skriv inn et navn", true);
    const maxOrder = exercisesCache.reduce((m, e) => Math.max(m, e.sort_order || 0), 0);
    const { error } = await sb.from("exercises").insert({
      user_id: user.id, name, type: newExType, sort_order: maxOrder + 1,
    });
    if (error) return toast("Feil: " + error.message, true);
    $("#new-ex-name").value = "";
    await loadExercises();
    renderExerciseList();
    toast("La til «" + name + "» ✓");
  });
}

function renderExerciseList() {
  const box = $("#exercise-list");
  const list = activeExercises();
  if (!list.length) {
    box.innerHTML = '<div class="empty">Ingen øvelser enda.</div>';
    return;
  }
  box.innerHTML = "";
  let lastType = null;
  for (const ex of list) {
    if (ex.type !== lastType) {
      box.appendChild(el("div", "section-title", TYPE_LABEL[ex.type]));
      lastType = ex.type;
    }
    const item = el("div", "ex-item");
    item.innerHTML = `<div class="meta"><span>${escapeHtml(ex.name)}</span><small>${TYPE_LABEL[ex.type]}</small></div>`;
    const actions = el("div", "ex-actions");

    const rename = el("button", "rename", "Endre navn");
    rename.addEventListener("click", async () => {
      const newName = prompt(`Nytt navn på «${ex.name}»:`, ex.name);
      if (newName == null) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === ex.name) return;
      const { error } = await sb.from("exercises").update({ name: trimmed }).eq("id", ex.id);
      if (error) return toast("Feil: " + error.message, true);
      await loadExercises();
      renderExerciseList();
      toast(`Endret til «${trimmed}» ✓`);
    });
    actions.appendChild(rename);

    const arch = el("button", "archive", "Arkiver");
    arch.addEventListener("click", async () => {
      if (!confirm(`Arkivere «${ex.name}»? Gamle logger beholdes.`)) return;
      const { error } = await sb.from("exercises").update({ archived: true }).eq("id", ex.id);
      if (error) return toast("Feil: " + error.message, true);
      await loadExercises();
      renderExerciseList();
      toast("Arkivert");
    });
    actions.appendChild(arch);

    item.appendChild(actions);
    box.appendChild(item);
  }
}

// ===================================================================
//  Faner / navigasjon
// ===================================================================
function wireTabs() {
  $$(".tabbtn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tab = btn.dataset.tab;
      // Beskytt ulagrede endringer når man forlater Logg-fanen
      const leavingLog = !$("#tab-log").classList.contains("hidden");
      if (leavingLog && tab !== "log" && logDirty) {
        if (!confirm("Du har ulagrede endringer i økta. Forlate uten å lagre?")) return;
      }
      $$(".tabbtn").forEach((b) => b.classList.toggle("active", b === btn));
      $$(".tab").forEach((t) => t.classList.add("hidden"));
      show($("#tab-" + tab));
      if (tab === "log") { setLogDateIso(todayStr()); await renderLog(); }
      if (tab === "progress") await renderProgress();
      if (tab === "exercises") renderExerciseList();
    });
  });
}

function maybeRenderForDate(iso) {
  if (!iso || iso === renderedDate) return;
  if (logDirty) {
    if (!confirm("Du har ulagrede endringer for " + fmtDate(renderedDate) + ". Bytte dato og forkaste dem?")) {
      setLogDateIso(renderedDate); // angre datobyttet i visningen
      return;
    }
    clearDraft(renderedDate); // brukeren valgte å forkaste – da skal utkastet bort
  }
  renderLog();
}

function wireStaticUI() {
  wireAuth();
  wireTabs();
  wireExercises();
  wireSettings();

  $("#log-date").addEventListener("input", (e) => {
    const raw = e.target.value;
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    let formatted = digits;
    if (digits.length > 4) formatted = digits.slice(0, 2) + "." + digits.slice(2, 4) + "." + digits.slice(4);
    else if (digits.length > 2) formatted = digits.slice(0, 2) + "." + digits.slice(2);
    if (formatted !== raw) e.target.value = formatted;
    const iso = dmyToIso(formatted);
    $("#log-weekday").textContent = iso ? cap(weekdayName(iso)) : "";
    updateDateShortcuts(iso);
    if (!iso || iso === renderedDate) return;
    clearTimeout(dateDebounce);
    dateDebounce = setTimeout(() => maybeRenderForDate(iso), 350);
  });

  $("#date-prev").addEventListener("click", () => shiftLogDate(-1));
  $("#date-next").addEventListener("click", () => shiftLogDate(1));
  $("#date-today").addEventListener("click", () => jumpLogDate(todayStr()));
  $("#progress-exercise").addEventListener("change", renderProgress);

  // Ulagrede endringer i Logg-fanen: marker som «dirty» og speil til lokalt utkast.
  const logBox = $("#log-content");
  logBox.addEventListener("input", () => { logDirty = true; scheduleDraftSave(); });
  logBox.addEventListener("click", (e) => {
    if (e.target.closest(".add-set, .del, .clone-btn")) logDirty = true;
    // Klon er asynkron og lagrer utkastet selv når den er ferdig.
    if (e.target.closest(".add-set, .del")) scheduleDraftSave();
  });
  // Skriv utkastet med en gang siden går i bakgrunnen, lukkes eller refreshes.
  window.addEventListener("pagehide", flushDraft);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushDraft(); });

  // Setup-skjerm (fallback hvis Supabase-nøkler mangler i config.js)
  const setupSave = $("#setup-save");
  if (setupSave) setupSave.addEventListener("click", () => {
    const url = $("#setup-url").value.trim();
    const key = $("#setup-key").value.trim();
    if (!url || !key) { $("#setup-msg").textContent = "Fyll inn begge feltene."; $("#setup-msg").className = "auth-msg err"; return; }
    localStorage.setItem(LS.url, url);
    localStorage.setItem(LS.key, key);
    location.reload();
  });

  $("#logout-btn").addEventListener("click", async () => {
    if (sb) await sb.auth.signOut();
    location.reload();
  });
}

// ===================================================================
//  Innstillinger: eksport/backup, doge-bryter, oppdatering
// ===================================================================
function wireSettings() {
  $("#app-version").textContent = "v" + APP_VERSION;

  const dogeToggle = $("#toggle-doge");
  if (dogeToggle) {
    dogeToggle.checked = localStorage.getItem(LS.doge) !== "off";
    dogeToggle.addEventListener("change", () => {
      localStorage.setItem(LS.doge, dogeToggle.checked ? "on" : "off");
      if (dogeToggle.checked) praiseDoge();
    });
  }

  const expJson = $("#export-json");
  if (expJson) expJson.addEventListener("click", () => exportData("json"));
  const expCsv = $("#export-csv");
  if (expCsv) expCsv.addEventListener("click", () => exportData("csv"));

  const refresh = $("#refresh-app");
  if (refresh) refresh.addEventListener("click", refreshApp);
}

async function fetchAllData() {
  const [exercises, entries, sessions, sets] = await Promise.all([
    sb.from("exercises").select("*").eq("user_id", user.id),
    sb.from("entries").select("*").eq("user_id", user.id),
    sb.from("sessions").select("*").eq("user_id", user.id),
    sb.from("sets").select("*").eq("user_id", user.id),
  ]);
  return {
    exercises: exercises.data || [],
    entries: entries.data || [],
    sessions: sessions.data || [],
    sets: sets.data || [],
  };
}

function downloadBlob(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exportData(format) {
  try {
    toast("Henter data…");
    const data = await fetchAllData();
    if (format === "json") {
      const payload = { exported_at: new Date().toISOString(), version: APP_VERSION, ...data };
      downloadBlob(`treningslogg-${todayStr()}.json`, JSON.stringify(payload, null, 2), "application/json");
    } else {
      const exById = {}; data.exercises.forEach((e) => { exById[e.id] = e; });
      const energyByDate = {}; data.sessions.forEach((s) => { energyByDate[s.performed_on] = s.energy; });
      const setsByEntry = {}; data.sets.forEach((s) => { (setsByEntry[s.entry_id] = setsByEntry[s.entry_id] || []).push(s); });
      const rows = [["dato", "ukedag", "ovelse", "type", "dagsform", "kg", "reps", "minutter", "sa_pa"]];
      const entries = data.entries.slice().sort((a, b) => (a.performed_on < b.performed_on ? -1 : 1));
      for (const e of entries) {
        const ex = exById[e.exercise_id] || {};
        const energy = energyByDate[e.performed_on] || "";
        const wd = weekdayName(e.performed_on);
        if (ex.type === "cardio") {
          rows.push([e.performed_on, wd, ex.name || "", "kondisjon", energy, "", "", e.minutes ?? "", e.entertainment || ""]);
        } else {
          const ss = (setsByEntry[e.id] || []).slice().sort((a, b) => a.position - b.position);
          if (!ss.length) rows.push([e.performed_on, wd, ex.name || "", ex.type || "", energy, "", "", "", ""]);
          ss.forEach((s) => rows.push([e.performed_on, wd, ex.name || "", ex.type || "", energy, s.weight ?? "", s.reps ?? "", "", ""]));
        }
      }
      const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
      downloadBlob(`treningslogg-${todayStr()}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
    }
    toast("Lastet ned ✓");
  } catch (e) {
    console.error(e);
    toast("Eksport feilet: " + (e.message || e), true);
  }
}

async function refreshApp() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) { /* ignorer – vi laster på nytt uansett */ }
  location.reload();
}

// ===================================================================
//  Format / escaping
// ===================================================================
function parseLocal(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function weekdayName(iso) {
  try { return parseLocal(iso).toLocaleDateString("nb-NO", { weekday: "long" }); }
  catch { return ""; }
}
function fullDate(iso) {
  try { return parseLocal(iso).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" }); }
  catch { return iso; }
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  // Samme dekning som escapeHtml – trygt uansett hvilken HTML-kontekst
  // strengen havner i (attributt eller tekst).
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Start
init();
