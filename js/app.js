// ---------------------------------------------------------------------------
// Daywise — UI wiring. No framework: plain ES modules + the store + ai.js.
// ---------------------------------------------------------------------------

import { initFirebase, fallbackPromptFor } from "./firebase-init.js";
import { createStore } from "./store.js";
import {
  createAI,
  createModels,
  runMoodLens,
  runReflect,
  runWeeklyInsight,
  prepareDeviceModel,
} from "./ai.js";
import { FIREBASE_CONFIGURED } from "./firebase-config.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const MOOD_LABELS = {
  joyful: "😄 Joyful", calm: "😌 Calm", grateful: "🙏 Grateful", hopeful: "🌱 Hopeful",
  tired: "😴 Tired", anxious: "😟 Anxious", sad: "😢 Sad", angry: "😠 Angry",
  overwhelmed: "😵 Overwhelmed", neutral: "😐 Neutral",
};

const ROUTE_KEY = "daywise.route.v1";
const CLOUD_INSIGHTS_KEY = "daywise.cloud-insights.v1";

const state = {
  firebase: null,
  store: null,
  ai: null,
  models: null,
  route: localStorage.getItem(ROUTE_KEY) || "auto",
  cloudInsights: localStorage.getItem(CLOUD_INSIGHTS_KEY) !== "false",
  entries: [],
  aiLog: [],
  deviceReady: false,
  selectedMood: "",
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
  });
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function logAiCall(task, result) {
  state.aiLog.unshift({
    task,
    path: result.path,
    detail: result.detail || "",
    latencyMs: result.latencyMs,
    at: Date.now(),
  });
  state.aiLog = state.aiLog.slice(0, 20);
  renderAiLog();
}

function pathBadge(path) {
  if (path === "on-device") return `<span class="ai-path on-device">● On-device · Gemini Nano</span>`;
  if (path === "cloud") return `<span class="ai-path cloud">● Cloud · Gemini</span>`;
  return `<span class="ai-path unknown">● ${esc(path)}</span>`;
}

// ---------------------------------------------------------------------------
// AI readiness
// ---------------------------------------------------------------------------
function ensureModels() {
  if (state.models) return state.models;
  if (!state.firebase.configured || !state.firebase.app) {
    throw new Error("Firebase is not configured yet. Connect Firebase first (see README).");
  }
  if (!state.ai) state.ai = createAI(state.firebase.app);
  state.models = createModels(state.ai, state.route);
  return state.models;
}

async function warmDeviceModel() {
  if (state.deviceReady || state.route === "cloud") return;
  const models = ensureModels();
  const wrap = $("#device-model-progress");
  const bar = $("#device-model-bar");
  const label = $("#device-model-label");
  wrap.hidden = false;
  try {
    await prepareDeviceModel(models.quick, (p) => {
      const pct = Math.round(p * 100);
      bar.style.width = pct + "%";
      label.textContent = `Preparing on-device model… ${pct}%`;
    });
    state.deviceReady = true;
    label.textContent = "On-device model ready ✓";
    setTimeout(() => { wrap.hidden = true; }, 1200);
  } catch (err) {
    label.textContent = "On-device model unavailable on this device — cloud fallback will be used.";
    console.warn("[Daywise] Device model warm-up failed:", err);
    setTimeout(() => { wrap.hidden = true; }, 2500);
  }
}

