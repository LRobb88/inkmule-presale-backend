/**
 * InkMule Pre-Sale Store Request — form handler (SendGrid Web API)
 * Same approach as your Art Request backend: authenticates with a single
 * SendGrid API key (no SMTP host/user/password). Accepts the multipart
 * POST from the pre-sale request form and emails you each submission with
 * the uploaded logo + product file attached.
 *
 * Deploy to Railway exactly like inkmule-art-request-production.
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const sgMail = require('@sendgrid/mail');

const app = express();

// ---- Config ---------------------------------------------------------------
const {
  SENDGRID_API_KEY,                       // same key as your art-request service
  ALLOWED_ORIGIN = 'https://www.inkmule.com,https://inkmule.com',
  MAX_FILE_MB = '20',                     // SendGrid caps total message ~30 MB
  PORT = '3000',
} = process.env;

// Where submissions are emailed, and the (SendGrid-verified) "from" address.
// Set these as Railway variables, OR just hard-code them right here.
const MAIL_TO = process.env.MAIL_TO || 'REPLACE_WITH_YOUR_INBOX@inkmule.com';
const MAIL_FROM = process.env.MAIL_FROM || 'REPLACE_WITH_VERIFIED_SENDER@inkmule.com';

if (SENDGRID_API_KEY) sgMail.setApiKey(SENDGRID_API_KEY);

// Allow the form's origin(s) to POST here (comma-separated list OK).
const allowedOrigins = ALLOWED_ORIGIN.split(',').map((s) => s.trim());
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ['POST', 'GET', 'OPTIONS'],
  })
);

// Multipart parser — files kept in memory, then attached to the email.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(MAX_FILE_MB, 10) * 1024 * 1024 },
});

// Human-friendly label order for the email body.
const FIELD_ORDER = [
  'Full Name', 'Email', 'Company / Organization', 'Phone',
  'Store Name', 'Desired URL', 'Public Store',
  'Requested Open Date', 'Requested Close Date',
  'Fulfillment', 'Collect Payment', '2XL Upcharge', 'Order Notification Email',
  'Additional Notes',
  'Agree: Read Best Practices', 'Agree: Store Window & Production',
  'Agree: All Sales Final', 'Agree: Order Minimums',
  'Agree: Artwork & IP', 'Agree: Payment',
];

function buildBody(fields) {
  const seen = new Set();
  const lines = [];
  const push = (k) => {
    if (fields[k] === undefined || fields[k] === '') return;
    const v = Array.isArray(fields[k]) ? fields[k].join(', ') : fields[k];
    lines.push(`${k}: ${v}`);
    seen.add(k);
  };
  FIELD_ORDER.forEach(push);
  Object.keys(fields).forEach((k) => {
    if (seen.has(k) || k === '_gotcha') return;
    push(k);
  });
  return lines.join('\n');
}

function buildHtml(fields) {
  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = buildBody(fields)
    .split('\n')
    .map((line) => {
      const i = line.indexOf(': ');
      const k = esc(line.slice(0, i));
      const v = esc(line.slice(i + 2)).replace(/\n/g, '<br>');
      return `<tr><td style="padding:6px 12px;font-weight:600;color:#005D63;vertical-align:top;white-space:nowrap;">${k}</td><td style="padding:6px 12px;color:#1a1a1a;">${v}</td></tr>`;
    })
    .join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;">
    <h2 style="color:#005D63;margin:0 0 12px;">New Pre-Sale Store Request</h2>
    <table style="border-collapse:collapse;">${rows}</table>
  </div>`;
}

const THANK_YOU_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Request received | InkMule</title></head>
<body style="margin:0;font-family:'Libre Franklin',Helvetica,Arial,sans-serif;background:#faf6f4;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;padding:80px 24px;text-align:center;">
    <div style="width:70px;height:70px;border-radius:50%;background:#E65300;color:#fff;display:flex;align-items:center;justify-content:center;font-size:36px;margin:0 auto 22px;">&#10003;</div>
    <h1 style="font-family:'DM Serif Display','Recoleta Alt',Georgia,serif;font-size:32px;color:#005D63;margin:0 0 12px;">Request received!</h1>
    <p style="font-size:16px;color:#6b6b6b;margin:0 0 28px;">Thanks &mdash; your pre-sale store request is in. We'll review it and get back to you within 1 business day with next steps.</p>
    <a href="https://www.inkmule.com" style="display:inline-block;background:#005D63;color:#fff;text-decoration:none;font-weight:600;padding:13px 28px;border-radius:8px;">Back to InkMule</a>
  </div>
</body></html>`;

// ---- Routes ---------------------------------------------------------------
app.get('/', (_req, res) => res.status(200).send('InkMule pre-sale form handler is running.'));

// Diagnostic: open this in a browser to see config + the exact SendGrid error.
// Safe to leave in place; it never exposes the API key value.
app.get('/diag', async (_req, res) => {
  const info = {
    SENDGRID_API_KEY_set: Boolean(SENDGRID_API_KEY),
    MAIL_FROM,
    MAIL_TO,
    from_is_placeholder: MAIL_FROM.includes('REPLACE_WITH'),
    to_is_placeholder: MAIL_TO.includes('REPLACE_WITH'),
  };
  try {
    await sgMail.send({
      to: MAIL_TO.split(',').map((s) => s.trim()),
      from: MAIL_FROM,
      subject: 'InkMule pre-sale form — test email',
      text: 'Test from /diag. If you got this, email is working.',
    });
    info.test_send = 'SUCCESS — check the MAIL_TO inbox';
  } catch (err) {
    info.test_send = 'FAILED';
    info.error = err && err.response && err.response.body ? err.response.body : String(err);
  }
  res.status(200).json(info);
});

app.post('/submit', upload.any(), async (req, res) => {
  const wantsJson = (req.headers.accept || '').includes('application/json');
  try {
    // Honeypot: silently accept + drop obvious bots.
    if (req.body && req.body._gotcha) {
      return wantsJson ? res.status(200).json({ success: true }) : res.status(200).send(THANK_YOU_HTML);
    }

    const attachments = (req.files || []).map((f) => ({
      content: f.buffer.toString('base64'),
      filename: `${f.fieldname} - ${f.originalname}`,
      type: f.mimetype,
      disposition: 'attachment',
    }));

    const submitterEmail = (req.body.Email || '').trim();
    const storeName = (req.body['Store Name'] || 'Pre-Sale Store').trim();

    await sgMail.send({
      to: MAIL_TO.split(',').map((s) => s.trim()),
      from: MAIL_FROM,
      replyTo: submitterEmail || undefined,
      subject: `New Pre-Sale Store Request — ${storeName}`,
      text: buildBody(req.body),
      html: buildHtml(req.body),
      attachments,
    });

    return wantsJson ? res.status(200).json({ success: true }) : res.status(200).send(THANK_YOU_HTML);
  } catch (err) {
    console.error('Submit error:', err && err.response ? err.response.body : err);
    return wantsJson
      ? res.status(500).json({ success: false, message: 'Failed to send' })
      : res.status(500).send('Sorry, something went wrong. Please try again or call 833-465-6853.');
  }
});

app.listen(parseInt(PORT, 10), () => {
  console.log(`Pre-sale form handler listening on :${PORT}`);
});
