// Attila Zenerádiója – valós Icecast hallgatottsági adatok.
// A böngésző csak ezt a publikus, olvasási célú Supabase Edge Functiont hívja.
// A Diazol Icecast szerver status-json.xsl végpontjából olvassa a /live és /autodj mountokat.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// Elsődleges: a weboldal által is használt HTTPS/Port+2 cím.
// Tartalék: a sima HTTP státuszvégpont, amelyet kizárólag a szerveroldali Edge Function kér le.
const STATS_URLS = [
  "https://s02.diazol.hu:8132/status-json.xsl",
  "http://s02.diazol.hu:8130/status-json.xsl",
];

function jsonResponse(payload: unknown, status = 200, cacheSeconds = 4) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
    },
  });
}

function normalizeSources(payload: any): Record<string, any>[] {
  const value = payload?.icestats?.source;
  if (!value) return [];
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object")
    : [value];
}

function getMountPath(source: Record<string, any>): string {
  const candidates = [
    source.listenurl,
    source.listen_url,
    source.mount,
    source.mountpoint,
    source.stream_url,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    try {
      return new URL(candidate).pathname.replace(/\/$/, "") || "/";
    } catch {
      const value = candidate.split("?")[0].replace(/\/$/, "");
      if (value.startsWith("/")) return value;
    }
  }
  return "";
}

function getListenerCount(source: Record<string, any> | undefined): number | null {
  if (!source) return null;
  const raw = source.listeners ?? source.listener_count ?? source.current_listeners;
  if (raw === null || raw === undefined || raw === "") return null;
  const count = Number(raw);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

async function loadIcecastStats() {
  let lastError: unknown = new Error("Az Icecast státuszvégpont nem érhető el.");

  for (const url of STATS_URLS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Icecast stats HTTP ${response.status}`);

      const payload = await response.json();
      const sources = normalizeSources(payload);
      if (!sources.length) throw new Error("Az Icecast válaszában nincs aktív forrás.");

      return { sources, endpoint: url };
    } catch (error) {
      lastError = error;
      console.warn(`Icecast státuszlekérés nem sikerült (${url}):`, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, 0);
  }

  try {
    const { sources } = await loadIcecastStats();
    const liveSource = sources.find((source) => getMountPath(source) === "/live");
    const autodjSource = sources.find((source) => getMountPath(source) === "/autodj");

    const liveListeners = getListenerCount(liveSource);
    const autodjListeners = getListenerCount(autodjSource);

    return jsonResponse({
      live: {
        mount: "/live",
        available: liveListeners !== null,
        listeners: liveListeners,
      },
      autodj: {
        mount: "/autodj",
        available: autodjListeners !== null,
        listeners: autodjListeners,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Attila Zenerádiója radio-stats hiba:", error);
    return jsonResponse({
      error: "RADIO_STATS_UNAVAILABLE",
      message: "A Diazol Icecast hallgatottsági adatai most nem érhetők el.",
    }, 502, 0);
  }
});
