import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Chart from "https://esm.sh/chart.js@4.4.3/auto";

// ===================================================================
//  Oppsett / tilstand
// ===================================================================
const LS = {
  url: "sb_url",
  key: "sb_key",
};

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
}
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }
function num(v) {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
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

  sb.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      user = null;
      hide($("#app"));
      show($("#auth-screen"));
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
  // Forhåndsutfyll e-post hvis satt i config.js
  const defEmail = window.APP_CONFIG && window.APP_CONFIG.DEFAULT_EMAIL;
  if (defEmail && !$("#auth-email").value) $("#auth-email").value = defEmail;

  $("#auth-send").addEventListener("click", async () => {
    const email = $("#auth-email").value.trim();
    if (!email) return authMsg("Skriv inn e-post.", true);
    setBtnLoading($("#auth-send"), true, "Sender…");
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    setBtnLoading($("#auth-send"), false, "Send engangskode");
    if (error) return authMsg(error.message, true);
    pendingEmail = email;
    hide($("#auth-step-email"));
    show($("#auth-step-code"));
    authMsg("Vi sendte en 6-sifret kode til " + email + ".");
  });

  $("#auth-verify").addEventListener("click", async () => {
    const token = $("#auth-code").value.trim();
    if (!token) return authMsg("Skriv inn koden fra e-posten.", true);
    setBtnLoading($("#auth-verify"), true, "Logger inn…");
    const { data, error } = await sb.auth.verifyOtp({ email: pendingEmail, token, type: "email" });
    setBtnLoading($("#auth-verify"), false, "Logg inn");
    if (error) return authMsg(error.message, true);
    authMsg("");
    await onLoggedIn(data.user);
  });

  $("#auth-back").addEventListener("click", () => {
    show($("#auth-step-email"));
    hide($("#auth-step-code"));
    authMsg("");
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

  // Hent dagens oppføringer + sett
  const { data: entries } = await sb
    .from("entries")
    .select("*, sets(*)")
    .eq("user_id", user.id)
    .eq("performed_on", date);
  const byEx = {};
  (entries || []).forEach((e) => { byEx[e.exercise_id] = e; });

  // Forslag til underholdning (tidligere tekster)
  const suggestions = await entertainmentSuggestions();

  // Dagsform for denne datoen
  const session = await loadSession(date);

  box.innerHTML = "";
  box.appendChild(buildDayCard(date, session));

  let lastType = null;
  for (const ex of list) {
    if (ex.type !== lastType) {
      box.appendChild(el("div", "section-title", TYPE_LABEL[ex.type].split(" · ")[0]));
      lastType = ex.type;
    }
    box.appendChild(buildExerciseCard(ex, byEx[ex.id], suggestions));
  }

  // Lagre-knapp
  const bar = el("div", "savebar");
  const btn = el("button", "primary", "Lagre økt");
  btn.id = "save-session";
  btn.addEventListener("click", saveSession);
  bar.appendChild(btn);
  box.appendChild(bar);
}

function buildDayCard(date, session) {
  const card = el("div", "card day-card");
  const head = el("div", "day-head");
  head.innerHTML =
    `<div class="weekday">${cap(weekdayName(date))}</div>` +
    `<div class="muted">${fullDate(date)}</div>`;
  card.appendChild(head);

  card.appendChild(el("div", "energy-label", "Dagsform"));
  const picker = el("div", "energy-picker");
  ENERGY.forEach(([val, label, emoji]) => {
    const b = el("button", "energy-btn" + (session && session.energy === val ? " active" : ""),
      `<span class="emoji">${emoji}</span>${label}`);
    b.type = "button";
    b.dataset.energy = val;
    b.addEventListener("click", () => {
      const wasActive = b.classList.contains("active");
      picker.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      if (!wasActive) b.classList.add("active"); // trykk igjen for å fjerne valg
    });
    picker.appendChild(b);
  });
  card.appendChild(picker);

  const cloneBtn = el("button", "clone-btn", "📋 Klon forrige trening");
  cloneBtn.type = "button";
  cloneBtn.addEventListener("click", cloneLastSession);
  card.appendChild(cloneBtn);

  return card;
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
  toast(cloned ? `Klonet fra ${fmtDate(lastDate)} ✓` : "Fant ingen aktive øvelser å klone");
}

function buildExerciseCard(ex, entry, suggestions) {
  const card = el("div", "ex-card");
  card.dataset.exId = ex.id;
  card.dataset.exType = ex.type;

  const head = el("div", "ex-head");
  head.appendChild(el("span", "name", ex.name));
  const saved = entry ? '<span class="ex-saved-tag">● lagret</span>' : "";
  head.insertAdjacentHTML("beforeend", `<span class="badge">${badgeText(ex.type)} ${saved}</span>`);
  card.appendChild(head);

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
    // Dagsform / energinivå
    const energyBtn = document.querySelector(".energy-btn.active");
    const energy = energyBtn ? energyBtn.dataset.energy : null;
    if (energy) await upsertSession(date, energy);

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
        await sb.from("sets").delete().eq("entry_id", entry.id);
        await sb.from("sets").insert(
          sets.map((s) => ({ user_id: user.id, entry_id: entry.id, ...s }))
        );
        savedCount++;
      }
    }
    setBtnLoading(btn, false, "Lagre økt");
    if (savedCount === 0 && !energy) toast("Ingenting å lagre – fyll inn noe først", true);
    else if (savedCount === 0) { toast("Dagsform lagret ✓"); await renderLog(); }
    else { toast("Lagret " + savedCount + " øvelse" + (savedCount > 1 ? "r" : "") + " ✓"); await renderLog(); }
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

async function upsertSession(date, energy) {
  const { error } = await sb
    .from("sessions")
    .upsert({ user_id: user.id, performed_on: date, energy }, { onConflict: "user_id,performed_on" });
  if (error) throw error;
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
const METRICS = {
  cardio: [["minutes", "Minutter"]],
  strength: [["maxWeight", "Maks vekt (kg)"], ["volume", "Volum (kg)"], ["maxReps", "Maks reps"]],
  bodyweight: [["totalReps", "Totalt reps"], ["maxReps", "Maks reps"], ["volume", "Volum (kg)"]],
};

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

function fillMetricOptions(type) {
  const sel = $("#progress-metric");
  const metrics = METRICS[type] || METRICS.strength;
  if (type === "cardio") { hide(sel); }
  else { show(sel); }
  sel.innerHTML = metrics.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
}

async function renderProgress() {
  const withData = await fillProgressExercises();
  const sel = $("#progress-exercise");
  if (!sel.value && withData[0]) sel.value = withData[0].id;
  const ex = exercisesCache.find((e) => e.id === sel.value);
  if (!ex) {
    hide($("#progress-metric"));
    if (chart) { chart.destroy(); chart = null; }
    $("#progress-chart").getContext("2d").clearRect(0, 0, $("#progress-chart").width, $("#progress-chart").height);
    $("#progress-table").innerHTML = '<div class="empty">Ingen øvelser med logger enda. Lagre minst én økt først.</div>';
    return;
  }
  fillMetricOptions(ex.type);
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

  // Dagsform for disse datoene (gir farge på punktene)
  const dates = entries.map((e) => e.performed_on);
  const energyByDate = await loadEnergyMap(dates);

  const metric = ex.type === "cardio" ? "minutes" : ($("#progress-metric").value || METRICS[ex.type][0][0]);
  const points = entries.map((e) => ({
    date: e.performed_on,
    value: metricValue(ex.type, metric, e),
    energy: energyByDate[e.performed_on] || null,
  }));

  drawChart(points, metricLabel(ex.type, metric));
  drawTable(ex, entries.slice().reverse(), energyByDate);
}

function metricValue(type, metric, e) {
  if (type === "cardio") return e.minutes || 0;
  const sets = e.sets || [];
  const weights = sets.map((s) => s.weight || 0);
  const reps = sets.map((s) => s.reps || 0);
  switch (metric) {
    case "maxWeight": return weights.length ? Math.max(...weights) : 0;
    case "maxReps": return reps.length ? Math.max(...reps) : 0;
    case "totalReps": return reps.reduce((a, b) => a + b, 0);
    case "volume": return sets.reduce((a, s) => a + (s.weight || 0) * (s.reps || 0), 0);
    default: return 0;
  }
}
function metricLabel(type, metric) {
  const all = METRICS[type] || [];
  const f = all.find(([v]) => v === metric);
  return f ? f[1] : "Verdi";
}

async function loadEnergyMap(dates) {
  const map = {};
  if (!dates.length) return map;
  const { data } = await sb
    .from("sessions")
    .select("performed_on, energy")
    .eq("user_id", user.id)
    .in("performed_on", dates);
  (data || []).forEach((s) => { if (s.energy) map[s.performed_on] = s.energy; });
  return map;
}

function drawChart(points, label) {
  const ctx = $("#progress-chart").getContext("2d");
  if (chart) chart.destroy();
  const colors = points.map((p) => (p.energy && ENERGY_COLOR[p.energy]) || POINT_DEFAULT);
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: points.map((p) => fmtDate(p.date)),
      datasets: [{
        label,
        data: points.map((p) => p.value),
        borderColor: "#38bdf8",
        backgroundColor: "rgba(56,189,248,0.15)",
        fill: true,
        tension: 0.25,
        pointRadius: 6,
        pointHoverRadius: 8,
        pointBackgroundColor: colors,
        pointBorderColor: colors,
      }],
    },
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
      },
      scales: {
        x: { ticks: { color: "#93a4c4", maxRotation: 0, autoSkip: true }, grid: { color: "#1a2740" } },
        y: { beginAtZero: true, ticks: { color: "#93a4c4" }, grid: { color: "#1a2740" } },
      },
    },
  });
}

