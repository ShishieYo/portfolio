# Contact form backend (not currently used by the live site)

**Status:** the live contact form no longer calls this. After this backend's
Apps Script project got silently deleted once already, and a redeploy after
that still couldn't be verified end-to-end (this repo's dev environment has
no network path to `script.google.com` to test it), the form was switched to
a `mailto:` handoff — it opens the visitor's own email app with the message
pre-filled, with nothing server-side to deploy, misconfigure, or lose. See
`#contactForm` in `index.html` / the contact-form handler in `script.js`.

`Code.gs` is kept here as a reference and an optional upgrade path, in case
a real backend (e.g. for storing submissions, or sending from a fixed
address) is wanted again later. It used to live only in the Apps Script
editor with no copy anywhere else — that's why it was possible to lose it
entirely. It's committed here so that never happens again, whether or not
it's the live mechanism.

## Deploying (new project, e.g. after the old one was deleted)

1. Go to [script.google.com](https://script.google.com) → **New project**.
2. Replace the default `Code.gs` contents with this repo's `apps-script/Code.gs`.
3. Update the `NOTIFY_EMAIL` constant at the top if needed.
4. **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (required — the form posts anonymously; any
     other setting silently blocks real visitors while still looking like
     a success in the browser, since the form uses a fire-and-forget
     request and can't see what happened server-side)
5. Authorize the script when prompted (first deploy only).
6. Copy the `/exec` URL it gives you.
7. Update `<form id="contactForm" action="...">` in `index.html` with that URL.

## After any future edit to Code.gs

Editing the script does **not** update the live `/exec` URL by itself.
You must: **Deploy → Manage deployments → ✏️ (edit the existing deployment)
→ Version: New version → Deploy**. This is the single most common reason
a working contact form silently stops sending email.

## Debugging "form says success but no email arrives"

1. Open the Apps Script project → **Executions** (left sidebar). Submit the
   form once and look for a new `doPost` run.
   - No run appears at all → the request isn't reaching your code (check
     "Who has access" above, or that the URL in `index.html` is current).
   - A run appears with an error → that error is your root cause.
2. Visit the `/exec` URL directly in a browser (GET request) — it should
   return `{"ok":true,"message":"Contact form backend is live."}`. If it
   doesn't, the deployment itself is broken or deleted.
3. Check Gmail's spam/Promotions folder.
4. Check the Apps Script quota dashboard for the daily `MailApp` send limit.

The frontend (`script.js`) posts with `fetch(url, { mode: 'no-cors' })`
because Apps Script `/exec` endpoints don't return CORS headers browsers
accept — this means the browser shows "message sent" success as soon as
the request is *sent*, regardless of whether it actually reached a live
script or what that script did with it. The `Executions` log above is the
only reliable way to confirm delivery.
