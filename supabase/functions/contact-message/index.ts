// Attila Zenerádiója – nyilvános kapcsolatfelvételi Edge Function
// A funkció szerveroldalon ment adatbázisba, és opcionálisan Resenddel értesítő e-mailt küld.
// A Supabase secret/service-role kulcs soha nem kerülhet a böngészőbe.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? '';
const CONTACT_EMAIL = Deno.env.get('CONTACT_EMAIL') ?? 'djattila112@gmail.com';
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const RATE_LIMIT_SALT = Deno.env.get('RATE_LIMIT_SALT') ?? '';

function getSupabaseSecretKey(): string {
  // Új Supabase secret key formátum, régi service-role változóval kiegészítve.
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeysRaw) {
    try {
      const secretKeys = JSON.parse(secretKeysRaw);
      if (typeof secretKeys.default === 'string' && secretKeys.default) {
        return secretKeys.default;
      }
    } catch (_error) {
      // Alább megpróbáljuk a legacy környezeti változót.
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

const SUPABASE_SECRET_KEY = getSupabaseSecretKey();

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sendNotificationEmail(input: {
  name: string;
  email: string;
  phone: string;
  message: string;
}): Promise<boolean> {
  // Az üzenet adatbázisba mentése e-mail-beállítás nélkül is megtörténik.
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL || !CONTACT_EMAIL) return false;

  const name = escapeHtml(input.name);
  const email = escapeHtml(input.email);
  const phone = escapeHtml(input.phone);
  const message = escapeHtml(input.message).replace(/\r?\n/g, '<br>');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [CONTACT_EMAIL],
      reply_to: input.email,
      subject: `Új üzenet – Attila Zenerádiója (${input.name})`,
      html: `
        <h2>Új kapcsolatfelvételi üzenet</h2>
        <p><strong>Név:</strong> ${name}</p>
        <p><strong>E-mail:</strong> ${email}</p>
        <p><strong>Telefon:</strong> ${phone}</p>
        <hr>
        <p>${message}</p>
      `,
      text: `Új kapcsolatfelvételi üzenet\nNév: ${input.name}\nE-mail: ${input.email}\nTelefon: ${input.phone}\n\n${input.message}`,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Resend notification failed:', response.status, errorText.slice(0, 500));
    return false;
  }
  return true;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin');

  if (request.method === 'OPTIONS') {
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Origin not allowed', { status: 403, headers: corsHeaders(null) });
    }
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ success: false, error: 'METHOD_NOT_ALLOWED' }, 405, origin);
  }

  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return jsonResponse({ success: false, error: 'ORIGIN_NOT_ALLOWED' }, 403, null);
  }

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error('Missing Supabase server configuration.');
    return jsonResponse({ success: false, error: 'SERVER_NOT_CONFIGURED' }, 500, origin);
  }

  let raw: Record<string, unknown>;
  try {
    raw = await request.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid JSON');
  } catch (_error) {
    return jsonResponse({ success: false, error: 'INVALID_JSON' }, 400, origin);
  }

  // Honeypot: az emberi látogató számára rejtett mezőnek üresen kell maradnia.
  const honeypot = cleanText(raw.honeypot ?? raw._honey ?? raw.website, 200);
  if (honeypot) {
    // A botoknak általános sikerüzenetet adunk, de nem mentünk adatot.
    return jsonResponse({ success: true, emailSent: false }, 200, origin);
  }

  const name = cleanText(raw.name, 100);
  const email = cleanText(raw.email, 254).toLowerCase();
  const phone = cleanText(raw.phone, 40);
  const message = cleanText(raw.message, 5000);
  const consent = raw.consent === true || raw.data_processing_consent === 'Elfogadom';
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (name.length < 2 || !emailPattern.test(email) || phone.length < 3 || message.length < 5) {
    return jsonResponse({ success: false, error: 'INVALID_FIELDS' }, 400, origin);
  }
  if (!consent) {
    return jsonResponse({ success: false, error: 'CONSENT_REQUIRED' }, 400, origin);
  }

  // Nem tárolunk nyers IP-címet. Csak titkos sóval készített hash-t használunk korlátozáshoz.
  const forwardedFor = request.headers.get('x-forwarded-for') ?? '';
  const clientIp = forwardedFor.split(',')[0].trim()
    || request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || '';
  const fingerprint = clientIp
    ? await sha256(`${RATE_LIMIT_SALT || SUPABASE_SECRET_KEY}:${clientIp}`)
    : null;

  if (fingerprint) {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const query = new URLSearchParams({
      select: 'id',
      sender_fingerprint: `eq.${fingerprint}`,
      created_at: `gte.${since}`,
      limit: '3',
    });
    const rateResponse = await fetch(`${SUPABASE_URL}/rest/v1/contact_messages?${query}`, {
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      },
    });
    if (!rateResponse.ok) {
      console.error('Rate-limit lookup failed:', rateResponse.status, (await rateResponse.text()).slice(0, 300));
      return jsonResponse({ success: false, error: 'DATABASE_UNAVAILABLE' }, 503, origin);
    }
    const recentMessages = await rateResponse.json();
    if (Array.isArray(recentMessages) && recentMessages.length >= 3) {
      return jsonResponse({ success: false, error: 'RATE_LIMITED' }, 429, origin);
    }
  }

  const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/contact_messages`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      name,
      email,
      phone,
      message,
      sender_fingerprint: fingerprint,
    }),
  });

  if (!insertResponse.ok) {
    console.error('Message insert failed:', insertResponse.status, (await insertResponse.text()).slice(0, 500));
    return jsonResponse({ success: false, error: 'DATABASE_WRITE_FAILED' }, 503, origin);
  }

  let emailSent = false;
  try {
    emailSent = await sendNotificationEmail({ name, email, phone, message });
  } catch (error) {
    console.error('Email notification exception:', error);
  }

  return jsonResponse({ success: true, emailSent }, 200, origin);
});
