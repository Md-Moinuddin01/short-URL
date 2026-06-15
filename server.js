"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "links.json");
const MAX_BODY_BYTES = 64 * 1024;
const MAX_URL_LENGTH = 5000;
const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const BLOCKED_PROTOCOLS = new Set(["javascript:", "data:", "vbscript:", "file:", "about:"]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer-when-downgrade",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    ...extra
  };
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, securityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  }));
  res.end(body);
}

function sendText(res, status, body, headers = {}) {
  res.writeHead(status, securityHeaders({
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  }));
  res.end(body);
}

function hasControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function normalizeDestination(rawValue) {
  let value = String(rawValue || "").trim();

  if (!value) {
    throw createInputError("Paste a URL or deep link first.");
  }

  if (value.length > MAX_URL_LENGTH) {
    throw createInputError(`Links must stay under ${MAX_URL_LENGTH.toLocaleString()} characters.`);
  }

  if (hasControlCharacters(value)) {
    throw createInputError("Links cannot contain hidden control characters.");
  }

  const looksLikeLocalhost = /^localhost(?::\d{1,5})?(?:[/?#]|$)/i.test(value);
  const looksLikeIpAddress = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/?#]|$)/.test(value);
  const looksLikeDomain = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]|$)/i.test(value);

  if (!/^https?:\/\//i.test(value) && looksLikeLocalhost) {
    value = `http://${value}`;
  } else if (!/^https?:\/\//i.test(value) && (looksLikeIpAddress || looksLikeDomain)) {
    value = `https://${value}`;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw createInputError("That does not look like a valid URL or app deep link.");
  }

  const protocol = parsed.protocol.toLowerCase();
  if (BLOCKED_PROTOCOLS.has(protocol)) {
    throw createInputError(`${protocol.replace(":", "")} links are blocked for safety.`);
  }

  if (!/^[a-z][a-z0-9+.-]*:$/.test(protocol)) {
    throw createInputError("The link protocol is not supported.");
  }

  return parsed.href;
}

function normalizeSlug(rawSlug) {
  const slug = String(rawSlug || "").trim().toLowerCase();
  if (!slug) {
    return "";
  }
  if (!/^[a-z0-9_-]{3,48}$/.test(slug)) {
    throw createInputError("Aliases can use 3-48 lowercase letters, numbers, hyphens, or underscores.");
  }
  return slug;
}

function createInputError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function createSlug(existingLinks, length = 7) {
  const used = new Set(existingLinks.map((link) => link.slug));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let slug = "";
    for (let index = 0; index < length; index += 1) {
      slug += BASE62[crypto.randomInt(BASE62.length)];
    }
    slug = slug.toLowerCase();
    if (!used.has(slug)) {
      return slug;
    }
  }
  throw new Error("Could not create a unique short code. Please try again.");
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]\n", "utf8");
  }
}

async function readLinks() {
  await ensureDataFile();
  const text = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(text || "[]");
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed;
}

async function writeLinks(links) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(links, null, 2)}\n`, "utf8");
  await fs.rename(tempFile, DATA_FILE);
}

function publicLink(link, origin) {
  return {
    ...link,
    shortPath: `/s/${link.slug}`,
    shortUrl: `${origin}/s/${link.slug}`
  };
}

function requestOrigin(req) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  const protocol = req.headers["x-forwarded-proto"] || "http";
  return `${protocol}://${host}`;
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(createInputError("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const body = await collectBody(req);
  if (!body.trim()) {
    return {};
  }
  try {
    return JSON.parse(body);
  } catch {
    throw createInputError("Send a valid JSON request body.");
  }
}

async function handleShorten(req, res) {
  const body = await readJsonBody(req);
  const links = await readLinks();
  const originalUrl = normalizeDestination(body.url || body.originalUrl);
  const requestedSlug = normalizeSlug(body.customSlug || body.slug);
  const now = new Date().toISOString();
  const slug = requestedSlug || createSlug(links);

  if (links.some((link) => link.slug === slug)) {
    sendJson(res, 409, { error: "That alias is already taken. Try another one." });
    return;
  }

  const link = {
    id: crypto.randomUUID(),
    slug,
    originalUrl,
    createdAt: now,
    updatedAt: now,
    clicks: 0,
    lastAccessedAt: null
  };

  links.unshift(link);
  await writeLinks(links);
  sendJson(res, 201, { link: publicLink(link, requestOrigin(req)) });
}

async function handleList(req, res) {
  const links = await readLinks();
  const origin = requestOrigin(req);
  sendJson(res, 200, {
    links: links
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((link) => publicLink(link, origin))
  });
}

async function handleDelete(req, res, slug) {
  const links = await readLinks();
  const nextLinks = links.filter((link) => link.slug !== slug);

  if (nextLinks.length === links.length) {
    sendJson(res, 404, { error: "Short link was not found." });
    return;
  }

  await writeLinks(nextLinks);
  sendJson(res, 200, { ok: true });
}

async function handleRedirect(req, res, slug) {
  const links = await readLinks();
  const link = links.find((entry) => entry.slug === slug);

  if (!link) {
    res.writeHead(404, securityHeaders({ "Content-Type": "text/html; charset=utf-8" }));
    res.end(`<!doctype html><title>Short link not found</title><body><h1>Short link not found</h1><p>The code <strong>${escapeHtml(slug)}</strong> is not saved on this server.</p><p><a href="/">Create a new short link</a></p></body>`);
    return;
  }

  link.clicks = Number(link.clicks || 0) + 1;
  link.lastAccessedAt = new Date().toISOString();
  link.updatedAt = link.lastAccessedAt;
  await writeLinks(links);

  res.writeHead(302, securityHeaders({
    "Location": link.originalUrl,
    "Cache-Control": "no-store"
  }));
  res.end();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[character]));
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(safePath);
  const filePath = path.normalize(path.join(PUBLIC_DIR, decodedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, securityHeaders({
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": contentType.includes("text/html") ? "no-store" : "public, max-age=3600"
    }));
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendText(res, 404, "Not found");
      return;
    }
    throw error;
  }
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, app: "short-url-workbench" });
    return;
  }

  if (req.method === "GET" && pathname === "/api/links") {
    await handleList(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/shorten") {
    await handleShorten(req, res);
    return;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/links/")) {
    await handleDelete(req, res, decodeURIComponent(pathname.slice("/api/links/".length)));
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && pathname.startsWith("/s/")) {
    await handleRedirect(req, res, decodeURIComponent(pathname.slice("/s/".length)));
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res, pathname);
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" }, { "Allow": "GET, HEAD, POST, DELETE" });
}

const server = http.createServer((req, res) => {
  router(req, res).catch((error) => {
    const status = error.statusCode || 500;
    const message = status >= 500 ? "Something went wrong on the server." : error.message;
    if (status >= 500) {
      console.error(error);
    }
    sendJson(res, status, { error: message });
  });
});

ensureDataFile()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Short URL app is running at http://${HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Could not start Short URL app:", error);
    process.exit(1);
  });
