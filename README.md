# Daywise — a private journal that thinks on-device first

> **Built for #BuildHybridAI 2026** (Firebase AI Logic hybrid inference).
> Web · Chrome · Firebase AI Logic · Free to use.

Daywise is a daily journal with a privacy-first twist: **short reflections are
understood on-device with Gemini Nano, and the cloud only ever sees
short on-device summaries — never your raw words.**

Most journaling apps upload everything you write. Daywise does the opposite:

1. **On-device first.** Mood, tags, a one-line summary and a reflective
   question are computed by Gemini Nano *in the browser* (Chrome 139+).
   The raw text of your entry never leaves the device for these tasks.
   Private, instant, and free — it even works offline.
2. **Cloud only for the big picture.** The weekly insight is generated in
   the cloud (Gemini 2.5 Flash) — but only from the short on-device
   summaries. Your raw entries never travel.
3. **You choose the routing.** Settings → Inference mode: Auto
   (on-device first, cloud fallback), Private (on-device only, fails
   honestly if Nano is unavailable), Deep (cloud first), or Cloud only.
   Every AI result shows a badge — *On-device · Gemini Nano* or
   *Cloud · Gemini* — with the measured latency, and the Insights tab logs
   every AI call Daywise makes.

## Features

- **Today** — prompt of the day (Remote Config, with a built-in rotation
  fallback), a distraction-free composer, optional mood picker, and
  *Save & understand on-device* (structured mood lens: mood, energy 1–5,
  tags, one-line summary).
- **Journal** — all entries, searchable, filterable by mood; per-entry AI
  summary card and a reflective question (“To sit with…”).
- **Insights** — this week's stats (entries, streak, top mood, words),
  mood distribution, a streaming **weekly insight**, and a transparent
  **AI activity log**.
- **Settings** — inference-mode switch, cloud-insights toggle, Firebase
  status, export entries as JSON, erase everything.

## Tech — what runs where

| Piece | Technology |
|---|---|
| Hybrid inference | Firebase AI Logic JS SDK (`firebase/ai`, v13.4.0): `getGenerativeModel` with `InferenceMode.PREFER_ON_DEVICE` / `ONLY_ON_DEVICE` / `PREFER_IN_CLOUD` / `ONLY_IN_CLOUD`; `initializeDeviceModel()` on first user gesture; structured output via `Schema` (cloud: `responseSchema`, on-device: `responseConstraint`); streaming via `generateContentStream` |
| Cloud models | `gemini-3.5-flash-lite` (short-task fallback; `gemini-2.5-flash-lite` retired by Google 21 Nov 2026, 404 for new users) · `gemini-3.8-flash` (weekly insight; `gemini-2.5-flash` retired by Google 21 Nov 2026, 404 for new users) |
| On-device model | Gemini Nano via Chrome's Prompt API (Chrome 139+ on desktop) |
| Auth | Firebase Auth — anonymous sign-in (no email, no password) |
| Data | Cloud Firestore (`users/{uid}/entries`); localStorage fallback in demo mode |
| Config | Firebase Remote Config (`daily_prompt`, `cloud_insights_enabled`) |
| Protection | Firebase App Check (reCAPTCHA Enterprise; debug provider on localhost) |
| Frontend | No build step, no framework — plain ES modules + an import map pinned to Firebase JS SDK 13.4.0 from the Google CDN |

**Why hybrid, architecturally:** the routing is not cosmetic. Short,
sensitive tasks (understanding *your* words) are privacy-tiered to the
device; long, aggregate tasks (patterns across a week) go to the cloud —
and they can only see summaries the device already produced. If the device
has no on-device model, the SDK falls back to the cloud and the badge says
so. Nothing is faked: the badge reflects a pre-flight availability check
(`LanguageModel.availability()`) plus the chosen mode.

## Run it locally

```bash
# Any static server works. From the project folder:
python3 -m http.server 8000
# then open http://localhost:8000
```

No build, no `npm install`, no API keys needed to look around: without a
Firebase config the app runs in **local demo mode** — journaling works
fully (entries in this browser's localStorage) and a banner explains that
AI features need Firebase. With a config, the full hybrid experience is
live.

> **Chrome note:** on-device inference needs Chrome 139+ on desktop, with
> the flag `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`
> set to **Enabled** (then restart Chrome). The first on-device request
> downloads the Gemini Nano model in the background; Daywise shows the
> download progress. If Nano is not available, Daywise falls back to the
> cloud and says so.

## Connect Firebase (required for AI)

1. Create a project at <https://console.firebase.google.com> (any Google
   account; the free Spark plan is enough — text inference with AI Logic
   is free within usage limits).
2. In the console: **AI Services → AI Logic → Get started**. Choose the
   **Gemini Developer API** provider (no billing needed).
3. Enable the supporting products:
   - **Authentication → Sign-in method → Anonymous** → Enable.
   - **Firestore Database** → Create database (production mode is fine;
     add rules so users can only read/write their own `users/{uid}/…`
     documents — see `firestore.rules.example` below).
   - **Remote Config** → create the parameters `daily_prompt` (string)
     and `cloud_insights_enabled` (boolean). Both are optional — the app
     has built-in defaults.
   - **App Check** → register this web app with **reCAPTCHA Enterprise**
     and copy the site key. (AI Logic enforces App Check; the hackathon
     accepts debug tokens for submissions.)
4. Register this web app in **Project settings → Your apps → Web app**,
   copy the `firebaseConfig` object, and paste it into
   `js/firebase-config.js` (replacing every `YOUR_…` placeholder,
   including `appCheckSiteKey`).
5. **Local dev only:** run the app once from `localhost`, open DevTools →
   Console, copy the printed **App Check debug token**, and safelist it in
   the console under **Security → App Check → Apps → Manage debug
   tokens**.
6. Reload. The banner disappears, the status pill reads “AI: on-device
   ready” (or “cloud ready”), and the AI buttons work.

**Do NOT commit your filled-in `js/firebase-config.js` to the public
repo** — the contest forbids production API keys in the repository. Keep
the placeholder values in the repo; use the real config only in your
local copy and in the Hosting deploy. (Firebase web `apiKey` is a public
client identifier, but the rule is the rule.)

### Firestore rules (example)

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/entries/{entryId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Deploy (Firebase Hosting — optional, recommended for judging)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # choose this folder; when asked, say NO to overwriting index.html
firebase deploy --only hosting
```

The hosted URL is the “project URL” for the Devpost submission. The
deployed copy is the one that carries your real `firebase-config.js`
(the repo keeps the placeholders).

## Project structure

```
index.html            App shell + Firebase import map (SDK 13.4.0)
css/styles.css        Warm paper theme, responsive, no external fonts
js/firebase-config.js Firebase config — PLACEHOLDERS in the repo
js/firebase-init.js   Guarded init: App, App Check, Auth, Firestore, Remote Config
js/ai.js              Hybrid inference: 3 model instances, routing, structured
                      output (Schema), streaming weekly insight, path detection
js/store.js           Entries store — Firestore when live, localStorage in demo mode
js/app.js             UI wiring: composer, journal, insights, settings, AI log
firebase.json         Firebase Hosting config
DEMO-SCRIPT.md        3-minute demo video script
LICENSE               Apache License 2.0
```

## Demo video

Script: [`DEMO-SCRIPT.md`](DEMO-SCRIPT.md) (≤ 3 minutes, English).
Record in Chrome 139+ with the on-device model downloaded, so the
*On-device · Gemini Nano* badge is visible on camera.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
