# Inbound email → course request: setup

This feature lets clients email a course request instead of logging into the
Organization Portal. It's code-complete and deployed, but **won't do anything
until the two manual steps below are done** — I can't create third-party
accounts or click through dashboards on your behalf.

Until both are done, the webhook route safely returns "not configured"
(HTTP 503) and nothing breaks.

## What you're setting up

- A Resend-managed inbound address (something like `abc123@xyz789.resend.app`)
  that clients email their request to. No DNS changes — this is the
  zero-setup option we agreed on for staging.
- A webhook in your Resend dashboard that tells the server "an email arrived."
- Two new secrets on the server: `RESEND_WEBHOOK_SECRET` and `ANTHROPIC_API_KEY`.

## Step 1 — Enable receiving in Resend

1. Log into [resend.com](https://resend.com) (the same account already used
   for outbound email — `RESEND_API_KEY` is already configured on the server).
2. In the left sidebar, find **Receiving** (sometimes called **Inbound**).
3. If you don't already have a domain set up for receiving, use the
   **Resend-managed address** option — it gives you an address like
   `something@<random-id>.resend.app` immediately, no DNS record needed.
4. Copy that address down — that's what you'll give test clients to email.

## Step 2 — Create the webhook

1. In the Resend dashboard, go to **Webhooks** → **Add Webhook**.
2. **Endpoint URL**: `https://stagecprapp.kpbc.ca/api/v1/inbound-email/webhook`
3. **Events to send**: check only `email.received`.
4. Save it. Resend will show you a **signing secret** starting with `whsec_` —
   copy the whole thing, you'll only see it once (you can regenerate it later
   if you lose it).

## Step 3 — Add the two secrets to the server

The backend reads these from environment variables, the same way it already
reads `RESEND_API_KEY`.

1. Log into cPanel for the staging site.
2. Open **Setup Node.js App**.
3. Click on the staging app (the one running `stagecprapp.kpbc.ca`).
4. Under **Environment Variables**, add:
   - `RESEND_WEBHOOK_SECRET` = the `whsec_...` value from Step 2
   - `ANTHROPIC_API_KEY` = your existing Anthropic API key
5. Click **Save**, then **Restart** the app (or touch `tmp/restart.txt` the
   usual way — see the Deployment Guide).

## Step 4 — Test it

Send an email to the Resend-managed address from Step 1, in this format:

```
Subject: Course Request

Course: CPR-C
Date: 2026-11-15
Students: 10
Location: 123 Main St, Toronto
```

**Important**: the sender's email address has to match an existing
Organization Portal login for this to work — the system matches by sender
address, the same identity as the portal login, to make sure a request can't
be spoofed by an unknown address. Send the test from an org contact's real
email, not a personal one.

- If everything matches (known sender, valid date, real course type), the
  request appears automatically in **Course Admin → Instructor Management →
  Pending Course Requests**, tagged **"via email."**
- If the sender isn't recognized, or a detail couldn't be confidently read,
  it lands in the new **Course Admin → Email Requests** screen instead, with
  the raw email and the system's best guess at each field, so a human can
  follow up.

## What clients should be told

Give clients this exact format to use (freeform emails will still work if you
add the Anthropic key — the system falls back to reading them with AI — but
the fixed format is faster and never needs a human to double-check it):

```
Course: <course name, e.g. CPR-C>
Date: <YYYY-MM-DD>
Students: <number>
Location: <address>
```