async function runAiGuarded(fn, button) {
  if (!FIREBASE_CONFIGURED) {
    toast("AI needs Firebase — connect it first (README → Connect Firebase).");
    openSettings();
    return null;
  }
  if (button) button.disabled = true;
  try {
    await warmDeviceModel();
    return await fn();
  } catch (err) {
    console.error("[Daywise] AI call failed:", err);
    toast("AI failed: " + (err.message || err));
    return null;
  } finally {
    if (button) button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Entries: render
// ---------------------------------------------------------------------------
function entryMatches(entry, q, moodFilter) {
  if (moodFilter) {
    const m = (entry.ai && entry.ai.mood) || entry.mood || "";
    if (m !== moodFilter) return false;
  }
  if (!q) return true;
  const hay = [entry.text, entry.ai?.summary || "", (entry.ai?.tags || []).join(" ")].join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}

function renderEntries() {
  const q = $("#search-input").value.trim();
  const moodFilter = $("#filter-mood").value;
  const list = state.entries.filter((e) => entryMatches(e, q, moodFilter));
  $("#count-badge").hidden = state.entries.length === 0;
  $("#count-badge").textContent = state.entries.length;
  $("#empty-journal").hidden = list.length !== 0 || state.entries.length !== 0;
  if (state.entries.length === 0) $("#empty-journal").hidden = false;

  $("#entries-list").innerHTML = list.map((entry) => {
    const mood = (entry.ai && entry.ai.mood) || entry.mood || "";
    const ai = entry.ai;
    const aiBox = ai ? `
      <div class="ai-box">
        <p><strong>AI summary</strong>${pathBadge(ai.path)} <span class="hint">${ai.latencyMs} ms</span></p>
        <p>${esc(ai.summary || "")}</p>
        <p class="hint">Mood: ${esc(MOOD_LABELS[ai.mood] || ai.mood || "—")} · Energy: ${esc(ai.energy ?? "—")}/5</p>
        ${ai.tags && ai.tags.length ? `<div class="ai-tags">${ai.tags.map((t) => `<span class="ai-tag">${esc(t)}</span>`).join("")}</div>` : ""}
      </div>` : "";
    const question = entry.question ? `
      <p class="entry-question"><strong>To sit with:</strong> “${esc(entry.question.text)}” ${pathBadge(entry.question.path)}</p>` : "";
    return `
      <article class="card entry-card" data-id="${esc(entry.id)}">
        <div class="entry-head">
          <span class="entry-date">${esc(fmtDate(entry.createdAtMs))} · ${esc(fmtTime(entry.createdAtMs))}</span>
          <span class="entry-mood">${mood ? esc(MOOD_LABELS[mood] || mood) : ""}</span>
        </div>
        <p class="entry-text clamped">${esc(entry.text)}</p>
        <button class="entry-toggle" type="button">Read more</button>
        ${aiBox}
        ${question}
        <div class="entry-actions">
          <button class="btn btn-understand" type="button" ${ai ? "disabled" : ""}>✨ Understand on-device</button>
          <button class="btn btn-reflect" type="button">💭 Ask a reflective question</button>
          <button class="btn btn-danger btn-delete" type="button">Delete</button>
        </div>
      </article>`;
  }).join("");

  // Wire per-card buttons (event delegation would also work; explicit is clearer).
  $$("#entries-list .entry-card").forEach((card) => {
    const id = card.dataset.id;
    const entry = state.entries.find((e) => e.id === id);
    if (!entry) return;
    const toggle = card.querySelector(".entry-toggle");
    const textEl = card.querySelector(".entry-text");
    toggle.addEventListener("click", () => {
      const clamped = textEl.classList.toggle("clamped");
      toggle.textContent = clamped ? "Read more" : "Show less";
    });
    if (entry.text.length < 220) toggle.hidden = true;
    const understandBtn = card.querySelector(".btn-understand");
    if (understandBtn) understandBtn.addEventListener("click", () => understandEntry(entry, understandBtn));
    card.querySelector(".btn-reflect").addEventListener("click", (ev) => reflectEntry(entry, ev.currentTarget));
    card.querySelector(".btn-delete").addEventListener("click", async () => {
      if (!confirm("Delete this entry? This cannot be undone.")) return;
      await state.store.deleteEntry(id);
      toast("Entry deleted.");
    });
  });
}

function renderInsights() {
  const now = new Date();
  const day = now.getDay() === 0 ? 6 : now.getDay() - 1; // Monday = 0
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).setHours(0, 0, 0, 0);
  const weekEntries = state.entries.filter((e) => e.createdAtMs >= weekStart);

  $("#stat-entries").textContent = weekEntries.length;
  $("#stat-words").textContent = weekEntries.reduce((n, e) => n + e.text.split(/\s+/).filter(Boolean).length, 0);

  // Streak: consecutive days (ending today or yesterday) with >= 1 entry.
  const days = new Set(state.entries.map((e) => new Date(e.createdAtMs).toDateString()));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toDateString())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  $("#stat-streak").textContent = streak;

  // Mood distribution this week (AI mood preferred, manual mood fallback).
  const counts = {};
  weekEntries.forEach((e) => {
    const m = (e.ai && e.ai.mood) || e.mood || "neutral";
    counts[m] = (counts[m] || 0) + 1;
  });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  $("#stat-top-mood").textContent = top ? (MOOD_LABELS[top[0]] || top[0]) : "—";
  const max = Math.max(1, ...Object.values(counts));
  $("#mood-bars").innerHTML = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([mood, count]) => `
      <div class="mood-bar-row">
        <span>${esc(MOOD_LABELS[mood] || mood)}</span>
        <div class="mood-bar-track"><div class="mood-bar-fill" style="width:${Math.round((count / max) * 100)}%"></div></div>
        <span>${count}</span>
      </div>`).join("") || `<p class="hint">No entries this week yet.</p>`;
}

function renderAiLog() {
  const ul = $("#ai-log");
  if (!state.aiLog.length) {
    ul.innerHTML = `<li class="ai-log-empty">No AI calls yet.</li>`;
    return;
  }
  ul.innerHTML = state.aiLog.map((c) => `
    <li><strong>${esc(c.task)}</strong> ${pathBadge(c.path)}
      <span class="hint">· ${c.latencyMs} ms · ${esc(fmtTime(c.at))}${c.detail ? " · " + esc(c.detail) : ""}</span>
    </li>`).join("");
}

