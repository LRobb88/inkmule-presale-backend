// Outbound notifications: Resend email + Missive conversation posts.
// Both are best-effort for internal notices (a failure is logged, never blocks
// the workflow). Customer proof emails DO surface errors to the sender.

const { Resend } = require('resend');
const config = require('./config');

const resend = config.email.resendApiKey ? new Resend(config.email.resendApiKey) : null;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function sendEmail({ to, cc, replyTo, subject, html, text }) {
  const from = `${config.email.fromName} <${config.email.from}>`;
  if (!resend) {
    console.log(`[email:dev] to=${to} cc=${cc || ''} subject="${subject}"\n${text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400)}`);
    return { dev: true };
  }
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => s.trim()).filter(Boolean);
  const { data, error } = await resend.emails.send({
    from, to: list(to), cc: list(cc).length ? list(cc) : undefined, replyTo: replyTo || undefined, subject, html, text,
  });
  if (error) throw new Error(typeof error === 'string' ? error : JSON.stringify(error));
  return data;
}

// Branded wrapper for all outgoing email.
function emailLayout(inner) {
  return `<!doctype html><html><body style="margin:0;background:#f6f3f0;font-family:Helvetica,Arial,sans-serif;color:#222;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="font-family:Georgia,serif;font-size:22px;color:#005D63;font-weight:bold;margin-bottom:20px;">inkmule</div>
    <div style="background:#fff;border-radius:10px;padding:28px;line-height:1.55;font-size:15px;">${inner}</div>
    <div style="font-size:12px;color:#888;margin-top:16px;text-align:center;">Inkmule · 2705 S Broad Ave, New Orleans, LA 70125</div>
  </div></body></html>`;
}

function button(href, label) {
  return `<a href="${esc(href)}" style="display:inline-block;background:#005D63;color:#fff;text-decoration:none;font-weight:bold;padding:12px 26px;border-radius:6px;">${esc(label)}</a>`;
}

async function sendProofEmail({ request, products = [], reminder, rep, proofUrl, message }) {
  const greeting = request.client_name ? `Hi ${esc(request.client_name.split(' ')[0])},` : 'Hi there,';
  const list = products.length
    ? `<ul style="padding-left:18px;margin:10px 0;">${products.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
  const intro = reminder
    ? `Just a reminder: your proof${products.length > 1 ? 's are' : ' is'} for <strong>${esc(request.job_name)}</strong> ${products.length > 1 ? 'are' : 'is'} still waiting for your review.`
    : `${products.length > 1 ? 'Proofs are' : 'Your proof is'} ready for <strong>${esc(request.job_name)}</strong>:`;
  const html = emailLayout(`
    <p>${greeting}</p>
    <p>${intro}</p>
    ${list}
    <p>You can approve each item or request changes from the page below.</p>
    ${message ? `<p style="white-space:pre-wrap;background:#f6f3f0;padding:12px 14px;border-radius:6px;">${esc(message)}</p>` : ''}
    <p style="margin:26px 0;">${button(proofUrl, 'Review your proof' + (products.length > 1 ? 's' : ''))}</p>
    <p style="font-size:13px;color:#666;">Questions? Just reply to this email${rep ? ` and it will go to ${esc(rep.name || rep.email)}` : ''}.</p>`);
  return sendEmail({
    to: request.client_email,
    cc: request.cc_emails,
    replyTo: rep ? `${rep.name || ''} <${rep.email}>`.trim() : undefined,
    subject: `${reminder ? 'Reminder: proof' : 'Proof'}${products.length > 1 ? 's' : ''} ready for ${request.job_name}`,
    html,
    text: `${greeting.replace(/<[^>]+>/g, '')}\n\n${reminder ? 'Reminder: your proofs are waiting for review' : 'Your proofs are ready'} for ${request.job_name}:\n${products.map((p) => `- ${p}`).join('\n')}\n\nReview and approve here: ${proofUrl}\n\n${message || ''}`,
  });
}

async function notifyStaffEmail(to, subject, bodyHtml) {
  if (!to) return;
  try {
    await sendEmail({ to, subject, html: emailLayout(bodyHtml) });
  } catch (e) {
    console.error('staff email failed:', e.message);
  }
}

// Posts a visible note in the Missive conversation the request came from.
async function missivePost(conversationId, { title, body, markdown }) {
  if (!conversationId) return;
  if (!config.missive.apiToken) {
    console.log(`[missive:dev] convo=${conversationId} ${title}: ${body}`);
    return;
  }
  try {
    const res = await fetch(`${config.missive.apiBase}/posts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.missive.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        posts: {
          conversation: conversationId,
          username: 'Inkmule Proofs',
          username_icon: `${config.appUrl}/img/icon.png`,
          notification: { title, body },
          markdown: markdown || body,
        },
      }),
    });
    if (!res.ok) console.error('Missive post failed', res.status, (await res.text()).slice(0, 300));
  } catch (e) {
    console.error('Missive post error:', e.message);
  }
}

module.exports = { sendEmail, sendProofEmail, notifyStaffEmail, missivePost, emailLayout, button, esc };
