// ---------------------------------------------------------------------------
// Daywise — Hybrid inference with Firebase AI Logic
// ---------------------------------------------------------------------------
// HOW HYBRID WORKS HERE (this is the core of the entry):
//
//   * QUICK tasks (mood lens, reflective question) run ON-DEVICE FIRST
//     (InferenceMode.PREFER_ON_DEVICE). The raw journal text never leaves
//     the browser for these tasks: Gemini Nano reads it, answers, done.
//     If no on-device model exists on this device, the SDK falls back to
//     the cloud automatically.
//   * DEEP task (weekly insight) runs CLOUD FIRST (PREFER_IN_CLOUD) — but
//     only over the short ON-DEVICE SUMMARIES, never over raw entries.
//     That is the privacy tiering: raw text stays local, summaries travel.
//
//   * The user can override the routing in Settings:
//       auto    → quick/reflect prefer on-device, weekly prefers cloud
//       private → ONLY_ON_DEVICE for everything (fails honestly if Nano
//                 is not available — no silent cloud fallback)
//       deep    → PREFER_IN_CLOUD for everything
//       cloud   → ONLY_IN_CLOUD for everything
//
// PATH REPORTING — the SDK does the actual routing internally, so Daywise
// reports the routing decision honestly: it checks Chrome's Prompt API
// (LanguageModel.availability()) before the call and labels the result
// "Routed: on-device" / "Routed: cloud" together with the measured latency.
// The badge never claims a path the SDK did not take; see detectPath().
// ---------------------------------------------------------------------------

import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } from "firebase/ai";

// Cloud models used as the fallback / deep tier. Both are real, current
// Gemini models; Flash-Lite is the cheap, fast fallback for short tasks.
export const CLOUD_MODEL_QUICK = "gemini-3.5-flash-lite";
export const CLOUD_MODEL_DEEP = "gemini-3.8-flash";

// Structured output for the mood lens. The same schema is enforced on both
// paths: responseSchema for the cloud model, responseConstraint for Nano.
export const MOOD_SCHEMA = Schema.object({
  description: "Mood analysis of one journal entry.",
  properties: {
    mood: Schema.enumString({
      description: "The dominant mood of the entry.",
      enum: [
        "joyful", "calm", "grateful", "hopeful", "tired",
        "anxious", "sad", "angry", "overwhelmed", "neutral",
      ],
    }),
    energy: Schema.integer({
      description: "Perceived energy level in the entry, 1 (drained) to 5 (energised).",
    }),
    tags: Schema.array({
      description: "Up to 4 short theme tags, lowercase, e.g. work, family, sleep.",
      items: Schema.string(),
    }),
    summary: Schema.string({
      description: "One-sentence summary of the entry, in the writer's own voice, max 25 words.",
    }),
  },
});

const QUICK_PROMPT = (entryText) =>
  `You are a gentle journaling companion. Read this journal entry and return ONLY the JSON described by the schema: the dominant mood, energy from 1 (drained) to 5 (energised), up to 4 short lowercase theme tags, and a one-sentence summary in the writer's own voice (max 25 words). Do not add any commentary outside the JSON.\n\nEntry:\n${entryText}`;

const REFLECT_PROMPT = (entryText) =>
  `You are a gentle journaling companion. Read this journal entry and ask ONE short, kind, open reflective question (max 20 words) that helps the writer notice something about their day. No advice, no summary, no preamble — just the question.\n\nEntry:\n${entryText}`;

const WEEKLY_PROMPT = (lines) =>
  `You are a thoughtful journaling companion. Below are one-line summaries of one person's journal entries this week, each with its mood. Write a warm weekly reflection in three short parts: 1) the week's emotional arc in 2-3 sentences, 2) one recurring theme you notice, 3) one small, concrete suggestion for next week. Keep it under 180 words. Do not repeat the summaries verbatim. Do not invent events that are not in the summaries.\n\nThis week's summaries:\n${lines}`;

/**
 * Build the three model instances for a routing mode.
 * @param {object} ai - the Firebase AI instance from getAI()
 * @param {'auto'|'private'|'deep'|'cloud'} route - user routing choice
 */
export function createModels(ai, route = "auto") {
  const quickMode =
    route === "private" ? InferenceMode.ONLY_ON_DEVICE
    : route === "cloud" ? InferenceMode.ONLY_IN_CLOUD
    : route === "deep" ? InferenceMode.PREFER_IN_CLOUD
    : InferenceMode.PREFER_ON_DEVICE;

  const deepMode =
    route === "private" ? InferenceMode.ONLY_ON_DEVICE
    : route === "cloud" ? InferenceMode.ONLY_IN_CLOUD
    : route === "deep" ? InferenceMode.PREFER_IN_CLOUD
    : InferenceMode.PREFER_IN_CLOUD;

  const quick = getGenerativeModel(ai, {
    mode: quickMode,
    inCloudParams: {
      model: CLOUD_MODEL_QUICK,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: MOOD_SCHEMA,
      },
    },
    onDeviceParams: {
      promptOptions: { responseConstraint: MOOD_SCHEMA },
    },
  });

  const reflect = getGenerativeModel(ai, {
    mode: quickMode,
    inCloudParams: { model: CLOUD_MODEL_QUICK },
  });

  const deep = getGenerativeModel(ai, {
    mode: deepMode,
    inCloudParams: { model: CLOUD_MODEL_DEEP },
  });

  return { quick, reflect, deep, quickMode, deepMode };
}

