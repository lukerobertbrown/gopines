/**
 * Discover Fire Island Pines schedule PNG + PDF from Wix SSR warmup JSON.
 * @see https://www.sayvilleferry.com/fire-island-pines
 */

const PINES_PAGE_URL = "https://www.sayvilleferry.com/fire-island-pines";
const FETCH_UA = "Mozilla/5.0 (compatible; gopines/1.0; +https://gopines.gay)";

/** @param {string} uri Wix media uri e.g. e3d2a1_xxx~mv2.png */
function wixStaticPngUrl(uri) {
  return `https://static.wixstatic.com/media/${uri}/v1/fit/w_2500,h_1330,al_c/${uri}`;
}

/**
 * @param {string} html
 * @returns {object}
 */
function parseWixWarmupData(html) {
  const re = /<script type="application\/json" id="wix-warmup-data">([\s\S]*?)<\/script>/;
  const m = html.match(re);
  if (!m) throw new Error("wix-warmup-data script not found in HTML");
  return JSON.parse(m[1]);
}

/**
 * @param {object} warmup
 * @returns {Record<string, unknown>}
 */
function mergeSsrPropsUpdates(warmup) {
  const updates = warmup?.platform?.ssrPropsUpdates;
  if (!Array.isArray(updates)) return {};
  return Object.assign({}, ...updates);
}

/**
 * @param {Record<string, unknown>} merged
 * @returns {{ pngUrl: string, pdfUrl: string | null, effectiveLabel: string, pngTitle: string }}
 */
function extractPinesAssets(merged) {
  /** @type {{ uri: string, title: string } | null} */
  let png = null;
  /** @type {{ href: string, name: string } | null} */
  let pdf = null;

  for (const val of Object.values(merged)) {
    if (!val || typeof val !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (val);

    if (typeof o.uri === "string" && o.uri.endsWith(".png") && typeof o.title === "string") {
      const title = o.title.toLowerCase();
      if (title.includes("pines")) {
        png = { uri: o.uri, title: o.title };
      }
    }

    const link = o.link;
    if (link && typeof link === "object" && link.type === "DocumentLink" && typeof link.href === "string") {
      const href = link.href.toLowerCase();
      const docInfo = link.docInfo && typeof link.docInfo === "object" ? link.docInfo : null;
      const name = (docInfo && typeof docInfo.name === "string" ? docInfo.name : "").toLowerCase();
      if (href.endsWith(".pdf") && (name.includes("pines") || href.includes("pines"))) {
        pdf = { href: link.href, name: docInfo && typeof docInfo.name === "string" ? docInfo.name : "schedule.pdf" };
      }
    }
  }

  if (!png) {
    throw new Error("No Pines PNG (title containing 'pines') found in wix-warmup-data");
  }

  return {
    pngUrl: wixStaticPngUrl(png.uri),
    pdfUrl: pdf ? pdf.href : null,
    effectiveLabel: png.title.replace(/\.png$/i, ""),
    pngTitle: png.title,
  };
}

/**
 * @returns {Promise<{ sourcePageUrl: string, pngUrl: string, pdfUrl: string | null, effectiveLabel: string, pngTitle: string }>}
 */
async function discoverPinesScheduleAssets() {
  const res = await fetch(PINES_PAGE_URL, {
    headers: { "user-agent": FETCH_UA, accept: "text/html,application/xhtml+xml" },
  });
  if (!res.ok) throw new Error(`Sayville page fetch failed: ${res.status}`);
  const html = await res.text();
  const warmup = parseWixWarmupData(html);
  const merged = mergeSsrPropsUpdates(warmup);
  const assets = extractPinesAssets(merged);
  return { sourcePageUrl: PINES_PAGE_URL, ...assets };
}

module.exports = {
  PINES_PAGE_URL,
  parseWixWarmupData,
  mergeSsrPropsUpdates,
  extractPinesAssets,
  wixStaticPngUrl,
  discoverPinesScheduleAssets,
};
