// Attila Zeneradioja – aktualis zeneszamok (Most szol) API.
// Kizárólag az aktuális metaadatot adja vissza; lejátszási előzményt nem tárol.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const DIAZOL_STATUS_URLS = [
  "https://s02.diazol.hu:8132/status-json.xsl",
  "http://s02.diazol.hu:8130/status-json.xsl",
];
const ATTILA_STATUS_URL = "http://attilazeneradioja.ddns.net:28888/status.xsl";

function jsonResponse(payload: unknown, status = 200, cacheSeconds = 5) {
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
  const candidates = [source.listenurl, source.listen_url, source.mount, source.mountpoint, source.stream_url];
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

function readString(source: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function parseArtistAndTitle(rawTitle: string, explicitArtist = "") {
  if (explicitArtist) return { artist: explicitArtist.trim(), title: rawTitle.trim() };
  const separators = [" – ", " — ", " - ", " | "];
  let splitAt = -1;
  let splitLength = 0;
  for (const separator of separators) {
    const index = rawTitle.indexOf(separator);
    if (index > 0 && (splitAt < 0 || index < splitAt)) {
      splitAt = index;
      splitLength = separator.length;
    }
  }
  if (splitAt > 0 && splitAt + splitLength < rawTitle.length) {
    return {
      artist: rawTitle.slice(0, splitAt).trim(),
      title: rawTitle.slice(splitAt + splitLength).trim(),
    };
  }
  return { artist: "", title: rawTitle.trim() };
}

function metadataFromSource(source: Record<string, any> | undefined) {
  if (!source) return { available: false, artist: "", title: "", rawTitle: "" };
  const rawTitle = readString(source, [
    "yp_currently_playing",
    "stream_title",
    "track_title",
    "song",
    "track",
    "title",
  ]);
  if (!rawTitle) return { available: false, artist: "", title: "", rawTitle: "" };
  const explicitArtist = readString(source, ["artist", "performer", "creator"]);
  const parsed = parseArtistAndTitle(rawTitle, explicitArtist);
  return { available: true, artist: parsed.artist, title: parsed.title, rawTitle };
}

async function loadDiazolNowPlaying() {
  let lastError: unknown = new Error("A Diazol zenei metaadat végpontjai nem érhetők el.");
  for (const url of DIAZOL_STATUS_URLS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Diazol metaadat HTTP ${response.status}`);
      const payload = await response.json();
      const sources = normalizeSources(payload);
      if (!sources.length) throw new Error("A Diazol válaszában nincs aktív streamforrás.");
      const liveSource = sources.find((source) => getMountPath(source) === "/live");
      const autodjSource = sources.find((source) => getMountPath(source) === "/autodj");
      return {
        live: { mount: "/live", ...metadataFromSource(liveSource) },
        autodj: { mount: "/autodj", ...metadataFromSource(autodjSource) },
      };
    } catch (error) {
      lastError = error;
      console.warn(`Diazol most-szól lekérés nem sikerült (${url}):`, error);
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
    .replace(/<\/(?:td|th)\s*>/gi, " ")
    .replace(/<\/(?:tr|p|div|h[1-6])\s*>/gi, " | ")
    .replace(/<br\s*\/?\s*>/gi, " | ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&colon;/gi, ":")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseAttilaCurrentSong(html: string) {
  const text = htmlToPlainText(html);
  const mountMarker = /Mount\s*Point\s*:\s*\/?autodj\b/i.exec(text);
  if (!mountMarker || mountMarker.index === undefined) {
    return { mount: "/autodj", available: false, artist: "", title: "", rawTitle: "" };
  }
  const afterMount = text.slice(mountMarker.index + mountMarker[0].length);
  const nextMount = /Mount\s*Point\s*:/i.exec(afterMount);
  const section = nextMount?.index !== undefined ? afterMount.slice(0, nextMount.index) : afterMount;
  const match = section.match(/Current\s*Song\s*:\s*(.*?)\s*(?:\||$)/i);
  const rawTitle = (match?.[1] || "").trim();
  if (!rawTitle) {
    return { mount: "/autodj", available: false, artist: "", title: "", rawTitle: "" };
  }
  const parsed = parseArtistAndTitle(rawTitle);
  return { mount: "/autodj", available: true, artist: parsed.artist, title: parsed.title, rawTitle };
}

async function loadAttilaNowPlaying() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(ATTILA_STATUS_URL, {
      headers: { Accept: "text/html,application/xhtml+xml,*/*" },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Attila status.xsl HTTP ${response.status}`);
    return parseAttilaCurrentSong(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405, 0);

  const [diazolResult, attilaResult] = await Promise.allSettled([
    loadDiazolNowPlaying(),
    loadAttilaNowPlaying(),
  ]);

  const diazol = diazolResult.status === "fulfilled"
    ? diazolResult.value
    : {
        live: { mount: "/live", available: false, artist: "", title: "", rawTitle: "" },
        autodj: { mount: "/autodj", available: false, artist: "", title: "", rawTitle: "" },
      };
  const attilaAutoDJ = attilaResult.status === "fulfilled"
    ? attilaResult.value
    : { mount: "/autodj", available: false, artist: "", title: "", rawTitle: "" };

  if (diazolResult.status === "rejected") console.warn("Diazol most-szól adat nem érhető el:", diazolResult.reason);
  if (attilaResult.status === "rejected") console.warn("Attila AutoDJ most-szól adat nem érhető el:", attilaResult.reason);

  return jsonResponse({
    ...diazol,
    attilaAutoDJ,
    updatedAt: new Date().toISOString(),
  }, 200, 5);
});