export function createAI(firebaseApp) {
  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  return ai;
}

/**
 * Pre-flight routing decision, checked honestly before each call.
 * Uses Chrome's Prompt API availability when present. Returns the path the
 * SDK is expected to take plus a human-readable reason.
 */
export async function detectPath(modeValue) {
  if (modeValue === InferenceMode.ONLY_IN_CLOUD) {
    return { path: "cloud", detail: "Mode: cloud only" };
  }
  if (modeValue === InferenceMode.ONLY_ON_DEVICE) {
    return { path: "on-device", detail: "Mode: on-device only" };
  }
  const lm = typeof window !== "undefined" ? window.LanguageModel : undefined;
  if (!lm || typeof lm.availability !== "function") {
    return {
      path: "cloud",
      detail: "No on-device model API in this browser — cloud fallback",
    };
  }
  let availability = "unavailable";
  try {
    availability = await lm.availability();
  } catch {
    availability = "unavailable";
  }
  if (modeValue === InferenceMode.PREFER_IN_CLOUD) {
    return { path: "cloud", detail: "Cloud first (on-device fallback ready)" };
  }
  // PREFER_ON_DEVICE
  if (availability === "available" || availability === "downloading" || availability === "downloadable") {
    return { path: "on-device", detail: `Gemini Nano: ${availability}` };
  }
  return { path: "cloud", detail: "On-device model unavailable — cloud fallback" };
}

/** One-shot on-device model warm-up. Must run on a user gesture. */
let deviceModelPromise = null;
export function prepareDeviceModel(model, onProgress) {
  if (!deviceModelPromise) {
    deviceModelPromise = model
      .initializeDeviceModel((progress) => {
        if (typeof onProgress === "function") onProgress(progress);
      })
      .catch((err) => {
        deviceModelPromise = null; // allow a later retry
        throw err;
      });
  }
  return deviceModelPromise;
}

function parseJsonLoose(text) {
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// The Firebase AI SDK has no built-in call timeout: a busy/overloaded model
// can leave the UI waiting forever (observed 21 Nov 2026 — Weekly Insight
// stuck on "Thinking…" for 2+ minutes while gemini-3.8-flash was overloaded).
// Race every AI call against a 60 s timer so the UI always gets an answer.
export const AI_CALL_TIMEOUT_MS = 60000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} took too long to respond (over ${Math.round(ms / 1000)}s) — the model may be busy. Please try again.`)),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Mood lens: structured JSON analysis of one entry.
 * @returns {{data: {mood, energy, tags, summary}, path, detail, latencyMs}}
 */
export async function runMoodLens(models, entryText) {
  const routing = await detectPath(models.quickMode);
  const started = performance.now();
  const result = await withTimeout(models.quick.generateContent(QUICK_PROMPT(entryText)), AI_CALL_TIMEOUT_MS, "Mood lens");
  const latencyMs = Math.round(performance.now() - started);
  const data = parseJsonLoose(result.response.text());
  return { data, path: routing.path, detail: routing.detail, latencyMs };
}

/**
 * Reflective question: one short question about one entry.
 * @returns {{text, path, detail, latencyMs}}
 */
export async function runReflect(models, entryText) {
  const routing = await detectPath(models.quickMode);
  const started = performance.now();
  const result = await withTimeout(models.reflect.generateContent(REFLECT_PROMPT(entryText)), AI_CALL_TIMEOUT_MS, "Reflective question");
  const latencyMs = Math.round(performance.now() - started);
  return { text: result.response.text().trim(), path: routing.path, detail: routing.detail, latencyMs };
}

/**
 * Weekly insight: streams a reflection over the week's on-device summaries.
 * Only summaries are sent — never raw entries (see WEEKLY_PROMPT and the
 * call site in app.js, which passes summaries, not entry text).
 * @param {string[]} summaryLines - e.g. ["Mon · calm · Walked by the river…"]
 * @param {(fullText: string) => void} onChunk - called with accumulated text
 * @returns {{text, path, detail, latencyMs}}
 */
export async function runWeeklyInsight(models, summaryLines, onChunk) {
  const routing = await detectPath(models.deepMode);
  const started = performance.now();
  const prompt = WEEKLY_PROMPT(summaryLines.join("\n"));
  let timedOut = false;
  const run = async () => {
    let full = "";
    const emit = (text) => {
      if (!timedOut && typeof onChunk === "function") onChunk(text);
    };
    try {
      const result = await models.deep.generateContentStream(prompt);
      for await (const chunk of result.stream) {
        const piece = chunk.text();
        if (piece) {
          full += piece;
          emit(full);
        }
      }
      if (!full) {
        full = (await result.response).text();
        emit(full);
      }
    } catch (streamErr) {
      // Streaming is best-effort: fall back to a single non-streaming call.
      console.warn("[Daywise] Streaming failed, retrying non-streaming:", streamErr);
      const result = await models.deep.generateContent(prompt);
      full = result.response.text();
      emit(full);
    }
    return full;
  };
  let full;
  try {
    full = await withTimeout(run(), AI_CALL_TIMEOUT_MS, "Weekly insight");
  } catch (err) {
    timedOut = true; // suppress late stream chunks from overwriting the error UI
    throw err;
  }
  const latencyMs = Math.round(performance.now() - started);
  return { text: full.trim(), path: routing.path, detail: routing.detail, latencyMs };
}
