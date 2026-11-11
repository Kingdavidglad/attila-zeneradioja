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

function jsonResponse(payload: unknown, status = 200, cacheSeconds = 2) {
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

function unavailableMetadata(mount: string, reason = "") {
  return { mount, available: false, artist: "", title: "", rawTitle: "", reason };
}

function metadataFromRawTitle(rawTitle: string, mount: string, source: string) {
  const cleaned = String(rawTitle || "").trim();
  if (!cleaned) return unavailableMetadata(mount);
  const parsed = parseArtistAndTitle(cleaned);
  return { mount, available: true, artist: parsed.artist, title: parsed.title, rawTitle: cleaned, source };
}

function normalizeTrackText(value: string): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("hu-HU");
}

function metadataFromAutoDJStatus(source: Record<string, any> | undefined, icyTitle: string) {
  if (icyTitle) return metadataFromRawTitle(icyTitle, "/autodj", "icy-stream");
  if (!source) return unavailableMetadata("/autodj", "Az AutoDJ státuszforrás nem található.");

  const title = readString(source, ["title", "stream_title", "track_title", "song", "track"]);
  const ypTitle = readString(source, ["yp_currently_playing"]);

  // A két státuszmező eltérő címet adott, és egyik sem igazolható a tényleges streamből.
  // Ilyenkor inkább nem közlünk téves zeneszámot.
  if (title && ypTitle && normalizeTrackText(title) !== normalizeTrackText(ypTitle)) {
    return unavailableMetadata("/autodj", "A státuszvégpont két eltérő címet közöl; a stream metaadata nem volt elérhető.");
  }

  return metadataFromRawTitle(ypTitle || title, "/autodj", "status-json");
}

async function readIcyStreamTitle(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4800);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "audio/mpeg,*/*",
        "Icy-MetaData": "1",
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error("Az AutoDJ stream metaadat-kérése nem sikerült (HTTP " + response.status + ").");
    }

    const intervalValue = response.headers.get("icy-metaint") || response.headers.get("Icy-MetaInt");
    const interval = Number(intervalValue);
    if (!Number.isSafeInteger(interval) || interval <= 0) {
      throw new Error("A stream nem küld érvényes icy-metaint fejlécet.");
    }

    reader = response.body.getReader();
    let buffer = new Uint8Array(0);

    async function readExactly(length: number): Promise<Uint8Array> {
      while (buffer.length < length) {
        const part = await reader!.read();
        if (part.done) throw new Error("A stream lezárult a metaadat beolvasása előtt.");
        const next = new Uint8Array(buffer.length + part.value.length);
        next.set(buffer, 0);
        next.set(part.value, buffer.length);
        buffer = next;
      }
      const result = buffer.slice(0, length);
      buffer = buffer.slice(length);
      return result;
    }

    // Az első metadata-blokk lehet üres, ezért legfeljebb három blokkot nézünk meg.
    for (let attempt = 0; attempt < 3; attempt++) {
      await readExactly(interval);
      const lengthByte = (await readExactly(1))[0];
      const metadataLength = lengthByte * 16;
      if (!metadataLength) continue;

      const metadataBytes = await readExactly(metadataLength);
      const metadata = new TextDecoder("utf-8").decode(metadataBytes).replace(/\0+$/g, "");
      const match = /StreamTitle\s*=\s*'((?:\\'|[^'])*)'\s*;/i.exec(metadata) ||
        /StreamTitle\s*=\s*"([^"]*)"\s*;/i.exec(metadata);
      const title = match ? match[1].replace(/\\'/g, "'").trim() : "";
      if (title) return title;
    }
    return "";
  } finally {
    if (reader) {
      try { await reader.cancel(); } catch (_) { /* a timeout may already have closed the stream */ }
    }
    clearTimeout(timeout);
  }
}

async function loadDiazolIcyTitle(): Promise<string> {
  const urls = [
    "https://s02.diazol.hu:8132/autodj",
    "http://s02.diazol.hu:8130/autodj",
  ];
  for (const url of urls) {
    try {
      const title = await readIcyStreamTitle(url);
      if (title) return title;
    } catch (error) {
      console.warn(`Diazol AutoDJ ICY-metaadat lekérés nem sikerült (${url}):`, error);
    }
  }
  return "";
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

      // A 02 / AUTODJ címet a tényleges stream ICY StreamTitle mezőjéből kérjük.
      // Ellentmondó status-json mezők esetén nem találgatunk, ha az ICY adat nem érhető el.
      const icyTitle = await loadDiazolIcyTitle();
      return {
        live: { mount: "/live", ...metadataFromSource(liveSource) },
        autodj: metadataFromAutoDJStatus(autodjSource, icyTitle),
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
