// Tar emot bokningsförfrågningar från formuläret och mejlar dem till studion via Resend.
//
// Miljövariabler i Vercel (Project Settings > Environment Variables):
//   RESEND_API_KEY   API-nyckel från resend.com
//   BOOKING_TO       Mottagare, t.ex. Liz egen adress
//   BOOKING_FROM     Avsändare på en verifierad domän i Resend, t.ex. "Liz Tattoo <bokning@liztattoo.se>"
//   SEND_CONFIRMATION  "true" om kunden också ska få ett bekräftelsemejl (valfritt)
//
// Utan RESEND_API_KEY svarar funktionen 503, och formuläret visar då telefon och mejl som reserv.

const MAX = 2000;
const clean = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const list = v => (Array.isArray(v) ? v : []).map(x => clean(x, 80)).filter(Boolean).slice(0, 20);
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function send(key, body) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { RESEND_API_KEY, BOOKING_TO, BOOKING_FROM, SEND_CONFIRMATION } = process.env;
  if (!RESEND_API_KEY || !BOOKING_TO || !BOOKING_FROM) return res.status(503).json({ error: 'Booking email is not configured' });

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (b.company) return res.status(200).json({ ok: true }); // honungsfälla för bottar

  const d = {
    services: list(b.services), styles: list(b.styles), size: clean(b.size), placement: clean(b.placement),
    piercings: list(b.piercings), message: clean(b.message, MAX), timing: list(b.timing), age: clean(b.age),
    name: clean(b.name, 120), phone: clean(b.phone, 40), email: clean(b.email, 160), contactPref: clean(b.contactPref)
  };
  if (!d.services.length || !d.name || !d.phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const rows = [
    ['Gäller', d.services.join(', ')],
    ['Stil', d.styles.join(', ')],
    ['Storlek', d.size],
    ['Placering', d.placement],
    ['Piercing', d.piercings.join(', ')],
    ['Idé', d.message],
    ['Tider', d.timing.join(', ')],
    ['Ålder', d.age],
    ['Namn', d.name],
    ['Telefon', d.phone],
    ['Mejl', d.email],
    ['Vill bli kontaktad via', d.contactPref]
  ].filter(([, v]) => v);

  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a1715">
    <h2 style="font-weight:normal">Ny förfrågan från ${esc(d.name)}</h2>
    <table cellpadding="8" style="border-collapse:collapse">${rows.map(([k, v]) =>
      `<tr><td style="color:#7a7068;vertical-align:top;border-bottom:1px solid #eee">${esc(k)}</td><td style="border-bottom:1px solid #eee;white-space:pre-wrap">${esc(v)}</td></tr>`).join('')}</table>
  </div>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');

  try {
    await send(RESEND_API_KEY, {
      from: BOOKING_FROM, to: [BOOKING_TO], reply_to: d.email,
      subject: `Ny förfrågan: ${d.services.join(', ')} (${d.name})`, html, text
    });
    if (SEND_CONFIRMATION === 'true') {
      await send(RESEND_API_KEY, {
        from: BOOKING_FROM, to: [d.email], reply_to: BOOKING_TO,
        subject: 'Tack för din förfrågan hos Liz Tattoo & Piercing',
        text: `Hej ${d.name}!\n\nTack för din förfrågan. Jag har fått den och hör av mig så snart jag kan.\n\nDin förfrågan:\n${text}\n\nVänliga hälsningar\nLis, Liz Tattoo & Piercing\nAmiralsgatan 58, Malmö\n040 300 00 97`
      });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'Could not send' });
  }
}
