# Inkmule Proofs

Art requests, proofs and customer approvals in one place. Runs as a **Missive sidebar app** and a **standalone web app**, from the same server.

| URL | Who | What |
|---|---|---|
| `/missive` | Everyone, inside Missive | Sidebar: create a request from a conversation, see its status, add or send proofs |
| `/board` | Art team and reps | Trello-style kanban (drag cards between columns), with a List view toggle |
| `/new` | Reps | Full request form |
| `/requests/:id` | Everyone | Request detail: products, artwork, proofs, sales review, sending, activity |
| `/settings` | Everyone | Edit the proof warnings list, check integrations, get the Missive URL |
| `/p/:token` | Customers | Proof page: view the proof, check off warnings, Approve or Request Changes |

## How the workflow runs

1. **Rep submits a request** (Missive sidebar or `/new`). Required: job name (typed by hand; it becomes `PROJECTS/{Job Name}` in Dropbox), client email, and per product the style, color, vendor link, product type, decoration and location(s). S&S styles are picked from a search box, which fills in images, colors and the vendor link automatically.
2. **The card lands in New.** Artists drag it across the board as they work.
3. **Artist adds the proof.** They paste a Dropbox link or upload the file, and it's saved to `PROJECTS/{Job Name}/Proofs/`. Then they:
   - tick any of the standard **warnings** (the client must check off each one to approve)
   - optionally add a note to the client
   - optionally tick **Require sales review** and say what's wrong. That moves the card to **Sales Review**, emails the rep, and posts in the Missive thread. The rep then picks **Approve to send** or **Send back to art**.
4. **Someone sends the proof**, either:
   - **Send to client:** emails the client from `proofs@inkmule.com`. Reply-to is the rep, so replies land in Missive.
   - **Copy live link:** a permanent link to paste into a Sales Order. It always shows the latest version.
   Either way the card moves to **Proof Sent**, and the card shows when the client opens the link.
5. **Client responds:**
   - **Approve** → the card moves to **Approved / Ready for Production**, a ✅ note posts on the Missive conversation, the rep and artist get an email, and an approval record (name, time, warnings acknowledged) is saved next to the proof in Dropbox.
   - **Request changes** → the card moves to **Changes Requested**, the comment posts in Missive, and the rep and artist get an email. The artist adds v2, and the client link updates to it.

## Deploy on Railway

1. Push this folder to a new GitHub repo (e.g. `LRobb88/inkmule-proofing`) and create a Railway service from it. Or run `railway up` in this folder against the existing `inkmule-proofing` service.
2. Add a **PostgreSQL** database to the project. Railway sets `DATABASE_URL`, and the tables are created on first boot.
3. Set the variables in `.env.example` (details below).
4. Optional but recommended: add a custom domain like `proofs.inkmule.com` in Railway, so customer links are branded. Then set `APP_URL` to it.

### Google sign-in
Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID → Web application**. Add your `APP_URL` under *Authorized JavaScript origins*, then put the client ID in `GOOGLE_CLIENT_ID`. Only `@inkmule.com` accounts can sign in.

### Dropbox
1. Go to https://www.dropbox.com/developers/apps → **Create app** → *Scoped access* → **Full Dropbox**.
2. Under **Permissions**, enable `account_info.read`, `files.metadata.read`, `files.metadata.write`, `files.content.read`, `files.content.write` and `sharing.read`, then click Submit.
3. Under **Settings**, add the redirect URI `{APP_URL}/setup/dropbox/callback`.
4. Put the App key and secret in `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` and deploy.
5. While signed in to the app, visit `{APP_URL}/setup/dropbox`, approve, and copy the refresh token it shows into `DROPBOX_REFRESH_TOKEN`. Redeploy.

The app uses your team space root automatically, so `/PROJECTS` points at the same folder you see in the desktop app. If PROJECTS lives somewhere else, set `DROPBOX_PROJECTS_PATH`. An existing job folder is reused rather than duplicated.

### S&S Activewear
Ask your S&S rep for an API key. Put your account number in `SS_ACCOUNT_NUMBER` and the key in `SS_API_KEY`. The style list syncs at startup and then daily (Settings has a manual refresh). Vendor links follow `SS_PRODUCT_URL_TEMPLATE`; reps can edit the link on the form if one is off.

### Email (Resend)
This is the same Resend account the art-request form uses. `inkmule.com` must be verified there. Set `RESEND_API_KEY` and `EMAIL_FROM` (default `proofs@inkmule.com`).

### Missive
- **Sidebar:** Missive → Settings → Integrations → Add → **iFrame**. Name it "Art Requests" and use the URL `{APP_URL}/missive`. Each person clicks **Sign in with Google** once in the sidebar.
- **Conversation notes** (sales review, proof sent, approved, changes requested): Missive → Settings → API → create a token, then put it in `MISSIVE_API_TOKEN`. Notes only post on requests created from (or linked to) a Missive conversation. In the sidebar, **Link here** attaches an existing request to the open conversation.

## Run locally

```bash
createdb inkmule_proofing
npm install
DATABASE_URL=postgres://localhost/inkmule_proofing DEV_AUTH=1 npm start
```

`DEV_AUTH=1` adds a no-Google sign-in box for testing. It is ignored when `NODE_ENV=production`. Without Dropbox credentials, files are saved under `./data/uploads`. Without Resend or a Missive token, emails and posts are printed to the console. Opening `/missive` in a normal browser shows a test bar where you can type a fake conversation ID.

## Code map

```
server.js              routes, page serving, Dropbox one-time setup
src/config.js          env vars
src/schema.sql         tables (created/updated on boot)
src/auth.js            Google sign-in, sessions, Missive sign-in handoff
src/routes/api.js      staff API: requests, proofs, sales review, sending
src/routes/public.js   customer proof page API: view, approve, request changes
src/workflow.js        statuses, activity log, request loading
src/dropbox.js         Dropbox (team-space aware), local fallback
src/ss.js              S&S style cache + color lookup
src/notify.js          Resend emails + Missive posts
public/                web app, Missive sidebar, proof page (no build step)
```

## Board columns (Settings)
Columns can be renamed, reordered, recolored, added and removed in **Settings → Board columns**. Default: New → Changes Requested → Sent → Archive. "Move cards automatically when…" maps each workflow event (request submitted, proof ready, sales review, sent, changes requested, all approved) to a column, or leaves the card where it is. Cards in an Archive column are never moved automatically and drop off the board after 14 days (they stay in List view).

## Mac notifications
Each person turns them on in **Settings → Notifications on this computer** (Chrome, or Safari on macOS 13+), then picks which events they want. They arrive as normal macOS notifications and clicking one opens the request. Safari users can also use **File → Add to Dock** to run Inkmule Proofs as its own app. No setup needed on the server: push keys are generated automatically on first run. Missive's embedded sidebar can't show browser notifications, so turn them on in the web app.