// ---------------------------------------------------------------------------
// Entries: AI actions
// ---------------------------------------------------------------------------
async function understandEntry(entry, button) {
  const result = await runAiGuarded(async () => {
    const models = ensureModels();
    const out = await runMoodLens(models, entry.text);
    logAiCall("Mood lens", out);
    await state.store.updateEntry(entry.id, {
      ai: { ...out.data, path: out.path, latencyMs: out.latencyMs, at: Date.now() },
    });
    return out;
  }, button);
  if (result) toast(result.path === "on-device" ? "Understood on-device ✓ — nothing left this browser." : "Understood via cloud fallback.");
}

async function reflectEntry(entry, button) {
  const result = await runAiGuarded(async () => {
    const models = ensureModels();
    const out = await runReflect(models, entry.text);
    logAiCall("Reflective question", out);
    await state.store.updateEntry(entry.id, {
      question: { text: out.text, path: out.path, latencyMs: out.latencyMs, at: Date.now() },
    });
    return out;
  }, button);
  if (result) toast("A question to sit with — see the entry card.");
}

async function generateWeekly(button) {
  if (!state.cloudInsights) {
    toast("Weekly insights are off in Settings (cloud insights disabled).");
    return;
  }
  const weekStart = (() => {
    const now = new Date();
    const day = now.getDay() === 0 ? 6 : now.getDay() - 1;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).setHours(0, 0, 0, 0);
  })();
  const withSummary = state.entries.filter((e) => e.createdAtMs >= weekStart && e.ai && e.ai.summary);
  if (!withSummary.length) {
    toast("No on-device summaries this week yet — run “Understand” on an entry first.");
    return;
  }
  const result = await runAiGuarded(async () => {
    const models = ensureModels();
    const lines = withSummary.map((e) => {
      const d = new Date(e.createdAtMs).toLocaleDateString(undefined, { weekday: "short" });
      return `${d} · mood: ${e.ai.mood || "?"}, energy ${e.ai.energy ?? "?"} · ${e.ai.summary}`;
    });
    const box = $("#weekly-result");
    box.innerHTML = `<p class="streaming-caret">Thinking…</p>`;
    const out = await runWeeklyInsight(models, lines, (full) => {
      box.innerHTML = `<p class="streaming-caret">${esc(full)}</p>`;
    });
    box.innerHTML = `<p>${esc(out.text)}</p>`;
    $("#weekly-meta").textContent =
      `Based on ${withSummary.length} on-device summar${withSummary.length === 1 ? "y" : "ies"} · ${out.latencyMs} ms`;
    logAiCall("Weekly insight", out);
    return out;
  }, button);
  if (result) {
    toast(result.path === "cloud" ? "Weekly insight ready — built from summaries only." : "Weekly insight ready — built on-device.");
  } else {
    // runAiGuarded already toasted the error; don't leave "Thinking…" stuck.
    $("#weekly-result").innerHTML = `<p>The model is busy right now — please try again in a bit.</p>`;
  }
}

// ---------------------------------------------------------------------------
// Views / settings / composer
// ---------------------------------------------------------------------------
function switchView(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  if (name === "insights") renderInsights();
}

function openSettings() {
  updateSettingsStatus();
  $("#settings-modal").hidden = false;
}
function closeSettings() { $("#settings-modal").hidden = true; }

function updateSettingsStatus() {
  const fb = state.firebase || {};
  $("#st-config").textContent = fb.configured
    ? `Configured · project ${fb.app?.options?.projectId || ""}`
    : "Not configured (demo mode — see README)";
  $("#st-auth").textContent = fb.uid
    ? `Anonymous sign-in ✓ · uid ${String(fb.uid).slice(0, 10)}…`
    : fb.authError ? `Failed: ${fb.authError}` : "Not signed in";
  $("#st-appcheck").textContent = fb.appCheck || "—";
  const lm = window.LanguageModel;
  $("#st-device").textContent = !lm
    ? "Not available in this browser (needs Chrome 139+ on desktop)"
    : "Checking… (open DevTools console or run an AI action to see availability)";
  if (lm && typeof lm.availability === "function") {
    lm.availability().then((a) => {
      $("#st-device").textContent = `Gemini Nano: ${a} (Chrome Prompt API)`;
    }).catch(() => {
      $("#st-device").textContent = "Availability check failed";
    });
  }
}

function applyRoute(route) {
  state.route = route;
  localStorage.setItem(ROUTE_KEY, route);
  state.models = null; // rebuild with the new routing on next AI call
  state.deviceReady = false;
}

