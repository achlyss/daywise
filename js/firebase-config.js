// ---------------------------------------------------------------------------
// Daywise — Firebase configuration
// ---------------------------------------------------------------------------
// HOW TO CONNECT FIREBASE (do this in your own copy, never commit real keys
// to a public repo — see README.md, section "Connect Firebase"):
//   1. Create a project at https://console.firebase.google.com
//   2. In the console: AI Services > AI Logic > Get started, choose the
//      "Gemini Developer API" provider (free tier, no billing needed).
//   3. Enable: Authentication > Anonymous sign-in; Firestore Database;
//      Remote Config; App Check (reCAPTCHA Enterprise for web).
//   4. Register this web app and paste its config object below, replacing
//      every "YOUR_..." placeholder.
//   5. (Local dev only) Register your App Check debug token in the console:
//      Security > App Check > Apps > Manage debug tokens. The token is
//      printed in the browser devtools console on first run.
//
// Until this file is filled in, Daywise runs in LOCAL DEMO MODE: journaling
// works fully (entries stored in this browser), AI features show what they
// need instead of failing silently.
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
  // Optional: reCAPTCHA Enterprise site key for App Check. If left as a
  // placeholder, App Check is skipped and the app tells you so.
  appCheckSiteKey: "YOUR_RECAPTCHA_SITE_KEY",
};

// True only when every required field has been replaced with a real value.
export const FIREBASE_CONFIGURED = Object.entries(firebaseConfig)
  .filter(([key]) => key !== "appCheckSiteKey")
  .every(([, value]) => typeof value === "string" && value.length > 0 && !value.startsWith("YOUR_"));

export const APP_CHECK_CONFIGURED =
  typeof firebaseConfig.appCheckSiteKey === "string" &&
  firebaseConfig.appCheckSiteKey.length > 0 &&
  !firebaseConfig.appCheckSiteKey.startsWith("YOUR_");
