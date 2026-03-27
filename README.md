# Realtime Quiz (Kahoot-like) — Firebase Realtime Database (No Server)

Simple real-time quiz web app with **Host** + **Player** roles using **Firebase Realtime Database** + **Anonymous Auth**. Deployable to **GitHub Pages** or **Firebase Hosting**.

## Features

- **Room PIN** creation by host (6 digits)
- **Players join** via PIN or **QR code**
- **Lobby** shows player count in real-time
- **Questions**: 4 options (A–D), single submission enforced
- **Host dashboard**: answers submitted count + live bar chart
- **Timer per question** (default 15s)
- **Reveal correct answer** after timer ends
- **Leaderboard**: +100 for correct, optional speed bonus
- **Duplicate name prevention** (per room)
- **Reset game** (host)

## Tech

- Frontend: HTML + CSS + Vanilla JS
- Backend: Firebase Realtime Database + Firebase Auth (anonymous)
- Charts: Chart.js (CDN)
- QR: QRious (CDN)

---

## 1) Create Firebase project

1. Go to Firebase Console and create a project.
2. Create a **Realtime Database** (start in test mode for quick demo, then apply rules below).
3. Enable **Authentication → Sign-in method → Anonymous**.

## 2) Add a Web App and copy config

1. Firebase Console → Project settings → Your apps → **Web app**.
2. Copy the firebase config object (apiKey, authDomain, databaseURL, projectId, appId, etc.).
3. Paste it into:
   - `public/js/firebase-config.js` (create it from the template below).

Create `public/js/firebase-config.js`:

```js
// public/js/firebase-config.js
export const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_DOMAIN",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_BUCKET",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
```

## 3) Firebase Realtime Database rules

Apply the rules in `database.rules.json` from this repo.

Notes:
- This is a **demo-friendly** ruleset (still not “production hard”). For production, you’d add stronger anti-abuse (rate limits via Cloud Functions, host claims, etc.).
- The rules also help with **anti-spam** by enforcing **write-once per question** for answers.

## 4) Run locally

Because this app uses ES modules, use a local static server:

- VS Code/Cursor “Live Server”, or
- any static server (e.g. `npx serve public`).

Then open:
- `public/index.html`

## 5) Deploy

### Option A: GitHub Pages (recommended simplest)

1. Push the repository to GitHub.
2. In repo settings → Pages:
   - Source: **Deploy from a branch**
   - Branch: `main` and folder `/public` (or move `public/*` to root and select `/root`)
3. Ensure `public/js/firebase-config.js` is committed **without secrets** (Firebase web config is not a secret, but keep rules strict).

### Option B: Firebase Hosting

1. Install Firebase CLI and login.
2. In the repo root:
   - `firebase init hosting`
   - Set **public directory** to `public`
   - SPA: **No**
3. Deploy:
   - `firebase deploy`

---

## Usage

### Host

Open `public/host.html` → Create room → Share PIN/QR → Start quiz → Next → Reset as needed.

### Player

Open `public/index.html` or `public/player.html` → Enter name + PIN → Answer on phone.

---

## Performance notes (300 users)

- **Optimized host reads**: host listens to small nodes (`meta`, `public/playerCount`, `agg/{q}`, `top5`), not the full `answers/{q}` fan-out.
- **Optimized player reads**: each player listens to only `meta` + their own `players/{uid}/score` (+ optional echo of their own answer).
- **Spam-click protection**:
  - client-side click cooldown + immediate disabling after submit
  - DB rules enforce **only one answer write** per player per question