async function saveEntry(understand) {
  const text = $("#entry-text").value.trim();
  if (!text) { toast("Write something first — even one honest sentence."); return; }
  const id = await state.store.addEntry({ text, mood: state.selectedMood });
  $("#entry-text").value = "";
  $("#char-count").textContent = "0 / 5000";
  $$(".mood-chip").forEach((c) => c.classList.remove("selected"));
  state.selectedMood = "";
  toast("Entry saved.");
  switchView("journal");
  if (understand) {
    const entry = state.store.getEntries().find((e) => e.id === id);
    if (entry) await understandEntry(entry, null);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  // Tabs
  $$(".tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));

  // Composer
  $("#entry-text").addEventListener("input", (e) => {
    $("#char-count").textContent = `${e.target.value.length} / 5000`;
  });
  $$(".mood-chip").forEach((chip) => chip.addEventListener("click", () => {
    const was = chip.classList.contains("selected");
    $$(".mood-chip").forEach((c) => c.classList.remove("selected"));
    state.selectedMood = was ? "" : chip.dataset.mood;
    if (!was) chip.classList.add("selected");
  }));
  $("#btn-save").addEventListener("click", () => saveEntry(false));
  $("#btn-save-ai").addEventListener("click", () => saveEntry(true));

  // Journal filters
  $("#search-input").addEventListener("input", renderEntries);
  $("#filter-mood").addEventListener("change", renderEntries);

  // Insights
  $("#btn-weekly").addEventListener("click", (e) => generateWeekly(e.currentTarget));

  // Settings
  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-close-settings").addEventListener("click", closeSettings);
  $("#settings-modal").addEventListener("click", (e) => {
    if (e.target.id === "settings-modal") closeSettings();
  });
  $("#btn-setup-how").addEventListener("click", openSettings);
  $$('input[name="inference-mode"]').forEach((r) => {
    r.checked = r.value === state.route;
    r.addEventListener("change", () => { applyRoute(r.value); toast(`Inference mode: ${r.value}.`); });
  });
  const cloudToggle = $("#opt-cloud-insights");
  cloudToggle.checked = state.cloudInsights;
  cloudToggle.addEventListener("change", () => {
    state.cloudInsights = cloudToggle.checked;
    localStorage.setItem(CLOUD_INSIGHTS_KEY, String(state.cloudInsights));
  });
  $("#btn-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.entries, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `daywise-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Entries exported.");
  });
  $("#btn-erase").addEventListener("click", async () => {
    if (!confirm("Erase ALL entries? This cannot be undone.")) return;
    await state.store.eraseAll();
    toast("All entries erased.");
  });

  // Firebase (guarded — works unconfigured)
  const fb = await initFirebase();
  state.firebase = fb;

  // Status pills + banner
  const aiPill = $("#ai-status");
  const syncPill = $("#sync-status");
  if (!fb.configured) {
    $("#setup-banner").hidden = false;
    aiPill.textContent = "AI: demo mode — connect Firebase";
    aiPill.className = "pill pill-warn";
    syncPill.textContent = "Storage: this browser";
  } else {
    syncPill.textContent = fb.uid ? "Storage: Firestore" : "Storage: this browser (auth failed)";
    syncPill.className = "pill " + (fb.uid ? "pill-ok" : "pill-warn");
    aiPill.textContent = "AI: ready — checking on-device model…";
    aiPill.className = "pill pill-ok";
    if (window.LanguageModel && typeof window.LanguageModel.availability === "function") {
      window.LanguageModel.availability().then((a) => {
        aiPill.textContent = a === "available"
          ? "AI: on-device ready (Gemini Nano)"
          : `AI: cloud ready (on-device: ${a})`;
      }).catch(() => { aiPill.textContent = "AI: cloud ready"; });
    } else {
      aiPill.textContent = "AI: cloud ready (no on-device API here)";
    }
  }

  // Prompt of the day
  $("#daily-prompt").textContent = fb.dailyPrompt || fallbackPromptFor();
  $("#prompt-source").textContent = fb.configured
    ? fb.promptSource + (fb.remoteConfigError ? " · Remote Config fetch failed, using built-in prompt" : "")
    : "Built-in prompt · Remote Config will replace this once Firebase is connected.";

  // Store + render
  state.store = createStore(fb);
  state.store.subscribe((entries) => {
    state.entries = entries;
    renderEntries();
    if ($("#view-insights").classList.contains("active")) renderInsights();
  });
  await state.store.start();
  renderAiLog();
}

boot().catch((err) => {
  console.error("[Daywise] Boot failed:", err);
  const el = $("#toast");
  el.textContent = "Something went wrong starting Daywise: " + err.message;
  el.hidden = false;
});
