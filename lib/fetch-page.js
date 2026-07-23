export const FETCH_TIMEOUT_MS = 12000;

export const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; KeepPoint/1.0; +https://keeppoint.app)",
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
};

export function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function fetchPageHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: FETCH_HEADERS,
      redirect: "follow"
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export function siteNameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
