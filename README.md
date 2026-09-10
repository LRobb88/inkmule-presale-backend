# InkMule Pre-Sale Form Handler

A tiny self-hosted backend for the pre-sale store request form. It accepts
the form's multipart POST and emails you each submission with the uploaded
**store logo** and **product file** attached.

Sends mail via the **Resend HTTPS API** (https://resend.com) — not SMTP,
and not SendGrid. Two reasons:

- **Railway blocks outbound SMTP** (ports 465/587) on Free/Trial/Hobby
  plans — only HTTPS-based transactional email services work there
  (Railway's own docs point to Resend, SendGrid, Mailgun, or Postmark).
- SendGrid on the free/downgraded plan was hitting its send-credit ceiling
  ("Maximum credits exceeded"), so this moves off SendGrid entirely.

Resend's free tier is 3,000 emails/month (100/day), no credit card
required — plenty for a pre-sale request form.

No third-party form service, no per-file size caps beyond `MAX_FILE_MB`, no
monthly submission limits beyond Resend's own.

## What's here

- `server.js` — Express app: `POST /submit` (multipart) → emails you.
- `package.json` — dependencies (`express`, `multer`, `resend`, `cors`).
- `.env.example` — the environment variables to set.

## Deploy to Railway

1. Push these files to this repo (already done if you're reading this on GitHub).
2. Sign up at https://resend.com (free, no card needed).
3. **Verify your domain:** in the Resend dashboard, go to **Domains → Add
   Domain**, enter `inkmule.com`, and add the DNS records it gives you
   (TXT/DKIM, and an MX record) wherever `inkmule.com`'s DNS is managed.
   This can take a few minutes to a few hours to verify. Until it's
   verified, Resend will only let you send test emails to your own Resend
   account address — real submissions to `contact@inkmule.com` won't go
   through yet.
4. Create an API key at https://resend.com/api-keys.
5. In Railway, under the service's **Variables**:
   - Remove `SENDGRID_API_KEY` / `SMTP_*` variables — no longer used.
   - Add `RESEND_API_KEY` (from step 4), `MAIL_TO`, and `MAIL_FROM`
     (see `.env.example`).
6. Railway auto-redeploys on push / variable changes. Once it's up, visit
   `https://<your-service>.up.railway.app/diag` — it sends a real test
   email and reports back the exact error if anything's still
   misconfigured (never exposes the API key). It fails within ~10 seconds
   rather than hanging.

That's it — submissions will email to `MAIL_TO` with attachments, and the
customer's email is set as the reply-to.

## Notes

- **CORS:** the form calls this service via a `POST` from `inkmule.com`, so
  the form's origin must be listed in `ALLOWED_ORIGIN`. Both `www` and bare
  domain are included in the example.
- **File size:** `MAX_FILE_MB` (default 20) caps each uploaded file.
  Resend's total request size cap is around 40 MB.
- **Reply-to:** replies to the notification go straight to the person who
  submitted the form.
- **Honeypot:** a hidden `_gotcha` field silently drops bot spam.
- **Domain verification:** `MAIL_FROM`'s domain must be verified in Resend
  before you can send from it (step 3 above) — sending from an unverified
  domain will fail.

## Run locally (optional)

```bash
npm install
cp .env.example .env   # fill in real values
npm start              # POST http://localhost:3000/submit
```
