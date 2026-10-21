# Kairos landing page

Static HTML/CSS/JS marketing site. No build step: open `index.html` directly or serve this folder with any static server. Deployed on Vercel from `main` with Root Directory `landing`, preset Other, no build command. Keep it that way: `index.html` at the root of this folder, every asset relative, no bundler. The one exception is `go/`, which uses root-relative paths (`/styles.css`) because it is also served at `/go/<placement>`. Preview it through a static server, not by opening the file.

## Files

- `index.html` — hero (headline + the product page with margin notes), the app in use, "keep the weekend", the grade-math example, how you get started, privacy and what Kairos won't do, early access, footer.
- `styles.css` — the Notebook design system (`design-system/kairos/MASTER.md`), mirrored from `app/src/styles.css` + `app/src/notebook.css` so the site looks like the app. Light by default; dark follows the visitor's system setting.
- `app.js` — draws the margin notes and marker swipe in once as they scroll into view (skipped under reduced motion), handles the early-access form, turns on the download button when `config.js` has a release, and shows phones a link to `/go`.
- `config.js` — the launch switches: `downloadUrl` (null until a real `.dmg` exists), `downloadNote`, `contactEmail`, `sourceUrl` (the public GitHub repository). Edit this file, not the pages, when something goes live.
- `funnel.js` — device detection (phone, tablet including an iPad posing as a Mac, Mac, Windows, Chromebook, Linux) and placement parsing. Plain functions; `marketing/test/` runs them in Node.
- `go/` — where every QR code and NFC tag lands (`/go` and `/go/<placement>`). A phone gets "Send it to my Mac" (Web Share, so AirDrop or Messages to yourself; copy-link and email-yourself fallbacks). A Mac gets the download or early access. Other computers get a waitlist. `?as=phone|mac|windows` previews each. Codes are made in `marketing/`.
- `vercel.json` — one rewrite: `/go/:placement` serves `go/index.html`.
- `fonts/` — Gabarito and Caveat (OFL, licenses alongside), self-hosted so the page makes no third-party requests. The Big Shoulders files are left over from an earlier pass and unused.

## Rules this page follows

- Show, don't tell: the product UI is built from real components with a sample student's week, not a screenshot mockup made of boxes.
- No school is named in the copy. Kairos works for any school on Canvas.
- No social proof that isn't real. No invented testimonials, avatars, logos, user counts, or AI-generated "students" (FTC 2024 rule on fake reviews and testimonials). When real beta students record clips or give quotes with permission, add them as their own section below the app band.
- One CTA label for one intent: "Get early access".
- Copy: no em-dashes, no buzzwords, hero subtext of 20 words or fewer.

## Analytics

Both pages load Vercel Web Analytics from `/_vercel/insights/script.js`. It's served from the site's own domain, sets no cookies, and records page views with path and device type. It's off until someone enables Analytics in the Vercel project; until then the script 404s and nothing is collected. The free tier has no custom events or UTM parameters. That's why placements live in the path: `/go/hoodie` viewed on mobile is a scan, and on desktop it's someone who made it to their Mac.

## Email capture

There is no backend. Submitting builds a `mailto:` link to `config.js`'s `contactEmail` with the visitor's address in the body and opens their own mail client; the status line says nothing was sent yet. If you switch to a Tally or Google Form, change the form's `action`/handler in `app.js` and update the status copy so the page never claims to have saved something it didn't.

## Before a real launch

- Replace the panorama line art in the "weekend" section with real hand-drawn assets (Open Peeps / Open Doodles are CC0 and match the line style) or real footage (Pexels / Mixkit, free license).
- The access section intentionally keeps the `.dmg` button disabled until a signed, fresh-machine-tested artifact exists. When that gate is met, set `downloadUrl` (and `downloadNote`) in `config.js`. That one change turns on the main page's button, rewrites its access copy, and switches `/go`'s Mac view from early access to the download.
- The source button and the footer Source link use `sourceUrl` in `config.js`. They go straight to the public repository. The page still says the signed Mac download is the path for most people.
