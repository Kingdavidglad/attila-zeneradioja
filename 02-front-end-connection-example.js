/*
 * Minta a meglévő index.html kapcsolatfelvételi űrlapjához.
 * A végleges index.html-be a projekt URL és publishable key behelyezése után illesztem be.
 * A böngészőbe CSAK publishable/anon kulcs kerülhet – secret/service_role soha!
 */
const SUPABASE_FUNCTION_URL = 'https://IDE_A_PROJECT_REF.supabase.co/functions/v1/contact-message';
const SUPABASE_PUBLISHABLE_KEY = 'IDE_A_PUBLISHABLE_KEY';

async function sendContactMessage({ name, email, phone, message, consent, honeypot = '' }) {
  const response = await fetch(SUPABASE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, email, phone, message, consent, honeypot }),
  });

  let result = {};
  try { result = await response.json(); } catch (_error) { /* handled below */ }

  if (!response.ok || result.success !== true) {
    const errors = {
      INVALID_FIELDS: 'Kérjük, ellenőrizd a megadott adatokat.',
      CONSENT_REQUIRED: 'Az üzenet elküldéséhez szükséges az adatkezelési hozzájárulás.',
      RATE_LIMITED: 'Rövid időn belül túl sok üzenetet küldtél. Próbáld újra később.',
      ORIGIN_NOT_ALLOWED: 'Az űrlap csak a hivatalos weboldalról használható.',
      SERVER_NOT_CONFIGURED: 'Az üzenetküldő szerver beállítása még nem teljes.',
      DATABASE_UNAVAILABLE: 'Az üzenetküldés átmenetileg nem elérhető.',
      DATABASE_WRITE_FAILED: 'Az üzenetet most nem sikerült elmenteni.',
    };
    throw new Error(errors[result.error] || 'Az üzenetküldés nem sikerült. Próbáld újra később.');
  }

  return { saved: true, emailSent: result.emailSent === true };
}
