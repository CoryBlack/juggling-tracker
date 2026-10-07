# Juggling Log

A personal training tracker for juggling and freestyle skills: log what you practice during
a session, track goal/set progress with one tap, and build a long-term record of how each
trick is progressing. No backend, no App Store — it's a static web app you install to your
phone's home screen (PWA), and it stores your data in a private GitHub repo via the GitHub
API.

## How storage works

- Your training data lives in `data.json` inside a **private** GitHub repo you create (kept
  separate from this app's code repo, which has to stay public for free GitHub Pages).
- The app talks to that repo directly from your phone's browser using a **fine-grained
  personal access token** scoped only to that one repo. The token is stored only in the
  browser's local storage — it's never sent anywhere except `api.github.com`.
- A local cache (also in the browser) means the app loads instantly and still works offline;
  it syncs to GitHub in the background and retries automatically once you're back online.
- Every save is a git commit, so your training history has a full version log for free.

## One-time setup

### 1. Create two repos on GitHub

- **App repo** (public) — e.g. `juggling-tracker`. This hosts the app itself via GitHub Pages.
- **Data repo** (private) — e.g. `juggling-data`. This holds nothing but your `data.json`;
  the app creates that file automatically on first sync.

### 2. Push this code to the app repo, enable Pages

```bash
cd JugglingTracker
git init
git add .
git commit -m "Initial juggling tracker"
git branch -M main
git remote add origin https://github.com/<you>/juggling-tracker.git
git push -u origin main
```

Then in the app repo on GitHub: **Settings → Pages → Source: Deploy from branch → main → /(root)**.
Your app will be live at `https://<you>.github.io/juggling-tracker/` within a minute or two.

### 3. Create a fine-grained personal access token

Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
→ Generate new token**.

- Resource owner: your account
- Repository access: **Only select repositories** → pick your `juggling-data` repo
- Permissions: **Contents → Read and write**
- Generate, and copy the token (starts with `github_pat_…`) — you won't see it again.

### 4. Install the app on your phone

Open the Pages URL in Safari/Chrome → Share → **Add to Home Screen**. It'll launch
full-screen, no browser UI, like a real app.

### 5. Connect it to your data repo

Open the app → tap the ⚙︎ settings icon → fill in:

- GitHub username
- Data repo name (`juggling-data`)
- Branch (`main`)
- The token from step 3

Tap **Save**. The sync dot at the top turns green once it's connected.

## Using it

Four tabs, always available:

- **Train** (home screen): start a practice, add any number of tricks to it, and log each
  one — a best result, an optional target × desired-sets goal with one-tap set tracking, and
  freeform notes. Tap **Finish Practice** when done to review a summary and save.
- **Priorities**: the skills you're currently focused on, in order, each showing when you
  last practiced it and its personal best/recent best. Tap one to see full progress or jump
  straight into training it.
- **Progress**: search any trick in your library to see its personal best and full
  chronological training history — "what have my last several sessions looked like?"
- **History**: every saved practice session, newest first. Tap one to see everything you
  trained that day.
- **Settings** (gear icon): manage GitHub sync, your trick library (name, category,
  measurement unit, archive), the category list, and export a raw JSON backup.

The Train tab is sticky: once you've started a practice, switching to Priorities, Progress,
or History to check past work never loses it — tap Train again and you're right back where
you left off. The in-progress session is also saved to the browser after every change, so if
the app gets reloaded or killed in the background, reopening it restores the session exactly
as you left it instead of starting you over.

### Measurement units

Tricks aren't hard-coded to "catches" — when you create a trick you pick what it's measured
in (catches, reps, seconds, successful attempts, rounds, or a custom unit you type yourself).
Personal bests are computed automatically from your history whenever appropriate — you never
have to separately maintain a "PB" value.

## Notes / limitations

- This is intentionally single-user and low-ceremony — no accounts, no server.
- If you ever edit data from two devices while offline at the same time, the second sync
  will detect the conflict, pull the latest from GitHub, and ask you to redo your last
  change rather than silently overwriting anything.
- Archiving a trick hides it from pickers but keeps all of its historical data intact —
  nothing is ever deleted except by your explicit action (deleting a practice).
