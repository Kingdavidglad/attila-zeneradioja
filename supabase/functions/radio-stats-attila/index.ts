// Attila Zeneradioja – kulon, publikus AutoDJ hallgatottsagi vegpont.
// A regi radio-stats funkciohoz nem nyul: ez csak a /autodj mountot olvassa.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const STATUS_URL = "http://attilazeneradioja.ddns.net:28888/status.xsl";

function jsonResponse(payload: unknown, status = 200, cacheSeconds = 3) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
    },
  });
}

function decodeHtmlText(html: string): string {
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

function parseAutoDJListeners(html: string): number | null {
  const text = decodeHtmlText(html);
  const mountMarker = /Mount\s*Point\s*:\s*\/?autodj\b/i.exec(text);
  if (!mountMarker || mountMarker.index === undefined) {
    throw new Error("A status.xsl oldalon nem található az /autodj mount.");
  }

  const afterMount = text.slice(mountMarker.index + mountMarker[0].length);
  const nextMount = /Mount\s*Point\s*:/i.exec(afterMount);
  const section = nextMount?.index !== undefined
    ? afterMount.slice(0, nextMount.index)
    : afterMount;

  const match = section.match(/Current\s*Listeners\s*:\s*([0-9][0-9,]*)/i);
  if (!match) {
    throw new Error("Az /autodj blokkban nem található a Current Listeners érték.");
  }

  const count = Number(match[1].replace(/,/g, ""));
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Az /autodj hallgatószám nem érvényes szám.");
  }
  return count;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405, 0);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(STATUS_URL, {
      method: "GET",
      headers: { "Accept": "text/html,application/xhtml+xml,*/*" },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Attila status.xsl HTTP ${response.status}`);
    }

    const html = await response.text();
    const listeners = parseAutoDJListeners(html);

    return jsonResponse({
      attilaAutoDJ: {
        mount: "/autodj",
        available: true,
        listeners,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Attila radio-stats-attila hiba:", error);
    return jsonResponse({
      error: "ATTILA_RADIO_STATS_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Az Attila AutoDJ hallgatottsági adata nem érhető el.",
      attilaAutoDJ: { mount: "/autodj", available: false, listeners: null },
    }, 502, 0);
  } finally {
    clearTimeout(timeout);
  }
});
