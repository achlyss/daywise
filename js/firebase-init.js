// ---------------------------------------------------------------------------
// Daywise — Firebase initialization (guarded: safe to run unconfigured)
// ---------------------------------------------------------------------------
// Initializes, in order: Firebase App, App Check (debug provider on
// localhost), Anonymous Auth, Firestore, Remote Config.
// Every step is guarded: if Firebase is not configured, or a product is not
// enabled in the console, initFirebase() resolves with { configured: false }
// (or partial services) instead of throwing, and the UI explains what to do.
// ---------------------------------------------------------------------------

import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getRemoteConfig, fetchAndActivate, getString, getBoolean } from "firebase/remote-config";
import { firebaseConfig, FIREBASE_CONFIGURED, APP_CHECK_CONFIGURED } from "./firebase-config.js";

export const REMOTE_CONFIG_DEFAULTS = {
  daily_prompt: "What is one small thing that went right today?",
  cloud_insights_enabled: true,
};

const FALLBACK_PROMPTS = [
  "What is one small thing that went right today?",
  "What are you carrying right now that you could set down, even for an hour?",
  "Describe a moment today when you felt most like yourself.",
  "What is something you learned about yourself this week?",
  "If today had a title, what would it be — and why?",
  "What would you tell a friend who had a day exactly like yours?",
  "Name one thing you are looking forward to, however small.",
];

export function fallbackPromptFor(date = new Date()) {
  // Deterministic prompt of the day, so every visitor sees the same one.
  const day = Math.floor(date.getTime() / 86400000);
  return FALLBACK_PROMPTS[((day % FALLBACK_PROMPTS.length) + FALLBACK_PROMPTS.length) % FALLBACK_PROMPTS.length];
}

/**
 * Initialize Firebase. Never throws: returns a status object describing
 * exactly which services are live, so the UI can be honest about it.
 */
export async function initFirebase() {
  const status = {
    configured: FIREBASE_CONFIGURED,
    app: null,
    auth: null,
    db: null,
    remoteConfig: null,
    uid: null,
    appCheck: "not-configured",
    authError: null,
    remoteConfigError: null,
    dailyPrompt: fallbackPromptFor(),
    promptSource: "Built-in prompt",
    cloudInsightsEnabled: true,
  };

  if (!FIREBASE_CONFIGURED) {
    console.info("[Daywise] Firebase not configured — running in local demo mode.");
    return status;
  }

  const app = initializeApp(firebaseConfig);
  status.app = app;

  // --- App Check -----------------------------------------------------------
  // Required by Firebase AI Logic. On localhost we enable the debug provider
  // (the debug token is printed in the devtools console on first run; it must
  // be safelisted in the Firebase console to work).
  try {
    if (APP_CHECK_CONFIGURED) {
      if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(firebaseConfig.appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
      status.appCheck = "enabled";
    } else {
      status.appCheck = "skipped-no-site-key";
      console.warn(
        "[Daywise] App Check site key not set — App Check skipped. " +
          "AI Logic calls may be rejected while App Check is enforced. " +
          "Add appCheckSiteKey in js/firebase-config.js (see README)."
      );
    }
  } catch (err) {
    status.appCheck = "error: " + err.message;
    console.warn("[Daywise] App Check init failed:", err);
  }

  // --- Anonymous Auth ------------------------------------------------------
  // No email, no password: journaling stays private by design, and each
  // device gets its own anonymous identity whose entries live under
  // users/{uid}/entries in Firestore.
  try {
    const auth = getAuth(app);
    status.auth = auth;
    await signInAnonymously(auth);
    onAuthStateChanged(auth, (user) => {
      status.uid = user ? user.uid : null;
    });
    status.uid = auth.currentUser ? auth.currentUser.uid : null;
  } catch (err) {
    status.authError = err.message;
    console.warn("[Daywise] Anonymous sign-in failed (is it enabled in the console?):", err);
  }

  // --- Firestore -----------------------------------------------------------
  try {
    status.db = getFirestore(app);
  } catch (err) {
    console.warn("[Daywise] Firestore init failed:", err);
  }

  // --- Remote Config -------------------------------------------------------
  // Daily prompt + the cloud-insights feature flag. Falls back to built-in
  // defaults (and a local prompt rotation) when RC is unavailable.
  try {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = 3600000;
    rc.defaultConfig = REMOTE_CONFIG_DEFAULTS;
    await fetchAndActivate(rc);
    status.remoteConfig = rc;
    const prompt = getString(rc, "daily_prompt").trim();
    if (prompt) {
      status.dailyPrompt = prompt;
      status.promptSource = "Remote Config · daily_prompt";
    }
    status.cloudInsightsEnabled = getBoolean(rc, "cloud_insights_enabled");
  } catch (err) {
    status.remoteConfigError = err.message;
    console.warn("[Daywise] Remote Config fetch failed, using defaults:", err);
  }

  return status;
}
