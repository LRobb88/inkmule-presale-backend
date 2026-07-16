/**
 * InkMule Pre-Sale Store Request — form handler
 * Mirrors the Art Request backend: accepts a multipart POST from the
 * pre-sale request form and emails the submission (with the uploaded
 * logo + product file attached) to your team. No third-party form
 * service, no attachment size caps beyond what you set here.
 *
 * Deploy to Railway exactly like inkmule-art-request-production.
 * Set the environment variables listed in .env.example.
 */

const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();

// ---- Config ---------------------------------------------------------------
const {
  SMTP_HOST,
  SMTP_PORT = '587',
  SMTP_USER,
  SMTP_PASS,
  MAIL_TO,                       // where submissions are emailed (comma-separated OK)
  MAIL_FROM,                     // the "from" address (often same as SMTP_USER)
  ALLOWED_ORIGIN = 'https://www.inkmule.com',
  MAX_FILE_MB = '25',
  PORT = '3000',
} = process.env;

// Allow the form's origin(s) to POST here via fetch (comma-separated list OK).
const allowedOrigins = ALLOWED_ORIGIN.split(',').map((s) => s.trim());
app.use(
  cors({
    origin(origin, cb) {
      // allow same-origin / curl (no origin) and any configured origin
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

// Reusable SMTP transport.
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: parseInt(SMTP_PORT, 10),
  secure: parseInt(SMTP_PORT, 10) === 465, // true for 465, false for 587/25
  auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
});

// Human-friendly label order for the email body.
const FIELD_ORDER = [
  'Full Name',
  'Email',
  'Company / Organization',
  'Phone',
  'Store Name',
  'Desired URL',
  'Public Store',
  'Requested Open Date',
  'Requested Close Date',
  'Fulfillment',
  'Collect Payment',
  '2XL Upcharge',
  'Order Notification Email',
  'Additional Notes',
  'Agree: Read Best Practices',
  'Agree: Store Window & Production',
  'Agree: All Sales Final',
  'Agree: Order Minimums',
  'Agree: Artwork & IP',
  'Agree: Payment',
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
  // Include anything unexpected we didn't map, except the honeypot.
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
      return `<tr><td style="padding:6px 12px;font-weight:600;color:#0e4d4d;vertical-align:top;white-space:nowrap;">${k}</td><td style="padding:6px 12px;color:#2b2b28;">${v}</td></tr>`;
    })
    .join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;">
    <h2 style="color:#0e4d4d;margin:0 0 12px;">New Pre-Sale Store Request</h2>
    <table style="border-collapse:collapse;">${rows}</table>
  </div>`;
}

// Branded thank-you page shown after a normal (non-AJAX) form submit.
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

app.post('/submit', upload.any(), async (req, res) => {
  try {
    // Honeypot: silently accept + drop obvious bots.
    if (req.body && req.body._gotcha) return res.status(200).json({ success: true });

    const attachments = (req.files || []).map((f) => ({
      filename: `${f.fieldname} - ${f.originalname}`,
      content: f.buffer,
      contentType: f.mimetype,
    }));

    const submitterEmail = (req.body.Email || '').trim();
    const storeName = (req.body['Store Name'] || 'Pre-Sale Store').trim();

    await transporter.sendMail({
      from: MAIL_FROM || SMTP_USER,
      to: MAIL_TO,
      replyTo: submitterEmail || undefined,
      subject: `New Pre-Sale Store Request — ${storeName}`,
      text: buildBody(req.body),
      html: buildHtml(req.body),
      attachments,
    });

    // fetch() clients get JSON; plain form posts get a branded thank-you page.
    if ((req.headers.accept || '').includes('application/json')) {
      return res.status(200).json({ success: true });
    }
    return res.status(200).send(THANK_YOU_HTML);
  } catch (err) {
    console.error('Submit error:', err);
    if ((req.headers.accept || '').includes('application/json')) {
      return res.status(500).json({ success: false, message: 'Failed to send' });
    }
    return res.status(500).send('Sorry, something went wrong. Please try again or call 833-465-6853.');
  }
});

app.listen(parseInt(PORT, 10), () => {
  console.log(`Pre-sale form handler listening on :${PORT}`);
});