function drawTable(ex, entries, energyByDate = {}) {
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
    return `<tr><td>${dot}${fmtDate(e.performed_on)}</td><td>${summary}</td></tr>`;
  }).join("");
  const legend =
    `<div class="energy-legend">` +
    `<span><i style="background:#22c55e"></i>Ok/Flott</span>` +
    `<span><i style="background:#f59e0b"></i>Slapp</span>` +
    `<span><i style="background:#ef4444"></i>Syk</span>` +
    `</div>`;
  $("#progress-table").innerHTML =
    legend +
    `<table><thead><tr><th>Dato</th><th>Resultat</th></tr></thead><tbody>${rows}</tbody></table>`;
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
      $$(".tabbtn").forEach((b) => b.classList.toggle("active", b === btn));
      $$(".tab").forEach((t) => t.classList.add("hidden"));
      show($("#tab-" + tab));
      if (tab === "log") { setLogDateIso(todayStr()); await renderLog(); }
      if (tab === "progress") await renderProgress();
      if (tab === "exercises") renderExerciseList();
    });
  });
}

function wireStaticUI() {
  wireAuth();
  wireTabs();
  wireExercises();

  $("#log-date").addEventListener("input", (e) => {
    const raw = e.target.value;
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    let formatted = digits;
    if (digits.length > 4) formatted = digits.slice(0, 2) + "." + digits.slice(2, 4) + "." + digits.slice(4);
    else if (digits.length > 2) formatted = digits.slice(0, 2) + "." + digits.slice(2);
    if (formatted !== raw) e.target.value = formatted;
    const iso = dmyToIso(formatted);
    $("#log-weekday").textContent = iso ? cap(weekdayName(iso)) : "";
    if (iso) renderLog();
  });
  $("#progress-exercise").addEventListener("change", renderProgress);
  $("#progress-metric").addEventListener("change", renderProgress);

  // Setup-skjerm
  $("#setup-save").addEventListener("click", () => {
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
  return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Start
init();
