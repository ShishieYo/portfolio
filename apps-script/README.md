# Contact form backend

`Code.gs` is the Google Apps Script backend behind the contact form on the
live site (`index.html` → `#contactForm`). It used to live only in the Apps
Script editor with no copy anywhere else — that's why it was possible to
lose it entirely. It's committed here now so that never happens again.

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
