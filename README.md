# InkMule Pre-Sale Form Handler

A tiny self-hosted backend for the pre-sale store request form — the same
approach as your existing `inkmule-art-request-production` service on Railway.
It accepts the form's multipart POST and emails you each submission with the
uploaded **store logo** and **product file** attached.

No third-party form service, no per-file size caps beyond `MAX_FILE_MB`, no
monthly submission limits.

## What's here

- `server.js` — Express app: `POST /submit` (multipart) → emails you.
- `package.json` — dependencies (`express`, `multer`, `nodemailer`, `cors`).
- `.env.example` — the environment variables to set.

## Deploy to Railway (same as the art-request service)

1. Put these files in a new folder (or Git repo).
2. In Railway: **New Project → Deploy from repo** (or drag-and-drop / `railway up`).
3. Railway auto-detects Node and runs `npm start`.
4. Under the service's **Variables**, add everything from `.env.example`
   (real values). Use the same SMTP credentials your art-request service uses.
5. Railway gives the service a public URL, e.g.
   `https://inkmule-presale-production.up.railway.app`.
6. In `presale-request-embed.html`, set the form `action` to
   `https://<your-service>.up.railway.app/submit`.

That's it — submissions will email to `MAIL_TO` with attachments, and the
customer's email is set as the reply-to.

## Notes

- **CORS:** the form calls this service via `fetch()` from `inkmule.com`, so the
  form's origin must be listed in `ALLOWED_ORIGIN`. Both `www` and bare domain
  are included in the example.
- **File size:** `MAX_FILE_MB` (default 25) caps each uploaded file. Raise it if
  you expect large AI/EPS art files; just make sure your mail provider accepts
  attachments that big (many cap total message size around 25 MB).
- **Reply-to:** replies to the notification go straight to the person who
  submitted the form.
- **Honeypot:** a hidden `_gotcha` field silently drops bot spam.

## Run locally (optional)

```bash
npm install
cp .env.example .env   # fill in real values
npm start              # POST http://localhost:3000/submit
```
