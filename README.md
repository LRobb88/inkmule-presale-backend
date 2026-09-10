# InkMule Pre-Sale Form Handler

A tiny self-hosted backend for the pre-sale store request form. It accepts
the form's multipart POST and emails you each submission with the uploaded
**store logo** and **product file** attached.

Sends mail over **plain SMTP** (via Nodemailer) instead of the SendGrid Web
API — no SendGrid account, verified sender, or credits required. Works with
Gmail / Google Workspace (App Password), Microsoft 365, or any other SMTP
provider.

No third-party form service, no per-file size caps beyond `MAX_FILE_MB`, no
monthly submission limits.

## What's here

- `server.js` — Express app: `POST /submit` (multipart) → emails you.
- `package.json` — dependencies (`express`, `multer`, `nodemailer`, `cors`).
- `.env.example` — the environment variables to set.

## Deploy to Railway

1. Push these files to this repo (already done if you're reading this on GitHub).
2. In Railway, the existing service auto-redeploys on push to `main` — or
   trigger a manual redeploy from the service's **Deployments** tab.
3. Under the service's **Variables**, replace the old `SENDGRID_API_KEY`
   with the SMTP variables from `.env.example` (real values):
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
   - `MAIL_TO`, `MAIL_FROM`
   - You can delete `SENDGRID_API_KEY` — it's no longer used.
4. **Gmail / Google Workspace users:** `SMTP_PASS` must be an **App
   Password**, not the mailbox's normal login password. Turn on 2-Step
   Verification for the account, then generate one at
   https://myaccount.google.com/apppasswords and paste it in as `SMTP_PASS`.
5. Visit `https://<your-service>.up.railway.app/diag` after deploying — it
   sends a real test email and reports back the exact SMTP error if
   anything's still misconfigured (never exposes the password).

That's it — submissions will email to `MAIL_TO` with attachments, and the
customer's email is set as the reply-to.

## Notes

- **CORS:** the form calls this service via a `POST` from `inkmule.com`, so
  the form's origin must be listed in `ALLOWED_ORIGIN`. Both `www` and bare
  domain are included in the example.
- **File size:** `MAX_FILE_MB` (default 20) caps each uploaded file. Raise
  it if you expect large AI/EPS art files; most mailboxes cap total message
  size around 25 MB regardless.
- **Reply-to:** replies to the notification go straight to the person who
  submitted the form.
- **Honeypot:** a hidden `_gotcha` field silently drops bot spam.
- **Deliverability:** sending "From" the same address you authenticate as
  (`MAIL_FROM` = `SMTP_USER`) avoids spoofing/SPF issues. If you ever want
  to send from a different address than the mailbox you're authenticating
  with, that address needs to be an authorized "Send As" alias on the SMTP
  account, or messages may get flagged as spam or rejected outright.

## Run locally (optional)

```bash
npm install
cp .env.example .env   # fill in real values
npm start              # POST http://localhost:3000/submit
```
