# Hub

A one-screen dashboard of your day that installs on a phone like an app. It shows what's on now, what's next, a countdown, a day timeline, three progress rings, checklists, projects and links to your pages.

This repository holds only the app's code. Your schedule, projects and links live in a Google Doc in your own Google Drive, and your ticks and counters stay on your phone. Nothing personal belongs in this repository.

## Pages

- **Today**: the now card, countdown, timeline, rings, top 3, the day's plan, the 15-minute reset and what's coming up.
- **Projects**: counts by state, filters, and one card per project.
- **Pages**: tiles that open your one-pagers and documents.
- **Settings**: Google Drive, the "I'm home" music link, counters, theme and version.

## Run it on your PC

You need Node (nothing to install after that).

```
node tools/serve.mjs
```

Then open <http://localhost:5200/?demo=1>. The `?demo=1` flag loads the made-up content in `sample-content.json`, so you can try everything without signing in.

Other flags for testing:

- `?now=2026-11-10T14:50` fakes the clock, to see any time-based screen.
- `?demo=broken` breaks the content on purpose, to see the "couldn't read" warning.
- `?demo=local` reads a private file you pass to the server with `--content C:\path\to\file.txt`. That file is never part of this repository.

Run the tests with `node --test`. Redraw the icons with `node tools/make-icons.mjs`.

## How the content works

The app reads one Google Doc named `HUB_content` from the signed-in Google Drive (read-only access). The Doc's body is a single JSON object as plain text. `sample-content.json` shows every field:

- `name`, `headline`, `updated`
- `weekday`, `weekend`: lists of blocks with `start`, `end`, `title`, `detail` and `kind` (work, move, home, family, focus or free)
- `today`: an optional one-day override with a `date` and its own `blocks`
- `countdown`, `shutdown`: a `time` and which `days` (every, weekdays or weekends)
- `cleaning`, `home.checklist`, `home.musicUrl`, `boxes`
- `upcoming`, `projects`, `pages`

Edit the Doc and the app shows the change on its next sync. Missing keys hide their card, unknown keys are ignored, and if the JSON is broken the app keeps showing the last good copy with a warning.

## How it's built

Plain HTML, CSS and JavaScript modules with no framework and no build step. A service worker caches the app so it opens offline. The only outside script is Google's sign-in library.

| File | What it does |
| --- | --- |
| `app.js` | Startup, the four pages, sheets and taps |
| `content.js` | Cleans and checks the content file |
| `routines.js` | Now and next, countdown, shutdown, streak, box estimate |
| `drive.js` | Google sign-in and reading the Doc |
| `store.js` | Safe storage on the phone |
| `time.js` | Clock and date helpers |
| `icons.js` | Line icons |
| `sw.js` | Offline support |

## Releasing a change

Bump `APP_VERSION` in `config.js` and the cache name in `sw.js` to match, then push. Phones pick up the new version the next time the app opens while online.
