// Attila Zenerádiója – valós hallgatottsági adatok.
// A két Diazol csatorna Icecast JSON statisztikáját és a külső AutoDJ
// nyilvános status.xsl oldalát olvassa. A böngésző csak ezt a funkciót hívja.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const STATS_URLS = [
  "https://s02.diazol.hu:8132/status-json.xsl",
  "http://s02.diazol.hu:8130/status-json.xsl",
];

const ATTILA_STATUS_URL = "http://attilazeneradioja.ddns.net:28888/status.xsl";

function jsonResponse(payload: unknown, status = 200, cacheSeconds = 4) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=" + cacheSeconds + ", s-maxage=" + cacheSeconds,
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
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Icecast stats HTTP " + response.status);

      const payload = await response.json();
      const sources = normalizeSources(payload);
      if (!sources.length) throw new Error("Az Icecast válaszában nincs aktív forrás.");

      return { sources, endpoint: url };
    } catch (error) {
      lastError = error;
      console.warn("Diazol státuszlekérés sikertelen (" + url + "):", error);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&colon;/gi, ":")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function getMountListenersFromStatus(html: string, mount: string): number | null {
  const text = htmlToPlainText(html);
  const markers = [...text.matchAll(/Mount\s*Point\s*:/gi)];

  for (let index = 0; index < markers.length; index++) {
    const start = markers[index].index ?? 0;
    const end = markers[index + 1]?.index ?? text.length;
    const section = text.slice(start, end);

    if (!section.toLowerCase().includes(mount.toLowerCase())) continue;

    const match = section.match(/Current\s*Listeners\s*:\s*([0-9,]+)/i);
    if (!match) return null;

    const count = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
  }

  return null;
}

async function loadAttilaAutoDJStats(): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
    const response = await fetch(ATTILA_STATUS_URL, {
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml,*/*",
        "User-Agent": "AttilaRadio-ListenerStats/1.0",
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("Attila status.xsl HTTP " + response.status);
    }

    const html = await response.text();
    const listeners = getMountListenersFromStatus(html, "/autodj");

    if (listeners === null) {
      throw new Error("A status.xsl oldalról nem olvasható ki az /autodj Current Listeners értéke.");
    }

    return listeners;
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, 0);
  }

  try {
    const [diazolResult, attilaResult] = await Promise.allSettled([
      loadIcecastStats(),
      loadAttilaAutoDJStats(),
    ]);

    if (diazolResult.status !== "fulfilled") {
      throw diazolResult.reason;
    }

    const sources = diazolResult.value.sources;
    const liveSource = sources.find((source) => getMountPath(source) === "/live");
    const autodjSource = sources.find((source) => getMountPath(source) === "/autodj");

    const liveListeners = getListenerCount(liveSource);
    const autodjListeners = getListenerCount(autodjSource);
    const attilaListeners = attilaResult.status === "fulfilled" ? attilaResult.value : null;

    if (attilaResult.status === "rejected") {
      console.warn("Attila AutoDJ hallgatottsági adat most nem érhető el:", attilaResult.reason);
    }

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
      attilaAutoDJ: {
        mount: "/autodj",
        source: ATTILA_STATUS_URL,
        available: attilaListeners !== null,
        listeners: attilaListeners,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Attila Zenerádiója radio-stats hiba:", error);
    return jsonResponse({
      error: "RADIO_STATS_UNAVAILABLE",
      message: "A hallgatottsági adatok most nem érhetők el.",
    }, 502, 0);
  }
});
