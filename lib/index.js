var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// src/errors.ts
var CoreError = class extends Error {
  /** The stable code (host adapters key off this, not the message). */
  code;
  /** The original cause (when this error translates another error). */
  cause;
  constructor(message, code, options) {
    super(message, { cause: options?.cause });
    this.name = "CoreError";
    this.code = code;
    this.cause = options?.cause;
  }
};
function isCoreError(error) {
  return error instanceof CoreError;
}
function toCoreError(error, message, code) {
  if (isCoreError(error)) return error;
  return new CoreError(message, code, { cause: error });
}
function errorMessage(error) {
  if (isCoreError(error)) return error.message;
  return String(error);
}
function errorCodeOf(error) {
  return isCoreError(error) ? error.code : "WEB_INTERNAL";
}

// src/config.ts
var DEFAULT_ENGINES = ["ddg", "bing"];
var KNOWN_ENGINES = [
  "ddg",
  "bing",
  "searxng",
  "exa",
  "jina",
  "tavily",
  "brave",
  "ollama",
  "openai",
  "xai",
  "anthropic",
  "deepseek",
  "gemini",
  "perplexity"
];
function assertPositiveInt(name, value) {
  if (!Number.isInteger(value) || value <= 0) throw new CoreError(`${name} must be a positive integer`, "WEB_BAD_REQUEST");
}
function assertString(name, value) {
  if (typeof value !== "string") throw new CoreError(`${name} must be a string`, "WEB_BAD_REQUEST");
}
function assertBoolean(name, value) {
  if (typeof value !== "boolean") throw new CoreError(`${name} must be a boolean`, "WEB_BAD_REQUEST");
}
function assertAbsoluteUrl(name, value) {
  if (!URL.canParse(value) || !/^https?:$/.test(new URL(value).protocol)) {
    throw new CoreError(`${name} must be an absolute http(s) URL (got "${value}")`, "WEB_BAD_REQUEST");
  }
}
function resolveCoreConfig(partial, stateDir) {
  const config = partial ?? {};
  const s = config.search ?? {};
  const engines = s.engines ?? [...DEFAULT_ENGINES];
  if (engines.length === 0) throw new CoreError("search.engines must not be empty", "WEB_BAD_REQUEST");
  for (const id of engines) {
    if (!KNOWN_ENGINES.includes(id)) {
      throw new CoreError(`search.engines: unknown engine "${id}" (known: ${KNOWN_ENGINES.join(", ")})`, "WEB_BAD_REQUEST");
    }
  }
  const search = {
    engines: [...engines],
    mode: s.mode ?? "fallback",
    region: s.region ?? "",
    freshness: s.freshness ?? "",
    rateLimitPerSec: s.rateLimitPerSec ?? 1,
    timeoutMs: s.timeoutMs ?? 3e4,
    cacheTtlMs: s.cacheTtlMs ?? 9e5,
    maxSerpBytes: s.maxSerpBytes ?? 2 * 1024 * 1024,
    enrich: {
      enabled: s.enrich?.enabled ?? true,
      fetchLimit: s.enrich?.fetchLimit ?? 6,
      keep: s.enrich?.keep ?? 5,
      fetchTimeoutMs: s.enrich?.fetchTimeoutMs ?? 1e4
    },
    embed: s.embed?.endpoint !== void 0 ? {
      endpoint: s.embed.endpoint,
      model: s.embed.model ?? "nomic-embed-text",
      timeoutMs: s.embed.timeoutMs ?? 1e4
    } : void 0
  };
  assertPositiveInt("search.rateLimitPerSec", search.rateLimitPerSec);
  assertPositiveInt("search.timeoutMs", search.timeoutMs);
  assertPositiveInt("search.cacheTtlMs", search.cacheTtlMs);
  assertPositiveInt("search.maxSerpBytes", search.maxSerpBytes);
  assertPositiveInt("search.enrich.fetchLimit", search.enrich.fetchLimit);
  assertPositiveInt("search.enrich.keep", search.enrich.keep);
  if (search.embed !== void 0) {
    assertAbsoluteUrl("search.embed.endpoint", search.embed.endpoint);
    assertPositiveInt("search.embed.timeoutMs", search.embed.timeoutMs);
  }
  const f = config.fetch ?? {};
  const fetch2 = {
    cacheTtlMs: f.cacheTtlMs ?? 24 * 60 * 60 * 1e3,
    revalidate: f.revalidate ?? true,
    maxBodyBytes: f.maxBodyBytes ?? 5 * 1024 * 1024,
    maxOutputChars: f.maxOutputChars ?? 1e5,
    timeoutMs: f.timeoutMs ?? 3e4,
    maxRedirects: f.maxRedirects ?? 5,
    allowPrivateNetworks: f.allowPrivateNetworks ?? false,
    pdf: {
      enabled: f.pdf?.enabled ?? true,
      maxSizeBytes: f.pdf?.maxSizeBytes ?? 20 * 1024 * 1024,
      maxPages: f.pdf?.maxPages ?? 50
    },
    video: {
      enabled: f.video?.enabled ?? true
    },
    github: {
      enabled: f.github?.enabled ?? true,
      maxCloneBytes: f.github?.maxCloneBytes ?? 200 * 1024 * 1024,
      maxTreeEntries: f.github?.maxTreeEntries ?? 500
    }
  };
  assertPositiveInt("fetch.cacheTtlMs", fetch2.cacheTtlMs);
  assertPositiveInt("fetch.maxBodyBytes", fetch2.maxBodyBytes);
  assertPositiveInt("fetch.maxOutputChars", fetch2.maxOutputChars);
  assertPositiveInt("fetch.timeoutMs", fetch2.timeoutMs);
  if (!Number.isInteger(fetch2.maxRedirects) || fetch2.maxRedirects < 0) {
    throw new CoreError("fetch.maxRedirects must be a non-negative integer", "WEB_BAD_REQUEST");
  }
  assertBoolean("fetch.revalidate", fetch2.revalidate);
  assertBoolean("fetch.allowPrivateNetworks", fetch2.allowPrivateNetworks);
  assertBoolean("fetch.pdf.enabled", fetch2.pdf.enabled);
  assertPositiveInt("fetch.pdf.maxSizeBytes", fetch2.pdf.maxSizeBytes);
  assertPositiveInt("fetch.pdf.maxPages", fetch2.pdf.maxPages);
  assertBoolean("fetch.video.enabled", fetch2.video.enabled);
  assertBoolean("fetch.github.enabled", fetch2.github.enabled);
  assertPositiveInt("fetch.github.maxCloneBytes", fetch2.github.maxCloneBytes);
  assertPositiveInt("fetch.github.maxTreeEntries", fetch2.github.maxTreeEntries);
  const p = config.platforms ?? {};
  const platforms = {
    enabled: p.enabled ?? true,
    maxResults: p.maxResults ?? 20,
    timeoutMs: p.timeoutMs ?? 3e4,
    maxBytes: p.maxBytes ?? 5 * 1024 * 1024,
    allowPrivateNetworks: p.allowPrivateNetworks ?? false,
    platforms: p.platforms ?? [],
    rulePackPaths: p.rulePackPaths ?? []
  };
  assertPositiveInt("platforms.maxResults", platforms.maxResults);
  assertPositiveInt("platforms.timeoutMs", platforms.timeoutMs);
  assertPositiveInt("platforms.maxBytes", platforms.maxBytes);
  const st = config.store ?? {};
  let storePath = st.path;
  if (storePath !== void 0) assertString("store.path", storePath);
  const store = {
    path: storePath ?? `${stateDir.replace(/\/+$/, "")}/web.db`,
    evictLimits: {
      maxSearches: st.evictLimits?.maxSearches ?? 1e3,
      maxPages: st.evictLimits?.maxPages ?? 500
    }
  };
  assertPositiveInt("store.evictLimits.maxSearches", store.evictLimits.maxSearches);
  assertPositiveInt("store.evictLimits.maxPages", store.evictLimits.maxPages);
  const ssrfCfg = config.ssrf ?? {};
  const ssrf = { trustEnvProxy: ssrfCfg.trustEnvProxy ?? false };
  assertBoolean("ssrf.trustEnvProxy", ssrf.trustEnvProxy);
  const b = config.browser ?? {};
  const browser = {
    enabled: b.enabled ?? false,
    headless: b.headless ?? true,
    approval: b.approval ?? "navigate",
    allowPrivateNetworks: b.allowPrivateNetworks ?? false,
    maxConcurrentTabs: b.maxConcurrentTabs ?? 1,
    screenshotInlineDefault: b.screenshotInlineDefault ?? false,
    timeoutMs: b.timeoutMs ?? 3e4,
    authProfiles: b.authProfiles ?? {}
  };
  assertPositiveInt("browser.maxConcurrentTabs", browser.maxConcurrentTabs);
  assertPositiveInt("browser.timeoutMs", browser.timeoutMs);
  if (browser.approval !== "never" && browser.approval !== "navigate" && browser.approval !== "all") {
    throw new CoreError(`browser.approval must be one of never|navigate|all (got "${browser.approval}")`, "WEB_BAD_REQUEST");
  }
  const providers = {
    openai: config.providers?.openai,
    xai: { explicitOnly: true, ...config.providers?.xai },
    anthropic: config.providers?.anthropic,
    deepseek: config.providers?.deepseek,
    gemini: config.providers?.gemini,
    perplexity: config.providers?.perplexity,
    exa: config.providers?.exa,
    tavily: config.providers?.tavily,
    brave: config.providers?.brave,
    jina: config.providers?.jina,
    searxng: config.providers?.searxng,
    ollama: config.providers?.ollama
  };
  for (const [name, value] of Object.entries({
    openai: providers.openai,
    xai: providers.xai,
    anthropic: providers.anthropic,
    deepseek: providers.deepseek,
    gemini: providers.gemini,
    perplexity: providers.perplexity
  })) {
    if (value?.baseUrl !== void 0) assertAbsoluteUrl(`providers.${name}.baseUrl`, value.baseUrl);
    if (value?.timeoutMs !== void 0) assertPositiveInt(`providers.${name}.timeoutMs`, value.timeoutMs);
  }
  for (const name of ["exa", "tavily", "brave", "jina"]) {
    const value = providers[name];
    if (value?.baseUrl !== void 0) assertAbsoluteUrl(`providers.${name}.baseUrl`, value.baseUrl);
  }
  if (providers.searxng?.endpoint !== void 0) assertAbsoluteUrl("providers.searxng.endpoint", providers.searxng.endpoint);
  if (providers.ollama?.endpoint !== void 0) assertAbsoluteUrl("providers.ollama.endpoint", providers.ollama.endpoint);
  const e = config.extended ?? {};
  const extended = {
    pdf: {
      enabled: e.pdf?.enabled ?? false,
      provider: e.pdf?.provider ?? "auto",
      maxSizeMB: e.pdf?.maxSizeMB ?? 20,
      maxPages: e.pdf?.maxPages ?? 100
    },
    video: { enabled: e.video?.enabled ?? false },
    github: { clone: { enabled: e.github?.clone?.enabled ?? false, maxSizeMB: e.github?.clone?.maxSizeMB ?? 350 } },
    curator: {
      enabled: e.curator?.enabled ?? false,
      bind: e.curator?.bind ?? "127.0.0.1",
      host: e.curator?.host ?? "localhost",
      remote: e.curator?.remote ?? false
    },
    contentCache: {
      maxEntries: e.contentCache?.maxEntries ?? 128,
      maxBytes: e.contentCache?.maxBytes ?? 128 * 1024 * 1024,
      ttlMs: e.contentCache?.ttlMs ?? 60 * 60 * 1e3
    }
  };
  assertPositiveInt("extended.pdf.maxSizeMB", extended.pdf.maxSizeMB);
  assertPositiveInt("extended.pdf.maxPages", extended.pdf.maxPages);
  assertPositiveInt("extended.contentCache.maxEntries", extended.contentCache.maxEntries);
  assertPositiveInt("extended.contentCache.maxBytes", extended.contentCache.maxBytes);
  assertPositiveInt("extended.contentCache.ttlMs", extended.contentCache.ttlMs);
  return { search, fetch: fetch2, platforms, store, ssrf, browser, providers, extended };
}

// src/user-agent.ts
var PRODUCT_VERSION = "0.1.0";
var PRODUCT_USER_AGENT = `agents-web-search/${PRODUCT_VERSION} (+https://github.com/agents-web-search/core)`;
var BROWSER_LIKE_USER_AGENT = `Mozilla/5.0 (compatible; agents-web-search/${PRODUCT_VERSION})`;

// src/credential.ts
function makeSecretResolver(host) {
  return async (spec) => {
    if (spec.explicit !== void 0 && spec.explicit.length > 0) return spec.explicit;
    try {
      const fromHost = await host.credential(spec.name);
      if (fromHost !== void 0 && fromHost.length > 0) return fromHost;
    } catch (error) {
      host.log?.("warn", `credential(${spec.name}) failed; falling back to env`, { error: String(error) });
    }
    const fromEnv = spec.env !== void 0 ? process.env[spec.env] : void 0;
    if (fromEnv !== void 0 && fromEnv.length > 0) return fromEnv;
    return void 0;
  };
}

// src/search/bingparse.ts
import * as cheerio from "cheerio";
function isHttpUrl(value) {
  if (!value.startsWith("http://") && !value.startsWith("https://")) return false;
  try {
    return URL.canParse(value);
  } catch {
    return false;
  }
}
function parseBingSerp(html) {
  const $ = cheerio.load(html);
  const results = [];
  $("li.b_algo").each((_, el) => {
    const $el = $(el);
    const $title = $el.find("h2 a").first();
    const href = $title.attr("href");
    const title = $title.text().trim();
    if (href === void 0 || !isHttpUrl(href) || title.length === 0) return;
    const snippet = $el.find(".b_caption p, .b_caption").first().text().replace(/\s+/g, " ").trim();
    results.push({ url: href, title, snippet });
  });
  return results;
}
function isBlockedBingSerp(html) {
  if (parseBingSerp(html).length > 0) return false;
  return /consent\.microsoft|challenge-form|captcha|are you a robot/i.test(html);
}

// src/timeout.ts
var TimeoutReason = class extends Error {
  constructor(code, timeoutMs) {
    super(`${code} after ${timeoutMs}ms`);
    this.code = code;
    this.timeoutMs = timeoutMs;
  }
  code;
  timeoutMs;
  name = "TimeoutReason";
};
var MAX_TIMER_DELAY_MS = 2147483647;
function assertTimerDelay(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`deadline timeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  }
}
function deadline(upstream, timeoutMs, code) {
  if (timeoutMs <= 0) {
    return { signal: upstream ?? new AbortController().signal, [Symbol.dispose]() {
    } };
  }
  assertTimerDelay(timeoutMs);
  const timer = new AbortController();
  const id = setTimeout(() => {
    timer.abort(new TimeoutReason(code, timeoutMs));
  }, timeoutMs);
  return {
    signal: upstream !== void 0 ? AbortSignal.any([upstream, timer.signal]) : timer.signal,
    [Symbol.dispose]() {
      clearTimeout(id);
    }
  };
}
function timeoutOf(x, code) {
  const reason = x.reason;
  if (!(reason instanceof TimeoutReason)) return void 0;
  return code === void 0 || reason.code === code ? reason : void 0;
}

// src/search/http.ts
function classifyWebError(error, signal, context) {
  const timeout = timeoutOf(signal, "WEB_SEARCH_TIMEOUT");
  if (timeout !== void 0) return new CoreError("web search timed out", "WEB_SEARCH_TIMEOUT", { cause: timeout });
  if (signal.aborted) return new CoreError("web search aborted", "WEB_ABORTED", { cause: error });
  return new CoreError(`${context}: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
}
async function readCappedText(response, maxBytes) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) throw new Error(`body exceeds ${maxBytes} bytes`);
  }
  if (response.body === null) return "";
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, Math.max(0, remaining)));
        total += Math.max(0, remaining);
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {
    });
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

// src/search/rate-limit.ts
var RateLimiter = class {
  constructor(options) {
    this.options = options;
    if (!(options.perSec > 0)) throw new Error("RateLimiter: perSec must be positive");
    this.capacity = Math.max(1, options.burst ?? Math.ceil(options.perSec));
    this.refillPerMs = options.perSec / 1e3;
    this.tokens = this.capacity;
    this.lastRefill = (options.now ?? Date.now)();
  }
  options;
  capacity;
  refillPerMs;
  tokens;
  lastRefill;
  /**
   * Wait until one token is available, then consume it.
   * @param signal - optional caller cancellation; an aborted wait rejects with an `AbortError`.
   */
  async acquire(signal) {
    for (; ; ) {
      this.refill();
      if (signal?.aborted) throw new DOMException("rate limit wait aborted", "AbortError");
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      const waitMs = Math.ceil(deficit / this.refillPerMs) + this.jitter();
      await (this.options.sleep ?? defaultSleep)(waitMs, signal);
    }
  }
  refill() {
    const now = (this.options.now ?? Date.now)();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }
  jitter() {
    const max = this.options.jitterMs ?? 100;
    return Math.floor(Math.random() * (max + 1));
  }
};
function defaultSleep(ms, signal) {
  return new Promise((resolve2, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("rate limit wait aborted", "AbortError"));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve2();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("rate limit wait aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// src/search/url.ts
var TRACKING_PARAM = /^(utm_|fbclid|gclid|mc_(eid|cid)|ref|source)/i;
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key);
    }
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) parsed.pathname = parsed.pathname.slice(0, -1);
    return parsed.toString();
  } catch {
    return url;
  }
}

// src/search/engines/bing.ts
var BING_DEFAULT_ENDPOINT = "https://www.bing.com/search";
var BingEngine = class {
  constructor(options) {
    this.options = options;
    this.limiter = new RateLimiter({ perSec: options.rateLimitPerSec });
  }
  options;
  id = "bing";
  limiter;
  /** Cheap local check: the endpoint must parse as an absolute URL. No network. */
  available() {
    return URL.canParse(this.options.endpoint);
  }
  /** Fetch and parse one SERP. */
  async search(query, maxResults, signal) {
    const html = await this.fetchSerp(query, maxResults, signal);
    if (isBlockedBingSerp(html)) {
      throw new CoreError(
        "Bing returned a consent or challenge page instead of results; slow down or try again later",
        "WEB_PROVIDER_ERROR"
      );
    }
    return { sources: this.filterAndDedupe(parseBingSerp(html)).slice(0, maxResults) };
  }
  serpUrl(query, maxResults) {
    const url = new URL(this.options.endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(maxResults, 50)));
    if (this.options.market.length > 0) url.searchParams.set("setmkt", this.options.market);
    const qft = this.freshnessQft();
    if (qft.length > 0) url.searchParams.set("qft", qft);
    return url.toString();
  }
  /** Map the freshness setting to Bing's `qft` filter value. */
  freshnessQft() {
    const freshness = this.options.freshness ?? "";
    switch (freshness) {
      case "24h":
        return "+filter:ex1";
      case "week":
        return "+filter:ex2";
      case "month":
        return "+filter:ex3";
      case "year":
        return "+filter:ex4";
      default:
        return "";
    }
  }
  /** Fetch the SERP document; block-like failures surface as `CoreError`. */
  async fetchSerp(query, maxResults, signal) {
    await this.limiter.acquire(signal);
    let response;
    try {
      response = await fetch(this.serpUrl(query, maxResults), {
        method: "GET",
        redirect: "follow",
        headers: { "user-agent": this.options.userAgent, "accept": "text/html" },
        signal
      });
    } catch (error) {
      throw classifyWebError(error, signal, "Bing search request failed");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CoreError(`Bing search request failed (HTTP ${response.status})`, "WEB_PROVIDER_ERROR");
    }
    try {
      return await readCappedText(response, this.options.maxSerpBytes);
    } catch (error) {
      throw classifyWebError(error, signal, "Bing search body read failed");
    }
  }
  /** Drop blocked domains and duplicate URLs (first occurrence wins). */
  filterAndDedupe(results) {
    const seen = /* @__PURE__ */ new Set();
    const sources = [];
    for (const result of results) {
      const key = normalizeUrl(result.url);
      if (seen.has(key)) continue;
      if (this.isBlockedDomain(result.url)) continue;
      seen.add(key);
      sources.push({
        url: result.url,
        ...result.title.length > 0 ? { title: result.title } : {},
        ...result.snippet.length > 0 ? { snippet: result.snippet } : {}
      });
    }
    return sources;
  }
  isBlockedDomain(url) {
    if (this.options.blockedDomains.length === 0) return false;
    let hostname;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return true;
    }
    return this.options.blockedDomains.some((domain) => {
      const normalized = domain.toLowerCase().replace(/^\./, "");
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
  }
};

// src/search/serpparse.ts
import * as cheerio2 from "cheerio";
function parseDuckDuckGoSerp(html) {
  const $ = cheerio2.load(html);
  const results = [];
  $(".result").each((_index, element) => {
    const $result = $(element);
    const $link = $result.find("a.result__a").first();
    const url = decodeDuckDuckGoHref($link.attr("href") ?? "");
    if (!isHttpUrl2(url)) return;
    const title = $link.text().replace(/\s+/g, " ").trim();
    const snippet = $result.find(".result__snippet").first().text().replace(/\s+/g, " ").trim();
    if (title.length === 0 && snippet.length === 0) return;
    results.push({ url, title, snippet });
  });
  return results;
}
function decodeDuckDuckGoHref(href) {
  const trimmed = href.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.startsWith("//duckduckgo.com/l/") || trimmed.startsWith("https://duckduckgo.com/l/")) {
    try {
      const wrapper = new URL(trimmed.startsWith("http") ? trimmed : `https:${trimmed}`);
      const target = wrapper.searchParams.get("uddg");
      if (target !== null && target.length > 0) return decodeURIComponent(target);
      return "";
    } catch {
      return "";
    }
  }
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return trimmed;
}
function isHttpUrl2(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
function isBlockedSerp(html) {
  return /anomaly-modal|challenge-form|captcha|not a robot/i.test(html);
}

// src/search/engines/ddg.ts
var DUCKDUCKGO_DEFAULT_ENDPOINT = "https://html.duckduckgo.com/html/";
var DuckDuckGoEngine = class {
  constructor(options) {
    this.options = options;
    this.limiter = new RateLimiter({ perSec: options.rateLimitPerSec });
  }
  options;
  id = "ddg";
  limiter;
  /** Cheap local check: the endpoint must parse as an absolute URL. No network. */
  available() {
    return URL.canParse(this.endpoint());
  }
  /** Fetch and parse one SERP. */
  async search(query, maxResults, signal) {
    const html = await this.fetchSerp(query, signal);
    if (isBlockedSerp(html)) {
      throw new CoreError(
        "DuckDuckGo returned a bot challenge instead of results; slow down or try again later",
        "WEB_PROVIDER_ERROR"
      );
    }
    return { sources: this.filterAndDedupe(parseDuckDuckGoSerp(html)).slice(0, maxResults) };
  }
  endpoint() {
    return this.options.endpoint.endsWith("/") ? this.options.endpoint : `${this.options.endpoint}/`;
  }
  serpUrl(query) {
    const params = new URLSearchParams({ q: query });
    if (this.options.region.length > 0) params.set("kl", this.options.region);
    const base = this.endpoint();
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}${params.toString()}`;
  }
  /** Fetch the SERP document; block-like failures surface as `CoreError`. */
  async fetchSerp(query, signal) {
    await this.limiter.acquire(signal);
    let response;
    try {
      response = await fetch(this.serpUrl(query), {
        method: "GET",
        redirect: "follow",
        headers: { "user-agent": this.options.userAgent, "accept": "text/html" },
        signal
      });
    } catch (error) {
      throw classifyWebError(error, signal, "DuckDuckGo search request failed");
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 403 || response.status === 429 || response.status === 503) {
        throw new CoreError(
          `DuckDuckGo blocked the search request (HTTP ${response.status}); slow down or try again later`,
          "WEB_PROVIDER_ERROR"
        );
      }
      throw new CoreError(`DuckDuckGo search request failed (HTTP ${response.status})`, "WEB_PROVIDER_ERROR");
    }
    try {
      return await readCappedText(response, this.options.maxSerpBytes);
    } catch (error) {
      throw classifyWebError(error, signal, "DuckDuckGo search body read failed");
    }
  }
  /** Drop blocked domains and duplicate URLs (first occurrence wins). */
  filterAndDedupe(results) {
    const seen = /* @__PURE__ */ new Set();
    const sources = [];
    for (const result of results) {
      const key = normalizeUrl(result.url);
      if (seen.has(key)) continue;
      if (this.isBlockedDomain(result.url)) continue;
      seen.add(key);
      sources.push({
        url: result.url,
        ...result.title.length > 0 ? { title: result.title } : {},
        ...result.snippet.length > 0 ? { snippet: result.snippet } : {}
      });
    }
    return sources;
  }
  isBlockedDomain(url) {
    if (this.options.blockedDomains.length === 0) return false;
    let hostname;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return true;
    }
    return this.options.blockedDomains.some((domain) => {
      const normalized = domain.toLowerCase().replace(/^\./, "");
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
  }
};

// src/search/engines/exa.ts
var EXA_DEFAULT_BASE_URL = "https://api.exa.ai";
var ExaEngine = class {
  id = "exa";
  options;
  cachedKey = "";
  constructor(options) {
    this.options = options;
    this.cachedKey = options.apiKey ?? "";
  }
  /** Available when a key is present (static, or a resolver that may yield one). */
  available() {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== void 0;
  }
  /** Run one Exa search (key resolved per search when a resolver is set). */
  async search(query, maxResults, signal) {
    if (this.options.resolveSecret !== void 0) {
      const resolved = await this.options.resolveSecret({
        name: "websearch:exa",
        explicit: this.options.apiKey,
        env: "EXA_API_KEY"
      }) ?? "";
      if (resolved !== this.cachedKey) this.cachedKey = resolved;
    }
    if (this.cachedKey.length === 0) {
      throw new CoreError("the exa engine is enabled, but no API key is available (config, credentials, or EXA_API_KEY)", "WEB_AUTH");
    }
    const base = (this.options.baseUrl ?? EXA_DEFAULT_BASE_URL).replace(/\/+$/, "");
    const body = {
      query,
      numResults: maxResults,
      type: this.options.searchType ?? "auto",
      contents: { text: { highlights: { numSentences: this.options.highlightsPerResult ?? 3 } } }
    };
    let response;
    try {
      response = await fetch(`${base}/search`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.cachedKey,
          "user-agent": this.options.userAgent
        },
        body: JSON.stringify(body),
        signal
      });
    } catch (error) {
      throw classifyWebError(error, signal, "Exa search request failed");
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new CoreError(`Exa rejected the API key (HTTP ${response.status})`, "WEB_AUTH", { cause: response });
    }
    if (response.status === 429) {
      await response.body?.cancel();
      throw new CoreError("Exa rate limit exceeded (HTTP 429)", "WEB_QUOTA", { cause: response });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CoreError(`Exa search request failed (HTTP ${response.status})`, "WEB_PROVIDER_ERROR", { cause: response });
    }
    let text;
    try {
      text = await readCappedText(response, 1048576);
    } catch (error) {
      throw classifyWebError(error, signal, "Exa search body read failed");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new CoreError("Exa returned a non-JSON response", "WEB_PARSE_ERROR", { cause: error });
    }
    const sources = this.filterAndDedupe(parsed.results ?? []);
    const content = typeof parsed.answer === "string" && parsed.answer.length > 0 ? parsed.answer : void 0;
    return { sources, ...content !== void 0 ? { content } : {} };
  }
  /** Drop entries without a usable URL and duplicate URLs (first occurrence wins). */
  filterAndDedupe(results) {
    const seen = /* @__PURE__ */ new Set();
    const sources = [];
    for (const result of results) {
      if (typeof result.url !== "string" || result.url.length === 0) continue;
      const key = normalizeUrl(result.url);
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        url: result.url,
        ...typeof result.title === "string" && result.title.length > 0 ? { title: result.title } : {},
        ...typeof result.snippet === "string" && result.snippet.length > 0 ? { snippet: result.snippet } : {},
        ...typeof (result.publishedDate ?? result.published_date) === "string" ? { publishedAt: String(result.publishedDate ?? result.published_date) } : {}
      });
    }
    return sources;
  }
};

// src/search/engines/jina.ts
var JINA_DEFAULT_BASE_URL = "https://s.jina.ai";
var JinaEngine = class {
  constructor(options) {
    this.options = options;
  }
  options;
  id = "jina";
  /** Available when a key is present (static, or a resolver that may yield one). */
  available() {
    const hasKey = (this.options.apiKey?.length ?? 0) > 0 || this.options.resolveSecret !== void 0;
    return hasKey && URL.canParse(this.options.baseURL ?? JINA_DEFAULT_BASE_URL);
  }
  /** Run one search against the Jina API. */
  async search(query, maxResults, signal) {
    let apiKey = this.options.apiKey ?? "";
    if (this.options.resolveSecret !== void 0) {
      const resolved = await this.options.resolveSecret({ name: "websearch:jina", explicit: apiKey, env: "JINA_API_KEY" });
      if (resolved !== void 0 && resolved.length > 0) apiKey = resolved;
    }
    if (apiKey.length === 0) {
      throw new CoreError("the jina engine is enabled, but no API key is available (config, credentials, or JINA_API_KEY)", "WEB_AUTH");
    }
    const url = `${(this.options.baseURL ?? JINA_DEFAULT_BASE_URL).replace(/\/$/, "")}/${encodeURIComponent(query)}`;
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "user-agent": this.options.userAgent,
          "authorization": `Bearer ${apiKey}`,
          "accept": "application/json",
          "x-retain-images": "false"
        },
        signal
      });
    } catch (error) {
      throw classifyWebError(error, signal, "Jina search request failed");
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new CoreError(`Jina rejected the API key (HTTP ${response.status})`, "WEB_AUTH", { cause: response });
    }
    if (response.status === 402 || response.status === 429) {
      await response.body?.cancel();
      throw new CoreError(`Jina quota/rate limit exceeded (HTTP ${response.status})`, "WEB_QUOTA", { cause: response });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CoreError(`Jina search request failed (HTTP ${response.status})`, "WEB_PROVIDER_ERROR", { cause: response });
    }
    let body;
    try {
      body = await readCappedText(response, this.options.maxResponseBytes);
    } catch (error) {
      throw classifyWebError(error, signal, "Jina search body read failed");
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      throw new CoreError(`Jina search returned a non-JSON response: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }
    const sources = [];
    for (const item of parsed.data ?? []) {
      if (item.url === void 0 || item.url.length === 0) continue;
      sources.push({
        url: item.url,
        ...item.title !== void 0 && item.title.length > 0 ? { title: item.title } : {},
        ...item.description !== void 0 && item.description.length > 0 ? { snippet: item.description } : item.content !== void 0 && item.content.length > 0 ? { snippet: item.content.slice(0, 300) } : {}
      });
      if (sources.length >= maxResults) break;
    }
    return { sources };
  }
};

// src/search/engines/ollama.ts
var OLLAMA_DEFAULT_ENDPOINT = "http://localhost:11434";
var OllamaEngine = class {
  id = "ollama";
  options;
  constructor(options) {
    this.options = options;
  }
  endpoint() {
    return (this.options.endpoint ?? OLLAMA_DEFAULT_ENDPOINT).replace(/\/+$/, "");
  }
  /** Cheap local check: the endpoint must parse as an absolute http(s) URL. */
  available() {
    return URL.canParse(this.endpoint());
  }
  async search(query, maxResults, signal) {
    let response;
    try {
      response = await fetch(`${this.endpoint()}/api/experimental/web_search`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": this.options.userAgent },
        body: JSON.stringify({ query, max_results: maxResults }),
        signal
      });
    } catch (error) {
      throw new CoreError(
        `could not reach the Ollama instance at ${this.endpoint()} (is it running with web search enabled?)`,
        "WEB_NETWORK",
        { cause: error }
      );
    }
    if (response.status === 401) {
      await response.body?.cancel();
      throw new CoreError("Ollama web search requires authentication (run `ollama signin`)", "WEB_AUTH", { cause: response });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CoreError(`Ollama web search failed (HTTP ${response.status})`, "WEB_PROVIDER_ERROR", { cause: response });
    }
    let text;
    try {
      text = await readCappedText(response, 1048576);
    } catch (error) {
      throw classifyWebError(error, signal, "Ollama search body read failed");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new CoreError("Ollama returned a non-JSON response", "WEB_PARSE_ERROR", { cause: error });
    }
    const seen = /* @__PURE__ */ new Set();
    const sources = [];
    for (const result of parsed.results ?? []) {
      const url = typeof result.url === "string" ? result.url : "";
      if (url.length === 0 || !URL.canParse(url)) continue;
      const key = normalizeUrl(url);
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        url,
        ...typeof result.title === "string" && result.title.length > 0 ? { title: result.title } : {},
        ...typeof result.content === "string" && result.content.length > 0 ? { snippet: result.content.slice(0, 300) } : {}
      });
      if (sources.length >= maxResults) break;
    }
    return { sources };
  }
};

// src/search/engines/searxng.ts
var SEARXNG_DEFAULT_ENDPOINT = "http://localhost:8080";
var SearXNGEngine = class {
  constructor(options) {
    this.options = options;
    this.limiter = new RateLimiter({ perSec: options.rateLimitPerSec });
  }
  options;
  id = "searxng";
  limiter;
  /** Cheap local check: the endpoint must parse as an absolute URL. No network. */
  available() {
    return URL.canParse(this.endpoint());
  }
  /** Query the SearXNG JSON API and map the results. */
  async search(query, maxResults, signal) {
    const body = await this.fetchJson(query, signal);
    const results = body.results ?? [];
    return { sources: this.filterAndDedupe(results).slice(0, maxResults) };
  }
  endpoint() {
    return this.options.endpoint.replace(/\/$/, "");
  }
  searchUrl(query) {
    const params = new URLSearchParams({ q: query, format: "json" });
    return `${this.endpoint()}/search?${params.toString()}`;
  }
  /** Fetch and parse one SearXNG JSON response. */
  async fetchJson(query, signal) {
    await this.limiter.acquire(signal);
    let response;
    try {
      response = await fetch(this.searchUrl(query), {
        method: "GET",
        redirect: "follow",
        headers: { "user-agent": this.options.userAgent, "accept": "application/json" },
        signal
      });
    } catch (error) {
      throw classifyWebError(error, signal, "SearXNG search request failed");
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 403 || response.status === 429 || response.status === 503) {
        throw new CoreError(
          `SearXNG blocked the search request (HTTP ${response.status}); slow down or try again later`,
          "WEB_PROVIDER_ERROR"
        );
      }
      throw new CoreError(`SearXNG search request failed (HTTP ${response.status})`, "WEB_PROVIDER_ERROR");
    }
    let text;
    try {
      text = await readCappedText(response, this.options.maxSerpBytes);
    } catch (error) {
      throw classifyWebError(error, signal, "SearXNG search body read failed");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new CoreError("SearXNG returned a non-JSON response (is the JSON API enabled?)", "WEB_PROVIDER_ERROR");
    }
  }
  /** Drop blocked domains and duplicate URLs (first occurrence wins). */
  filterAndDedupe(results) {
    const seen = /* @__PURE__ */ new Set();
    const sources = [];
    for (const result of results) {
      if (result.url === void 0 || result.url.length === 0) continue;
      const key = normalizeUrl(result.url);
      if (seen.has(key)) continue;
      if (this.isBlockedDomain(result.url)) continue;
      seen.add(key);
      sources.push({
        url: result.url,
        ...result.title?.length ? { title: result.title } : {},
        ...result.content?.length ? { snippet: result.content } : {}
      });
    }
    return sources;
  }
  isBlockedDomain(url) {
    if (this.options.blockedDomains.length === 0) return false;
    let hostname;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return true;
    }
    return this.options.blockedDomains.some((domain) => {
      const normalized = domain.toLowerCase().replace(/^\./, "");
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
  }
};

// src/search/engines/tavily.ts
var TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";
var TavilyEngine = class {
  id = "tavily";
  options;
  cachedKey = "";
  constructor(options) {
    this.options = options;
    this.cachedKey = options.apiKey ?? "";
  }
  available() {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== void 0;
  }
  async search(query, maxResults, signal) {
    if (this.options.resolveSecret !== void 0) {
      const resolved = await this.options.resolveSecret({
        name: "websearch:tavily",
        explicit: this.options.apiKey,
        env: "TAVILY_API_KEY"
      }) ?? "";
      if (resolved !== this.cachedKey) this.cachedKey = resolved;
    }
    if (this.cachedKey.length === 0) {
      throw new CoreError("the tavily engine is enabled, but no API key is available (config, credentials, or TAVILY_API_KEY)", "WEB_AUTH");
    }
    const base = (this.options.baseUrl ?? TAVILY_DEFAULT_BASE_URL).replace(/\/+$/, "");
    const body = {
      query,
      max_results: maxResults,
      search_depth: this.options.depth ?? "basic",
      include_answer: true
    };
    let response;
    try {
      response = await fetch(`${base}/search`, {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": `Bearer ${this.cachedKey}`, "user-agent": this.options.userAgent },
        body: JSON.stringify(body),
        signal
      });
    } catch (error) {
      throw classifyWebError(error, signal, "Tavily search request failed");
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new CoreError(`Tavily rejected the API key (HTTP ${response.status})`, "WEB_AUTH", { cause: response });
    }
    if (response.status === 429) {
      await response.body?.cancel();
      throw new CoreError("Tavily rate limit exceeded (HTTP 429)", "WEB_QUOTA", { cause: response });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CoreError(`Tavily search request failed (HTTP ${response.status})`, "WEB_PROVIDER_ERROR", { cause: response });
    }
    let text;
    try {
      text = await readCappedText(response, 1048576);
    } catch (error) {
      throw classifyWebError(error, signal, "Tavily search body read failed");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new CoreError("Tavily returned a non-JSON response", "WEB_PARSE_ERROR", { cause: error });
    }
    const sources = this.filterAndDedupe(parsed.results ?? []);
    const content = typeof parsed.answer === "string" && parsed.answer.length > 0 ? parsed.answer : void 0;
    return { sources, ...content !== void 0 ? { content } : {} };
  }
  filterAndDedupe(results) {
    const seen = /* @__PURE__ */ new Set();
    const sources = [];
    for (const result of results) {
      if (typeof result.url !== "string" || result.url.length === 0) continue;
      const key = normalizeUrl(result.url);
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        url: result.url,
        ...typeof result.title === "string" && result.title.length > 0 ? { title: result.title } : {},
        ...typeof result.content === "string" && result.content.length > 0 ? { snippet: result.content.slice(0, 300) } : {}
      });
    }
    return sources;
  }
};

// src/search/engines/brave.ts
var BRAVE_DEFAULT_BASE_URL = "https://api.search.brave.com";
function braveFreshness(freshness) {
  switch (freshness) {
    case "24h":
      return "pd";
    case "week":
      return "pw";
    case "month":
      return "pm";
    case "year":
      return "py";
    default:
      return "";
  }
}
var BraveEngine = class {
  id = "brave";
  options;
  cachedKey = "";
  constructor(options) {
    this.options = options;
    this.cachedKey = options.apiKey ?? "";
  }
  available() {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== void 0;
  }
  async search(query, maxResults, signal) {
    if (this.options.resolveSecret !== void 0) {
      const resolved = await this.options.resolveSecret({
        name: "websearch:brave",
        explicit: this.options.apiKey,
        env: "BRAVE_API_KEY"
      }) ?? "";
      if (resolved !== this.cachedKey) this.cachedKey = resolved;
    }
    if (this.cachedKey.length === 0) {
      throw new CoreError("the brave engine is enabled, but no API key is available (config, credentials, or BRAVE_API_KEY)", "WEB_AUTH");
    }
    const base = (this.options.baseUrl ?? BRAVE_DEFAULT_BASE_URL).replace(/\/+$/, "");
    const params = new URLSearchParams({ q: query, count: String(Math.min(maxResults, 20)) });
    if (this.options.country !== void 0 && this.options.country.length > 0) params.set("country", this.options.country);
    const freshness = braveFreshness(this.options.freshness ?? "");
    if (freshness.length > 0) params.set("freshness", freshness);
    const url = `${base}/res/v1/web/search?${params.toString()}`;
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "accept": "application/json",
          "accept-Encoding": "gzip",
          "X-Subscription-Token": this.cachedKey,
          "user-agent": this.options.userAgent
        },
        signal
      });
    } catch (error) {
      throw classifyWebError(error, signal, "Brave search request failed");
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new CoreError(`Brave rejected the API key (HTTP ${response.status})`, "WEB_AUTH", { cause: response });
    }
    if (response.status === 429) {
      await response.body?.cancel();
      throw new CoreError("Brave rate limit exceeded (HTTP 429)", "WEB_QUOTA", { cause: response });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CoreError(`Brave search request failed (HTTP ${response.status})`, "WEB_PROVIDER_ERROR", { cause: response });
    }
    let text;
    try {
      text = await readCappedText(response, 1048576);
    } catch (error) {
      throw classifyWebError(error, signal, "Brave search body read failed");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new CoreError("Brave returned a non-JSON response", "WEB_PARSE_ERROR", { cause: error });
    }
    return { sources: this.filterAndDedupe(parsed.web?.results ?? []) };
  }
  filterAndDedupe(results) {
    const seen = /* @__PURE__ */ new Set();
    const sources = [];
    for (const result of results) {
      if (typeof result.url !== "string" || result.url.length === 0) continue;
      const key = normalizeUrl(result.url);
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        url: result.url,
        ...typeof result.title === "string" && result.title.length > 0 ? { title: result.title } : {},
        ...typeof result.description === "string" && result.description.length > 0 ? { snippet: result.description } : {},
        ...typeof result.page_age === "string" && result.page_age.length > 0 ? { publishedAt: result.page_age } : {}
      });
    }
    return sources;
  }
};

// src/search/engines/provider-native/common.ts
var MAX_RESPONSE_BYTES = 1048576;
async function providerJson(options) {
  let response;
  try {
    response = await fetch(options.endpoint, {
      method: "POST",
      headers: options.headers,
      body: JSON.stringify(options.body),
      signal: options.signal
    });
  } catch (error) {
    throw classifyWebError(error, options.signal, `${options.engineLabel} search request failed`);
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new CoreError(`${options.engineLabel} rejected the credentials (HTTP ${response.status})`, "WEB_AUTH", { cause: response });
  }
  if (response.status === 402 || response.status === 429) {
    await response.body?.cancel();
    throw new CoreError(`${options.engineLabel} quota/rate limit exceeded (HTTP ${response.status})`, "WEB_QUOTA", { cause: response });
  }
  if (response.status === 404 || response.status === 405 || response.status === 501) {
    await response.body?.cancel();
    throw new CoreError(`${options.engineLabel} does not support hosted web search on this endpoint (HTTP ${response.status})`, "WEB_UNSUPPORTED", { cause: response });
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new CoreError(`${options.engineLabel} search request failed (HTTP ${response.status})`, "WEB_PROVIDER_ERROR", { cause: response });
  }
  let text;
  try {
    text = await readCappedText(response, MAX_RESPONSE_BYTES);
  } catch (error) {
    throw classifyWebError(error, options.signal, `${options.engineLabel} search body read failed`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CoreError(`${options.engineLabel} returned a non-JSON response`, "WEB_PARSE_ERROR", { cause: error });
  }
}
function asString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}

// src/search/engines/provider-native/anthropic.ts
var ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
var DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic/v1";
var ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-5";
var DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";
var ANTHROPIC_DEFAULT_API_VERSION = "2023-06-01";
var DEFAULT_MAX_TOKENS = 4096;
var PRESETS = {
  anthropic: {
    baseUrl: ANTHROPIC_DEFAULT_BASE_URL,
    model: ANTHROPIC_DEFAULT_MODEL,
    name: "websearch:anthropic",
    env: "ANTHROPIC_API_KEY",
    label: "Anthropic"
  },
  deepseek: {
    baseUrl: DEEPSEEK_DEFAULT_BASE_URL,
    model: DEEPSEEK_DEFAULT_MODEL,
    name: "websearch:deepseek",
    env: "DEEPSEEK_API_KEY",
    label: "DeepSeek"
  }
};
var MessagesSearchEngine = class {
  id;
  options;
  preset;
  cachedKey = "";
  constructor(options) {
    this.id = options.id;
    this.options = options;
    this.preset = PRESETS[options.id];
    this.cachedKey = options.apiKey ?? "";
  }
  available() {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== void 0;
  }
  async search(query, maxResults, signal) {
    if (this.options.resolveSecret !== void 0) {
      const resolved = await this.options.resolveSecret({
        name: this.preset.name,
        explicit: this.options.apiKey,
        env: this.preset.env
      }) ?? "";
      if (resolved !== this.cachedKey) this.cachedKey = resolved;
    }
    if (this.cachedKey.length === 0) {
      throw new CoreError(
        `the ${this.id} engine is enabled, but no API key is available (config, credentials, or ${this.preset.env})`,
        "WEB_AUTH"
      );
    }
    const base = (this.options.baseUrl ?? this.preset.baseUrl).replace(/\/+$/, "");
    const body = {
      model: this.options.model ?? this.preset.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      messages: [{ role: "user", content: [{ type: "text", text: query }] }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: Math.min(this.options.maxUses ?? 5, 10) }]
    };
    const parsed = await providerJson({
      endpoint: `${base}/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.cachedKey,
        "anthropic-version": ANTHROPIC_DEFAULT_API_VERSION,
        "user-agent": this.options.userAgent
      },
      body,
      signal,
      engineLabel: this.preset.label
    });
    const sources = [];
    const seen = /* @__PURE__ */ new Set();
    const texts = [];
    for (const block of parsed.content ?? []) {
      if (block.type === "text") {
        const text = asString(block.text);
        if (text !== void 0) texts.push(text);
      } else if (block.type === "web_search_tool_result") {
        for (const result of block.content ?? []) {
          if (result.type !== "web_search_result") continue;
          const url = asString(result.url);
          if (url === void 0 || !URL.canParse(url)) continue;
          const key = normalizeUrl(url);
          if (seen.has(key)) continue;
          seen.add(key);
          sources.push({
            url,
            ...asString(result.title) !== void 0 ? { title: asString(result.title) } : {},
            ...asString(result.snippet) !== void 0 ? { snippet: asString(result.snippet) } : {}
          });
        }
      }
    }
    if (sources.length === 0) {
      throw new CoreError(`${this.preset.label} returned no web search result blocks (stop_reason: ${String(parsed.stop_reason ?? "unknown")})`, "WEB_PARSE_ERROR");
    }
    const content = texts.length > 0 ? texts.join("\n\n").slice(0, 4e3) : void 0;
    return { sources: sources.slice(0, maxResults), ...content !== void 0 ? { content } : {} };
  }
};
function createAnthropicEngine(deps, config) {
  return new MessagesSearchEngine({ ...deps, id: "anthropic", ...config });
}
function createDeepseekEngine(deps, config) {
  return new MessagesSearchEngine({ ...deps, id: "deepseek", maxUses: config?.maxUses ?? 5, ...config });
}

// src/search/engines/provider-native/openai.ts
var OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
var XAI_DEFAULT_BASE_URL = "https://api.x.ai/v1";
var OPENAI_DEFAULT_MODEL = "gpt-5.1";
var XAI_DEFAULT_MODEL = "grok-4.5";
var PRESETS2 = {
  openai: { baseUrl: OPENAI_DEFAULT_BASE_URL, model: OPENAI_DEFAULT_MODEL, name: "websearch:openai", env: "OPENAI_API_KEY", label: "OpenAI" },
  xai: { baseUrl: XAI_DEFAULT_BASE_URL, model: XAI_DEFAULT_MODEL, name: "websearch:xai", env: "XAI_API_KEY", label: "xAI" }
};
var ResponsesSearchEngine = class {
  id;
  options;
  preset;
  cachedKey = "";
  constructor(options) {
    this.id = options.id;
    this.options = options;
    this.preset = PRESETS2[options.id];
    this.cachedKey = options.apiKey ?? "";
  }
  available() {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== void 0;
  }
  async search(query, maxResults, signal) {
    if (this.options.resolveSecret !== void 0) {
      const resolved = await this.options.resolveSecret({
        name: this.preset.name,
        explicit: this.options.apiKey,
        env: this.preset.env
      }) ?? "";
      if (resolved !== this.cachedKey) this.cachedKey = resolved;
    }
    if (this.cachedKey.length === 0) {
      throw new CoreError(
        `the ${this.id} engine is enabled, but no API key is available (config, credentials, or ${this.preset.env})`,
        "WEB_AUTH"
      );
    }
    const base = (this.options.baseUrl ?? this.preset.baseUrl).replace(/\/+$/, "");
    const body = {
      model: this.options.model ?? this.preset.model,
      input: [{ role: "user", content: [{ type: "input_text", text: query }] }],
      tools: [
        {
          type: "web_search",
          web_search_options: { count: Math.min(maxResults, this.options.maxUses ?? 10) }
        }
      ]
    };
    const parsed = await providerJson({
      endpoint: `${base}/responses`,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cachedKey}`,
        "user-agent": this.options.userAgent
      },
      body,
      signal,
      engineLabel: this.preset.label
    });
    const sources = [];
    const seen = /* @__PURE__ */ new Set();
    const texts = [];
    for (const item of parsed.output ?? []) {
      if (item.type !== "message") continue;
      for (const block of item.content ?? []) {
        if (block.type !== "output_text") continue;
        const text = asString(block.text);
        if (text !== void 0) texts.push(text);
        for (const annotation of block.annotations ?? []) {
          const citation = annotation.type === "url_citation" ? annotation.url_citation : void 0;
          const url = citation !== void 0 ? asString(citation.url) : void 0;
          if (url === void 0 || !URL.canParse(url)) continue;
          const key = normalizeUrl(url);
          if (seen.has(key)) continue;
          seen.add(key);
          sources.push({
            url,
            ...asString(citation?.title) !== void 0 ? { title: asString(citation?.title) } : {}
          });
        }
      }
    }
    const content = texts.length > 0 ? texts.join("\n\n").slice(0, 4e3) : void 0;
    return { sources: sources.slice(0, maxResults), ...content !== void 0 ? { content } : {} };
  }
};
function createOpenaiEngine(deps, config) {
  return new ResponsesSearchEngine({ ...deps, id: "openai", ...config });
}
function createXaiEngine(deps, config) {
  return new ResponsesSearchEngine({ ...deps, id: "xai", ...config });
}

// src/search/engines/provider-native/gemini.ts
var GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
var GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
var GeminiEngine = class {
  id = "gemini";
  options;
  cachedKey = "";
  constructor(options) {
    this.options = options;
    this.cachedKey = options.apiKey ?? "";
  }
  available() {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== void 0;
  }
  async search(query, maxResults, signal) {
    let key = this.cachedKey;
    if (this.options.resolveSecret !== void 0) {
      const resolved = await this.options.resolveSecret({
        name: "websearch:gemini",
        explicit: key,
        env: "GEMINI_API_KEY"
      });
      if (resolved !== void 0 && resolved.length > 0) key = resolved;
      else if (key.length === 0) key = process.env["GEMINI_API_KEY"] || process.env["GOOGLE_API_KEY"] || "";
    }
    if (key.length === 0) {
      throw new CoreError("the gemini engine is enabled, but no API key is available (config, credentials, or GEMINI_API_KEY/GOOGLE_API_KEY)", "WEB_AUTH");
    }
    if (key !== this.cachedKey) this.cachedKey = key;
    const base = (this.options.baseUrl ?? GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, "");
    const model = this.options.model ?? GEMINI_DEFAULT_MODEL;
    const body = {
      contents: [{ parts: [{ text: query }] }],
      tools: [{ google_search: {} }]
    };
    const parsed = await providerJson({
      endpoint: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
        "user-agent": this.options.userAgent
      },
      body,
      signal,
      engineLabel: "Gemini"
    });
    const sources = [];
    const seen = /* @__PURE__ */ new Set();
    const texts = [];
    const pushSource = (url, title) => {
      const key2 = normalizeUrl(url);
      if (seen.has(key2)) return;
      seen.add(key2);
      sources.push({ url, ...title !== void 0 ? { title } : {} });
    };
    for (const candidate of parsed.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        const text = asString(part.text);
        if (text !== void 0) texts.push(text);
        const uri = part.citation !== void 0 ? asString(part.citation.sourceAttribution?.uri) : void 0;
        if (uri !== void 0 && URL.canParse(uri)) {
          pushSource(uri, part.citation !== void 0 ? asString(part.citation.sourceAttribution?.title) : void 0);
        }
      }
      for (const chunk of candidate.groundingMetadata?.groundingChunks ?? []) {
        const uri = chunk.web !== void 0 ? asString(chunk.web.uri) : void 0;
        if (uri !== void 0 && URL.canParse(uri)) {
          pushSource(uri, chunk.web !== void 0 ? asString(chunk.web.title) : void 0);
        }
      }
    }
    const content = texts.length > 0 ? texts.join("\n\n").slice(0, 4e3) : void 0;
    return { sources: sources.slice(0, maxResults), ...content !== void 0 ? { content } : {} };
  }
};

// src/search/engines/provider-native/perplexity.ts
var PERPLEXITY_DEFAULT_BASE_URL = "https://api.perplexity.ai";
var PERPLEXITY_DEFAULT_MODEL = "sonar";
var PerplexityEngine = class {
  id = "perplexity";
  options;
  cachedKey = "";
  /** Timestamps of the last requests (10/min guard). */
  recentRequests = [];
  constructor(options) {
    this.options = options;
    this.cachedKey = options.apiKey ?? "";
  }
  available() {
    return this.cachedKey.length > 0 || this.options.resolveSecret !== void 0;
  }
  /** Enforce the 10-requests/minute client-side budget. */
  guardRateLimit() {
    const now = Date.now();
    const windowStart = now - 6e4;
    while (this.recentRequests.length > 0 && (this.recentRequests[0] ?? Infinity) < windowStart) this.recentRequests.shift();
    if (this.recentRequests.length >= 10) {
      throw new CoreError("Perplexity client-side rate limit: at most 10 requests per minute", "WEB_QUOTA");
    }
    this.recentRequests.push(now);
  }
  async search(query, maxResults, signal) {
    if (this.options.resolveSecret !== void 0) {
      const resolved = await this.options.resolveSecret({
        name: "websearch:perplexity",
        explicit: this.options.apiKey,
        env: "PERPLEXITY_API_KEY"
      }) ?? "";
      if (resolved !== this.cachedKey) this.cachedKey = resolved;
    }
    if (this.cachedKey.length === 0) {
      throw new CoreError("the perplexity engine is enabled, but no API key is available (config, credentials, or PERPLEXITY_API_KEY)", "WEB_AUTH");
    }
    this.guardRateLimit();
    const base = (this.options.baseUrl ?? PERPLEXITY_DEFAULT_BASE_URL).replace(/\/+$/, "");
    const body = {
      model: this.options.model ?? PERPLEXITY_DEFAULT_MODEL,
      messages: [{ role: "user", content: query }]
    };
    const parsed = await providerJson({
      endpoint: `${base}/chat/completions`,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cachedKey}`,
        "user-agent": this.options.userAgent
      },
      body,
      signal,
      engineLabel: "Perplexity"
    });
    const content = asString(parsed.choices?.[0]?.message?.content);
    if (content === void 0) {
      throw new CoreError("Perplexity returned no answer content", "WEB_PARSE_ERROR");
    }
    const sources = [];
    const seen = /* @__PURE__ */ new Set();
    for (const citation of parsed.citations ?? []) {
      const url = asString(citation);
      if (url === void 0 || !URL.canParse(url)) continue;
      const key = normalizeUrl(url);
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({ url });
    }
    return { sources: sources.slice(0, maxResults), content };
  }
};

// src/search/engines/factory.ts
var DEFAULT_BLOCKED_DOMAINS = [
  "duckduckgo.com",
  "bing.com",
  "microsoft.com",
  "google.com",
  "googleapis.com",
  "gstatic.com",
  "w3.org",
  "schema.org"
];
function buildEngines(options) {
  const { config, host, userAgent } = options;
  const resolveSecret = makeSecretResolver(host);
  const deps = { userAgent, resolveSecret };
  const rateLimit = config.search.rateLimitPerSec;
  const maxSerpBytes = config.search.maxSerpBytes;
  const providers = config.providers;
  const engines = /* @__PURE__ */ new Map();
  engines.set("ddg", new DuckDuckGoEngine({
    endpoint: DUCKDUCKGO_DEFAULT_ENDPOINT,
    region: config.search.region,
    userAgent,
    rateLimitPerSec: rateLimit,
    maxSerpBytes,
    blockedDomains: DEFAULT_BLOCKED_DOMAINS
  }));
  engines.set("bing", new BingEngine({
    endpoint: BING_DEFAULT_ENDPOINT,
    market: config.search.region,
    userAgent,
    rateLimitPerSec: rateLimit,
    maxSerpBytes,
    blockedDomains: DEFAULT_BLOCKED_DOMAINS,
    freshness: config.search.freshness
  }));
  engines.set("searxng", new SearXNGEngine({
    endpoint: providers.searxng?.endpoint ?? SEARXNG_DEFAULT_ENDPOINT,
    userAgent,
    rateLimitPerSec: rateLimit,
    maxSerpBytes,
    blockedDomains: []
  }));
  engines.set("exa", new ExaEngine({
    ...deps,
    apiKey: providers.exa?.apiKey,
    baseUrl: providers.exa?.baseUrl ?? EXA_DEFAULT_BASE_URL
  }));
  engines.set("jina", new JinaEngine({
    ...deps,
    apiKey: providers.jina?.apiKey,
    baseURL: providers.jina?.baseUrl ?? JINA_DEFAULT_BASE_URL,
    maxResponseBytes: maxSerpBytes
  }));
  engines.set("tavily", new TavilyEngine({
    ...deps,
    apiKey: providers.tavily?.apiKey,
    baseUrl: providers.tavily?.baseUrl ?? TAVILY_DEFAULT_BASE_URL
  }));
  engines.set("brave", new BraveEngine({
    ...deps,
    apiKey: providers.brave?.apiKey,
    baseUrl: providers.brave?.baseUrl ?? BRAVE_DEFAULT_BASE_URL,
    country: config.search.region || void 0,
    freshness: config.search.freshness
  }));
  engines.set("ollama", new OllamaEngine({ ...deps, endpoint: providers.ollama?.endpoint ?? OLLAMA_DEFAULT_ENDPOINT }));
  engines.set("openai", createOpenaiEngine(deps, {
    baseUrl: providers.openai?.baseUrl,
    model: providers.openai?.model,
    apiKey: providers.openai?.apiKey,
    maxUses: providers.openai?.maxUses
  }));
  engines.set("xai", createXaiEngine(deps, {
    baseUrl: providers.xai?.baseUrl,
    model: providers.xai?.model,
    apiKey: providers.xai?.apiKey,
    maxUses: providers.xai?.maxUses
  }));
  engines.set("anthropic", createAnthropicEngine(deps, {
    baseUrl: providers.anthropic?.baseUrl,
    model: providers.anthropic?.model,
    apiKey: providers.anthropic?.apiKey,
    maxUses: providers.anthropic?.maxUses
  }));
  engines.set("deepseek", createDeepseekEngine(deps, {
    baseUrl: providers.deepseek?.baseUrl,
    model: providers.deepseek?.model,
    apiKey: providers.deepseek?.apiKey,
    maxUses: providers.deepseek?.maxUses
  }));
  engines.set("gemini", new GeminiEngine({
    ...deps,
    apiKey: providers.gemini?.apiKey,
    baseUrl: providers.gemini?.baseUrl ?? GEMINI_DEFAULT_BASE_URL,
    model: providers.gemini?.model ?? GEMINI_DEFAULT_MODEL
  }));
  engines.set("perplexity", new PerplexityEngine({
    ...deps,
    apiKey: providers.perplexity?.apiKey,
    baseUrl: providers.perplexity?.baseUrl ?? PERPLEXITY_DEFAULT_BASE_URL,
    model: providers.perplexity?.model ?? PERPLEXITY_DEFAULT_MODEL
  }));
  return engines;
}
function explicitOnlyEngineIds(config) {
  const ids = /* @__PURE__ */ new Set();
  if (config.providers.xai?.explicitOnly !== false) ids.add("xai");
  if (config.providers.openai?.explicitOnly) ids.add("openai");
  if (config.providers.anthropic?.explicitOnly) ids.add("anthropic");
  if (config.providers.deepseek?.explicitOnly) ids.add("deepseek");
  if (config.providers.gemini?.explicitOnly) ids.add("gemini");
  if (config.providers.perplexity?.explicitOnly) ids.add("perplexity");
  return ids;
}

// src/fetch/ssrf.ts
import { lookup } from "node:dns/promises";
var IPV4_BLOCKED = [
  // [network (uint32), prefix length]
  [0, 8],
  // 0.0.0.0/8 "this network"
  [167772160, 8],
  // 10.0.0.0/8 private
  [2130706432, 8],
  // 127.0.0.0/8 loopback
  [2886729728, 12],
  // 172.16.0.0/12 private
  [2851995648, 16],
  // 169.254.0.0/16 link-local (cloud metadata)
  [3232235520, 16],
  // 192.168.0.0/16 private
  [4227858432, 7]
  // fc00::/7 IPv6 ULA (kept here for symmetry; IPv6 handled separately)
];
function ipv4ToUint32(text) {
  const parts = text.split(".");
  if (parts.length !== 4) return void 0;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return void 0;
    const octet = Number(part);
    if (octet > 255) return void 0;
    value = value << 8 | octet;
  }
  return value >>> 0;
}
function inCidr(value, network, prefix) {
  if (prefix === 0) return true;
  const mask = 4294967295 << 32 - prefix >>> 0;
  return (value & mask) === (network & mask);
}
function isPrivateIpv4(text) {
  const value = ipv4ToUint32(text);
  if (value === void 0) return false;
  return IPV4_BLOCKED.some(([network, prefix]) => inCidr(value, network, prefix));
}
function ipv6ToGroups(text) {
  const bare = (text.split("%")[0] ?? "").toLowerCase();
  if (bare.length === 0) return void 0;
  const separatorIndex = bare.indexOf("::");
  const head = separatorIndex === -1 ? bare : bare.slice(0, separatorIndex);
  const tail = separatorIndex === -1 ? void 0 : bare.slice(separatorIndex + 2);
  const headGroups = head.length > 0 ? head.split(":") : [];
  const tailGroups = tail !== void 0 && tail.length > 0 ? tail.split(":") : [];
  const groups = [...headGroups, ...tailGroups];
  if (tail === void 0 && groups.length !== 8) return void 0;
  if (tail !== void 0 && groups.length > 7) return void 0;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return void 0;
  }
  const values = groups.map((group) => Number.parseInt(group, 16));
  const missing = 8 - values.length;
  const expanded = [
    ...values.slice(0, headGroups.length),
    ...Array.from({ length: missing }, () => 0),
    ...values.slice(headGroups.length)
  ];
  return expanded.length === 8 ? expanded : void 0;
}
function isPrivateIpv6(text) {
  const lower = text.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  const groups = ipv6ToGroups(lower);
  if (groups !== void 0) {
    const g0 = groups[0] ?? 0;
    const g1 = groups[1] ?? 0;
    const g2 = groups[2] ?? 0;
    const g3 = groups[3] ?? 0;
    const g4 = groups[4] ?? 0;
    const g5 = groups[5] ?? 0;
    const g6 = groups[6] ?? 0;
    const g7 = groups[7] ?? 0;
    const mapped = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 65535;
    const compatible = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
    const nat64 = g0 === 100 && g1 === 65435 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
    if (mapped || compatible || nat64) {
      const ipv4 = (g6 << 16 | g7) >>> 0;
      const dotted = `${ipv4 >>> 24}.${ipv4 >>> 16 & 255}.${ipv4 >>> 8 & 255}.${ipv4 & 255}`;
      if (isPrivateIpv4(dotted)) return true;
    }
  }
  return false;
}
function isIpLiteral(host) {
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare.includes(":")) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(bare);
}
function isPublicAddress(address) {
  if (address.includes(":")) return !isPrivateIpv6(address);
  return !isPrivateIpv4(address);
}
async function checkSsrf(url, options = {}) {
  if (options.allowPrivate) return { allowed: true };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: "unparseable URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { allowed: false, reason: `protocol ${parsed.protocol} is not allowed (only http/https)` };
  }
  const host = parsed.hostname;
  if (host === "") return { allowed: false, reason: "empty hostname" };
  if (isIpLiteral(host)) {
    const bare = host.replace(/^\[|\]$/g, "");
    if (!isPublicAddress(bare)) {
      return { allowed: false, reason: `host ${host} is a private/reserved address`, addresses: [bare] };
    }
    return { allowed: true, addresses: [bare] };
  }
  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return { allowed: false, reason: `DNS resolution failed for ${host}` };
  }
  if (addresses.length === 0) {
    return { allowed: false, reason: `no addresses resolved for ${host}` };
  }
  const ipStrings = addresses.map((a) => a.address);
  const blocked = ipStrings.filter((ip) => !isPublicAddress(ip));
  if (blocked.length > 0) {
    return { allowed: false, reason: `host ${host} resolves to private/reserved address(es): ${blocked.join(", ")}`, addresses: ipStrings };
  }
  return { allowed: true, addresses: ipStrings };
}
var SsrfBlockedError = class extends Error {
  /** The guard's block reason. */
  reason;
  /** The blocked URL. */
  url;
  constructor(url, reason) {
    super(`SSRF guard blocked ${url}: ${reason}`);
    this.url = url;
    this.reason = reason;
  }
};
var SSRF_MAX_REDIRECTS = 5;
var REDIRECT_STATUSES = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
async function fetchPublic(url, options = {}) {
  const maxRedirects = options.maxRedirects ?? SSRF_MAX_REDIRECTS;
  let currentUrl = url;
  let hops = 0;
  for (; ; ) {
    const check = await checkSsrf(currentUrl, { allowPrivate: options.allowPrivate });
    if (!check.allowed) throw new SsrfBlockedError(currentUrl, check.reason ?? "blocked by the SSRF guard");
    const response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      ...options.headers !== void 0 ? { headers: options.headers } : {},
      ...options.signal !== void 0 ? { signal: options.signal } : {}
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (hops >= maxRedirects) {
      await response.body?.cancel();
      throw new Error(`exceeded the maximum of ${maxRedirects} redirects`);
    }
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (location === null) throw new Error(`redirect (HTTP ${response.status}) without a Location header`);
    let next;
    try {
      next = new URL(location, currentUrl);
    } catch {
      throw new Error(`invalid redirect Location "${location}"`);
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new Error(`redirect to unsupported protocol ${next.protocol}`);
    }
    currentUrl = next.toString();
    hops += 1;
  }
}

// src/search/bm25.ts
function tokenize(text) {
  const matches = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return matches ?? [];
}
function bm25Rank(query, documents, k1 = 1.2, b = 0.75) {
  if (documents.length === 0) return [];
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return documents.map(() => 0);
  const docTokens = documents.map(tokenize);
  const docLengths = docTokens.map((tokens) => tokens.length);
  const avgLength = docLengths.reduce((sum, length) => sum + length, 0) / documents.length;
  const distinctTerms = [...new Set(queryTokens)];
  const df = /* @__PURE__ */ new Map();
  for (const term of distinctTerms) df.set(term, 0);
  for (const tokens of docTokens) {
    const present = new Set(tokens);
    for (const term of distinctTerms) {
      if (present.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const idf = /* @__PURE__ */ new Map();
  const n = documents.length;
  for (const [term, frequency] of df) {
    idf.set(term, Math.log(1 + (n - frequency + 0.5) / (frequency + 0.5)));
  }
  return docTokens.map((tokens, index) => {
    if (tokens.length === 0) return 0;
    const tf = /* @__PURE__ */ new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
    const length = docLengths[index] ?? 0;
    let score = 0;
    for (const term of distinctTerms) {
      const termFrequency = tf.get(term) ?? 0;
      if (termFrequency === 0) continue;
      const inverseDocumentFrequency = idf.get(term) ?? 0;
      score += inverseDocumentFrequency * (termFrequency * (k1 + 1)) / (termFrequency + k1 * (1 - b + b * length / (avgLength || 1)));
    }
    return score;
  });
}

// src/search/embedding.ts
function cosineSimilarity(a, b) {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === void 0 || y === void 0) return 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
async function embeddingRerank(query, snippets, options, signal) {
  if (snippets.length === 0) return [];
  if (options.endpoint.length === 0) return snippets.map((_, i) => i);
  const texts = [query, ...snippets];
  const embeddings = await computeEmbeddings(texts, options, signal);
  if (embeddings.length !== texts.length) return snippets.map((_, i) => i);
  const queryEmbedding = embeddings[0];
  if (queryEmbedding === void 0) return snippets.map((_, i) => i);
  const scores = snippets.map((_, i) => {
    const snippetEmbedding = embeddings[i + 1];
    if (snippetEmbedding === void 0) return 0;
    return cosineSimilarity(queryEmbedding, snippetEmbedding);
  });
  return scores.map((score, i) => ({ score, i })).sort((a, b) => b.score - a.score).map(({ i }) => i);
}
async function computeEmbeddings(texts, options, signal) {
  const url = `${options.endpoint.replace(/\/$/, "")}/embeddings`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": options.userAgent },
      body: JSON.stringify({ model: options.model, input: texts }),
      signal: controller.signal
    });
    if (!response.ok) return [];
    const text = await response.text();
    if (text.length > options.maxResponseBytes) return [];
    const parsed = JSON.parse(text);
    const embeddings = (parsed.data ?? []).map((d) => d.embedding ?? []);
    return embeddings.length === texts.length ? embeddings : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}

// src/search/extract.ts
import * as cheerio3 from "cheerio";
var NON_CONTENT_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "canvas",
  "form",
  "nav",
  "header",
  "footer",
  "aside",
  "button",
  "select",
  "input"
].join(", ");
function extractReadableText(html) {
  const $ = cheerio3.load(html);
  $(NON_CONTENT_SELECTORS).remove();
  const article = $("article").first();
  const main = article.length > 0 ? article : $("main").first();
  const roleMain = main.length > 0 ? main : $('[role="main"]').first();
  const container = roleMain.length > 0 ? roleMain : $("body").length > 0 ? $("body") : $("html");
  return container.text().replace(/\s+/g, " ").trim();
}
function snippetWindow(query, text, maxChars) {
  const lower = text.toLowerCase();
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])].filter((term) => term.length > 1);
  let start = -1;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index !== -1 && (start === -1 || index < start)) start = index;
  }
  if (start === -1) return text.slice(0, maxChars);
  const from = Math.max(0, start - Math.floor(maxChars / 3));
  const window = text.slice(from, from + maxChars);
  return `${from > 0 ? "\u2026" : ""}${window}${from + maxChars < text.length ? "\u2026" : ""}`;
}

// src/search/enrich.ts
async function enrichSources(query, sources, keep, options, signal) {
  const candidates = sources;
  const texts = new Array(candidates.length).fill(void 0);
  let next = 0;
  const workerCount = Math.min(options.concurrency, candidates.length);
  const workers = [];
  for (let worker = 0; worker < workerCount; worker += 1) {
    workers.push((async () => {
      while (next < candidates.length) {
        const index = next;
        next += 1;
        const candidate = candidates[index];
        if (candidate === void 0 || signal.aborted) return;
        const page = await fetchPageText(candidate.url, options, signal);
        if (page !== void 0) texts[index] = page;
      }
    })());
  }
  await Promise.all(workers);
  if (signal.aborted) throw new CoreError("web search aborted", "WEB_ABORTED");
  const documents = candidates.map(
    (source, index) => [source.title ?? "", source.snippet ?? "", texts[index] ?? ""].filter((part) => part.length > 0).join("\n")
  );
  let ranked;
  const embedding = options.embedding;
  if (embedding !== void 0 && embedding.endpoint.length > 0) {
    try {
      const order = await embeddingRerank(query, documents, embedding, signal);
      ranked = order.map((index, rank) => ({ source: candidates[index], index, score: 1 / (rank + 1) }));
    } catch {
      const scores = bm25Rank(query, documents);
      ranked = candidates.map((source, index) => ({ source, index, score: scores[index] ?? 0 })).sort((a, b) => b.score - a.score || a.index - b.index);
    }
  } else {
    const scores = bm25Rank(query, documents);
    ranked = candidates.map((source, index) => ({ source, index, score: scores[index] ?? 0 })).sort((a, b) => b.score - a.score || a.index - b.index);
  }
  const kept = ranked.slice(0, Math.min(keep, candidates.length));
  return kept.map(({ source, index }) => {
    const text = texts[index];
    if (text === void 0 || text.length === 0) return { ...source };
    const snippet = snippetWindow(query, text, options.snippetChars);
    return snippet.length > 0 ? { ...source, snippet } : { ...source };
  });
}
async function fetchPageText(url, options, signal) {
  var _stack = [];
  try {
    const key = normalizeUrl(url);
    const cached = await options.store.readPage(key).catch(() => void 0);
    if (cached !== void 0 && Date.now() - cached.fetchedAt < options.pageCacheTtlMs) {
      return cached.bodyKind === "html" ? extractReadableText(cached.body) : cached.body;
    }
    const d = __using(_stack, deadline(signal, options.pageTimeoutMs, "WEB_PAGE_TIMEOUT"));
    let response;
    try {
      response = await fetchPublic(url, {
        allowPrivate: options.allowPrivateNetworks,
        headers: {
          "user-agent": options.userAgent,
          "accept": "text/html,application/xhtml+xml,text/*;q=0.9"
        },
        signal: d.signal
      });
    } catch (error) {
      if (error instanceof SsrfBlockedError) return void 0;
      if (signal.aborted) throw new CoreError("web search aborted", "WEB_ABORTED", { cause: error });
      return void 0;
    }
    if (!response.ok) {
      await response.body?.cancel();
      return void 0;
    }
    const mime = (response.headers.get("content-type") ?? "").replace(/;.*$/s, "").trim().toLowerCase();
    if (mime !== "" && !mime.startsWith("text/") && mime !== "application/xhtml+xml" && !mime.endsWith("+xml") && !mime.endsWith("+json")) {
      await response.body?.cancel();
      return void 0;
    }
    let body;
    try {
      body = await readCappedText(response, options.maxPageBytes);
    } catch (error) {
      if (signal.aborted) throw new CoreError("web search aborted", "WEB_ABORTED", { cause: error });
      return void 0;
    }
    const truncated = body.length > options.maxBodyChars;
    const capped = truncated ? body.slice(0, options.maxBodyChars) : body;
    const bodyKind = mime.startsWith("text/html") || mime === "application/xhtml+xml" ? "html" : "text";
    const text = bodyKind === "html" ? extractReadableText(capped) : capped;
    if (text.length === 0) return void 0;
    await options.store.recordPage({
      url,
      normalizedUrl: key,
      fetchedAt: Date.now(),
      statusCode: response.status,
      bodyKind,
      body: capped,
      truncated
    }).catch(() => void 0);
    return text;
  } catch (_) {
    var _error = _, _hasError = true;
  } finally {
    __callDispose(_stack, _error, _hasError);
  }
}

// src/search/cooldown.ts
var EngineCooldown = class {
  constructor(options) {
    this.options = options;
  }
  options;
  states = /* @__PURE__ */ new Map();
  /** True while the engine is cooling down. */
  isCoolingDown(engineId) {
    const state = this.states.get(engineId);
    if (state === void 0) return false;
    return (this.options.now ?? Date.now)() < state.until;
  }
  /** Record a failure and extend the cooldown (exponential backoff). */
  recordFailure(engineId) {
    const now = (this.options.now ?? Date.now)();
    const previous = this.states.get(engineId);
    const consecutive = (previous?.consecutive ?? 0) + 1;
    const delay = Math.min(this.options.baseMs * 2 ** (consecutive - 1), this.options.maxMs);
    this.states.set(engineId, { until: now + delay, consecutive });
  }
  /** Record a success and clear the cooldown. */
  recordSuccess(engineId) {
    this.states.delete(engineId);
  }
  /** Cooldown state for diagnostics (engine id → remaining ms, 0 when idle). */
  remainingMs(engineId) {
    const state = this.states.get(engineId);
    if (state === void 0) return 0;
    const remaining = state.until - (this.options.now ?? Date.now)();
    return remaining > 0 ? remaining : 0;
  }
};

// src/search/rrf.ts
function reciprocalRankFuse(lists, k = 60) {
  const fused = /* @__PURE__ */ new Map();
  for (const list of lists) {
    list.forEach((source, index) => {
      const key = normalizeUrl(source.url);
      const contribution = 1 / (k + index + 1);
      const existing = fused.get(key);
      if (existing === void 0) {
        fused.set(key, { score: contribution, source: { ...source } });
        return;
      }
      existing.score += contribution;
      mergeSourceFields(existing.source, source);
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score).map((entry) => entry.source);
}
function mergeSourceFields(target, other) {
  if (target.title === void 0 && other.title !== void 0) target.title = other.title;
  if (target.snippet === void 0 && other.snippet !== void 0) target.snippet = other.snippet;
  if (target.publishedAt === void 0 && other.publishedAt !== void 0) target.publishedAt = other.publishedAt;
}

// src/search/provider.ts
var MULTI_SEARCH_PROVIDER_ID = "multi";
var MultiSearchProvider = class {
  constructor(options) {
    this.options = options;
    this.cooldown = new EngineCooldown({ baseMs: options.cooldownBaseMs, maxMs: options.cooldownMaxMs });
  }
  options;
  id = MULTI_SEARCH_PROVIDER_ID;
  cooldown;
  /** At least one built engine must be available. */
  available() {
    return [...this.options.engineById.values()].some((engine) => engine.available());
  }
  /** Run one search: cache check, routing, enrichment, history. */
  async search(request, signal) {
    var _stack = [];
    try {
      const query = request.query.trim();
      if (query.length === 0) return { sources: [], truncated: false };
      const maxResults = request.maxResults ?? this.options.defaultMaxResults;
      const startedAt = Date.now();
      const cacheKey = searchCacheKey(query, this.options.engines, this.options.mode);
      const cached = await this.options.store.readSearch(cacheKey).catch(() => void 0);
      if (cached !== void 0 && Date.now() - cached.createdAt < this.options.searchCacheTtlMs) {
        this.options.logger?.info("web-search: cache hit", { query, sources: cached.sources.length, latencyMs: Date.now() - startedAt });
        return cloneSearchResult({
          sources: cached.sources,
          ...cached.content !== void 0 ? { content: cached.content } : {},
          truncated: cached.truncated
        });
      }
      const d = __using(_stack, deadline(signal, this.options.timeoutMs, "WEB_SEARCH_TIMEOUT"));
      const engineIds = this.selectEngines();
      if (engineIds.length === 0) {
        throw new CoreError(
          "no search engine is available (missing credentials or all engines cooling down)",
          "WEB_PROVIDER_ERROR"
        );
      }
      const candidateLimit = Math.max(maxResults, this.options.enrichFetchLimit);
      const routed = this.options.mode === "fuse" && engineIds.length > 1 ? await this.fuse(engineIds, query, candidateLimit, d.signal) : await this.fallback(engineIds, query, candidateLimit, d.signal);
      let sources = filterAndDedupe(routed.sources);
      const content = routed.content;
      if (this.options.enrich && sources.length > 1) {
        const keep = Math.min(this.options.enrichKeep, maxResults, sources.length);
        sources = await enrichSources(query, sources.slice(0, this.options.enrichFetchLimit), keep, {
          store: this.options.store,
          ...this.options.enrichOptions
        }, d.signal);
      }
      const truncated = sources.length >= maxResults;
      const result = {
        sources,
        ...content !== void 0 ? { content } : {},
        truncated
      };
      await this.options.store.recordSearch({
        cacheKey,
        query,
        engines: engineIds,
        createdAt: Date.now(),
        sources,
        truncated,
        ...content !== void 0 ? { content } : {}
      }).catch(() => void 0);
      this.options.logger?.info("web-search: completed", { query, engines: engineIds, sources: sources.length, latencyMs: Date.now() - startedAt });
      return cloneSearchResult(result);
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /** Resolve the engine list: forced engine, or ordered list minus unavailable/cooldown. */
  selectEngines() {
    if (this.options.forcedEngine !== void 0) {
      const engine = this.options.engineById.get(this.options.forcedEngine);
      if (engine === void 0 || !engine.available()) {
        throw new CoreError(
          `forced search engine "${this.options.forcedEngine}" is not available`,
          "WEB_PROVIDER_ERROR"
        );
      }
      return [this.options.forcedEngine];
    }
    return this.options.engines.filter((id) => {
      const engine = this.options.engineById.get(id);
      return engine !== void 0 && engine.available() && !this.cooldown.isCoolingDown(id);
    });
  }
  /** Sequential fallback: the first engine returning results wins. */
  async fallback(ids, query, maxResults, signal) {
    const errors = [];
    for (const id of ids) {
      const engine = this.options.engineById.get(id);
      if (engine === void 0) continue;
      try {
        const result = await engine.search(query, maxResults, signal);
        this.cooldown.recordSuccess(id);
        if (result.sources.length > 0) return result;
        errors.push(`${id}: no results`);
      } catch (error) {
        if (signal.aborted) throw toWebError(error, "web search aborted");
        this.cooldown.recordFailure(id);
        errors.push(`${id}: ${errorMessage2(error)}`);
      }
    }
    throw new CoreError(`all search engines failed: ${errors.join("; ")}`, "WEB_PROVIDER_ERROR");
  }
  /** Parallel fuse: all engines run; successes merge via RRF. */
  async fuse(ids, query, maxResults, signal) {
    const settled = await Promise.allSettled(
      ids.map((id) => {
        const engine = this.options.engineById.get(id);
        if (engine === void 0) return Promise.resolve({ sources: [] });
        return engine.search(query, maxResults, signal);
      })
    );
    const errors = [];
    const lists = [];
    settled.forEach((outcome, index) => {
      const id = ids[index];
      if (id === void 0) return;
      if (outcome.status === "fulfilled") {
        this.cooldown.recordSuccess(id);
        if (outcome.value.sources.length > 0) lists.push([...outcome.value.sources]);
        else errors.push(`${id}: no results`);
      } else {
        if (signal.aborted) throw toWebError(outcome.reason, "web search aborted");
        this.cooldown.recordFailure(id);
        errors.push(`${id}: ${errorMessage2(outcome.reason)}`);
      }
    });
    if (lists.length === 0) {
      throw new CoreError(`all search engines failed: ${errors.join("; ")}`, "WEB_PROVIDER_ERROR");
    }
    return { sources: reciprocalRankFuse(lists) };
  }
};
function searchCacheKey(query, engines, mode) {
  const normalized = query.toLowerCase().replace(/\s+/g, " ");
  return `multi:${mode}:${[...engines].join(",")}:${normalized}`;
}
function filterAndDedupe(sources) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const source of sources) {
    const key = normalizeUrl(source.url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...source });
  }
  return result;
}
function toWebError(error, message) {
  if (error instanceof CoreError) return error;
  return new CoreError(message, "WEB_ABORTED", { cause: error });
}
function errorMessage2(error) {
  if (error instanceof CoreError) return error.message;
  return String(error);
}
function cloneSearchResult(result) {
  return {
    sources: result.sources.map((source) => ({ ...source })),
    ...result.content !== void 0 ? { content: result.content } : {},
    truncated: result.truncated
  };
}

// src/fetch/index.ts
import path2 from "node:path";

// src/fetch/pdf.ts
var unpdfImport;
function loadUnpdf() {
  unpdfImport ??= import("unpdf");
  return unpdfImport;
}
async function extractPdfToMarkdown(bytes, url, limits) {
  if (bytes.byteLength === 0) {
    throw new CoreError("empty PDF body", "WEB_PARSE_ERROR");
  }
  if (bytes.byteLength > limits.maxSizeBytes) {
    throw new CoreError(`PDF exceeds the maximum size of ${limits.maxSizeBytes} bytes`, "WEB_FETCH_TOO_LARGE");
  }
  let extractText;
  try {
    extractText = (await loadUnpdf()).extractText;
  } catch (error) {
    throw new CoreError(
      `PDF extraction is unavailable (the "unpdf" engine could not be loaded): ${errorMessage3(error)}`,
      "WEB_NOT_AVAILABLE",
      { cause: error }
    );
  }
  let parsed;
  try {
    parsed = await extractText(bytes, { mergePages: false });
  } catch (error) {
    throw new CoreError(`cannot parse PDF: ${errorMessage3(error)}`, "WEB_PARSE_ERROR", { cause: error });
  }
  const pages = parsed.text.slice(0, limits.maxPages);
  const nonEmpty = pages.filter((page) => page.trim().length > 0);
  if (nonEmpty.length === 0) {
    throw new CoreError("PDF contains no extractable text (scanned images, or the first pages are empty)", "WEB_PARSE_ERROR");
  }
  const truncatedPages = parsed.totalPages > limits.maxPages;
  const body = pages.map((page, index) => `## Page ${index + 1}

${page.trim()}`).join("\n\n");
  const markdown = `# ${titleFromUrl(url)}

_Source: ${url} (PDF, ${parsed.totalPages} page${parsed.totalPages === 1 ? "" : "s"}${truncatedPages ? `; showing the first ${limits.maxPages}` : ""})_

${body}`;
  return { markdown, pages: pages.length, totalPages: parsed.totalPages };
}
function titleFromUrl(url) {
  try {
    const { pathname } = new URL(url);
    const base = pathname.split("/").filter(Boolean).pop() ?? "document";
    return base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  } catch {
    return "document";
  }
}
function errorMessage3(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

// src/fetch/policy.ts
function validateFetchUrl(input, maxUrlLength) {
  if (input.length > maxUrlLength) {
    throw new CoreError(`URL exceeds the maximum length of ${maxUrlLength}`, "WEB_INVALID_URL");
  }
  let url;
  try {
    url = new URL(input);
  } catch (error) {
    throw new CoreError(`invalid URL: ${input}`, "WEB_INVALID_URL", { cause: error });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CoreError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, "WEB_INVALID_URL");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new CoreError("credentials in URLs are not allowed", "WEB_BLOCKED_URL");
  }
  return url;
}
function isSameOrigin(a, b) {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
}
function classifyContentType(contentType) {
  const mime = (contentType ?? "").replace(/;.*$/s, "").trim().toLowerCase();
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime.startsWith("text/")) return "text";
  if (mime === "application/json" || mime === "application/xml" || mime.endsWith("+json") || mime.endsWith("+xml")) return "text";
  return void 0;
}
function parseCharset(contentType) {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? "");
  return match?.[1]?.trim().toLowerCase();
}
function decoderForCharset(charset) {
  if (charset === void 0) return new TextDecoder("utf-8");
  try {
    return new TextDecoder(charset);
  } catch (error) {
    throw new CoreError(`unsupported charset "${charset}"`, "WEB_UNSUPPORTED_CONTENT_TYPE", { cause: error });
  }
}

// src/fetch/video.ts
var VIDEO_HOSTS = /* @__PURE__ */ new Set(["www.youtube.com", "m.youtube.com", "youtube.com"]);
var ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
function parseVideoUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return void 0;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return void 0;
  let id = null;
  if (VIDEO_HOSTS.has(url.hostname)) {
    const queryId = url.searchParams.get("v");
    if (url.pathname === "/watch" && queryId !== null) {
      id = queryId;
    } else {
      const match = /^\/(embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
      if (match?.[2] !== void 0) id = match[2];
    }
  } else if (url.hostname === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  }
  if (id === null || !ID_PATTERN.test(id)) return void 0;
  return { videoId: id, watchUrl: `https://www.youtube.com/watch?v=${id}` };
}
function buildVideoDocument(stages, watchUrl) {
  if (stages.oembed === void 0 && stages.description === void 0 && stages.transcript === void 0) {
    return void 0;
  }
  const lines = [];
  lines.push(`# ${stages.oembed?.title ?? "YouTube video"} (video)`);
  const meta = [];
  if (stages.oembed?.authorName !== void 0) meta.push(`by ${stages.oembed.authorName}`);
  meta.push(watchUrl);
  if (stages.oembed?.thumbnailUrl !== void 0) meta.push(`thumbnail: ${stages.oembed.thumbnailUrl}`);
  lines.push(`_${meta.join(" \xB7 ")}_`);
  if (stages.description !== void 0 && stages.description.trim().length > 0) {
    lines.push("## Description", "", stages.description.trim());
  }
  if (stages.transcript !== void 0 && stages.transcript.trim().length > 0) {
    lines.push("## Transcript", "", stages.transcript.trim());
  }
  return lines.join("\n");
}
function vttToTranscript(vtt) {
  const normalized = vtt.replace(/\r\n?/g, "\n");
  const cues = normalized.split(/\n\n+/);
  const out = [];
  for (const cue of cues) {
    const cueLines = cue.split("\n");
    const timeIndex = cueLines.findIndex((line) => CUE_TIME_PATTERN.test(line));
    if (timeIndex === -1) continue;
    const match = CUE_TIME_PATTERN.exec(cueLines[timeIndex]);
    const text = cueLines.slice(timeIndex + 1).map((line) => line.replace(HTML_TAG_PATTERN, "").trim()).filter((line) => line.length > 0).join(" ");
    if (text.length === 0) continue;
    out.push(`[${formatTimestamp(match[1], match[2], match[3])}] ${text}`);
  }
  return out.join("\n");
}
var CUE_TIME_PATTERN = /^(?:(\d{1,2}):)?(\d{2}):(\d{2})\.\d{3}/;
var HTML_TAG_PATTERN = /<[^>]+>/g;
function formatTimestamp(hours, minutes, seconds) {
  if (hours !== void 0 && hours !== "00" && minutes !== void 0 && seconds !== void 0) return `${hours}:${minutes}:${seconds}`;
  return `${minutes ?? "00"}:${seconds ?? "00"}`;
}
function unescapeHtmlEntities(value) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d{3,5});/g, (_, code) => String.fromCharCode(Number(code))).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function parseOEmbed(json) {
  if (typeof json.title !== "string" || json.title.trim().length === 0) return void 0;
  return {
    title: json.title.trim(),
    authorName: typeof json.author_name === "string" && json.author_name.trim().length > 0 ? json.author_name.trim() : "unknown author",
    ...typeof json.thumbnail_url === "string" && json.thumbnail_url.length > 0 ? { thumbnailUrl: json.thumbnail_url } : {}
  };
}
function extractMetaDescription(html) {
  const tags = html.match(META_TAG_PATTERN) ?? [];
  for (const tag of tags) {
    const name = META_NAME_PATTERN.exec(tag)?.[1];
    const content = META_CONTENT_PATTERN.exec(tag)?.[1];
    if (content === void 0) continue;
    if (name === "description") return unescapeHtmlEntities(content).trim() || void 0;
  }
  for (const tag of tags) {
    const name = META_NAME_PATTERN.exec(tag)?.[1];
    const content = META_CONTENT_PATTERN.exec(tag)?.[1];
    if (name === "og:description" && content !== void 0) {
      const value = unescapeHtmlEntities(content).trim();
      if (value.length > 0) return value;
    }
  }
  return void 0;
}
var META_TAG_PATTERN = /<meta\b[^>]*>/gi;
var META_NAME_PATTERN = /(?:name|property)\s*=\s*["']([^"']+)["']/i;
var META_CONTENT_PATTERN = /content\s*=\s*["']([^"']*)["']/i;

// src/fetch/github.ts
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var NAME_PATTERN = /^[A-Za-z0-9_.-]{1,39}$/;
var GITHUB_HOSTS = /* @__PURE__ */ new Set(["github.com", "www.github.com"]);
function parseGitHubUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return void 0;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return void 0;
  if (!GITHUB_HOSTS.has(url.hostname)) return void 0;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return void 0;
  const owner = segments[0];
  const repo = segments[1];
  if (!NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repo)) return void 0;
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const rest = segments.slice(2).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return void 0;
    }
  });
  if (rest.some((segment) => segment === void 0 || /(^|\/)\.\.(\/|$)/.test(segment))) return void 0;
  if (rest[0] === "tree" && rest.length >= 2) {
    return { owner, repo, kind: "tree", ref: rest[1], repoPath: rest.slice(2).join("/"), repoUrl };
  }
  if (rest[0] === "blob" && rest.length >= 3) {
    return { owner, repo, kind: "blob", ref: rest[1], repoPath: rest.slice(2).join("/"), repoUrl };
  }
  if ((rest[0] === "pull" || rest[0] === "issues") && rest.length === 2 && /^\d{1,9}$/.test(rest[1])) {
    return {
      owner,
      repo,
      kind: rest[0] === "pull" ? "pull" : "issue",
      number: Number(rest[1]),
      repoUrl
    };
  }
  if (rest.length === 0) return { owner, repo, kind: "repo", repoUrl };
  return void 0;
}
async function fetchGitHubDocument(target, limits, signal) {
  if (target.kind === "pull" || target.kind === "issue") {
    const json = await fetchApiJson(
      `https://api.github.com/repos/${target.owner}/${target.repo}/${target.kind === "pull" ? "pulls" : "issues"}/${target.number}`,
      limits,
      signal
    );
    return target.kind === "pull" ? buildPullMarkdown(target, json) : buildIssueMarkdown(target, json);
  }
  const cloneDir = await ensureClone(target, limits, signal);
  const root = cloneDir;
  switch (target.kind) {
    case "repo":
      return buildRepoOverview(target, root, limits);
    case "tree":
      return buildTreeMarkdown(target, root, limits);
    case "blob":
      return buildFileMarkdown(target, root, limits);
  }
}
async function ensureClone(target, limits, signal) {
  const refSlug = sanitizeRef(target.ref);
  const dir = path.join(limits.clonesDir, `${target.owner}__${target.repo}${refSlug !== void 0 ? `@${refSlug}` : ""}`);
  const { existsSync } = await import("node:fs");
  if (!existsSync(dir)) {
    const source = limits.sourceResolver?.(target) ?? `${target.repoUrl}.git`;
    const args = ["clone", "--depth", "1", "--no-tags", "--quiet"];
    if (target.ref !== void 0) args.push("--branch", target.ref);
    args.push(source, dir);
    try {
      await execFileAsync("git", args, { timeout: 12e4, signal, maxBuffer: 4 * 1024 * 1024 });
    } catch (error) {
      await rm(dir, { recursive: true, force: true }).catch(() => void 0);
      const code = errorCodeOf2(error);
      if (code === "ENOENT" || code === "EACCES") {
        throw new CoreError("git binary is not available on this host; GitHub repository fetch is unavailable", "WEB_NOT_AVAILABLE", { cause: error });
      }
      await rm(dir, { recursive: true, force: true }).catch(() => void 0);
      throw new CoreError(`git clone failed: ${errorMessage4(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
    }
  }
  const size = await directorySize(dir);
  if (size > limits.maxCloneBytes) {
    await rm(dir, { recursive: true, force: true }).catch(() => void 0);
    throw new CoreError(`GitHub clone exceeds the maximum size of ${limits.maxCloneBytes} bytes (${size} bytes)`, "WEB_FETCH_TOO_LARGE");
  }
  return dir;
}
async function fetchApiJson(url, limits, signal) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { "user-agent": limits.userAgent, accept: "application/vnd.github+json" },
      signal
    });
  } catch (error) {
    throw new CoreError(`GitHub API request failed: ${errorMessage4(error)}`, "WEB_NETWORK", { cause: error });
  }
  if (response.status === 404) {
    await response.body?.cancel();
    throw new CoreError("GitHub object not found (private or deleted?)", "WEB_NOT_AVAILABLE");
  }
  if (response.status === 403 || response.status === 429) {
    await response.body?.cancel();
    throw new CoreError("GitHub API rate limit reached (public limit: 60 requests/hour)", "WEB_QUOTA");
  }
  if (response.status < 200 || response.status >= 300) {
    await response.body?.cancel();
    throw new CoreError(`GitHub API returned HTTP ${response.status}`, "WEB_HTTP_ERROR");
  }
  return await response.json();
}
async function buildRepoOverview(target, root, limits) {
  const { readdir } = await import("node:fs/promises");
  const entries = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.name !== ".git");
  const names = entries.map((entry) => entry.name);
  const readmeName = ["README.md", "readme.md", "README.rst", "README", "README.txt"].find((name) => names.includes(name));
  let readme;
  if (readmeName !== void 0) {
    const { readFile } = await import("node:fs/promises");
    readme = (await readFile(path.join(root, readmeName), "utf-8")).slice(0, 2e4);
  }
  const lines = [
    `# ${target.owner}/${target.repo} (GitHub repository)`,
    `_${target.repoUrl}_`,
    "",
    "## Contents (top level)",
    "",
    ...names.map((name, i) => `- ${entries[i].isDirectory() ? `${name}/` : name}`)
  ];
  if (readme !== void 0 && readme.trim().length > 0) {
    lines.push("", "## README", "", readme.trim());
  }
  return lines.join("\n");
}
async function buildTreeMarkdown(target, root, limits) {
  const listingPath = resolveInRoot(root, target.repoPath ?? "");
  const { stat } = await import("node:fs/promises");
  if ((await stat(listingPath)).isFile()) return buildFileMarkdown(target, root, limits);
  const listing = await listTree(listingPath, limits.maxTreeEntries);
  const rel = target.repoPath === void 0 || target.repoPath.length === 0 ? "" : `/${target.repoPath}`;
  const lines = [
    `# ${target.owner}/${target.repo}${rel} (tree${target.ref !== void 0 ? ` @ ${target.ref}` : ""})`,
    `_${target.repoUrl}${rel !== "" ? rel : ""}_`,
    "",
    ...listing.map((entry) => `- ${entry.isDir ? `${entry.name}/` : entry.name}`)
  ];
  if (listing.length >= limits.maxTreeEntries) lines.push(`- \u2026(listing capped at ${limits.maxTreeEntries} entries)`);
  return lines.join("\n");
}
async function buildFileMarkdown(target, root, limits) {
  const filePath = resolveInRoot(root, target.repoPath ?? "");
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(filePath, "utf-8").catch((error) => {
    throw new CoreError(`file not found in the repository: ${target.repoPath}`, "WEB_NOT_AVAILABLE", { cause: error });
  });
  const size = Buffer.byteLength(content);
  if (size > limits.maxFileBytes) {
    throw new CoreError(`file exceeds the maximum of ${limits.maxFileBytes} bytes (${size} bytes)`, "WEB_FETCH_TOO_LARGE");
  }
  const rel = target.repoPath ?? "";
  return `# ${target.owner}/${target.repo}/${rel} (file, ${size} bytes)
\`\`\`
${content}
\`\`\``;
}
function buildPullMarkdown(target, json) {
  const title = str(json.title) ?? `#${target.number}`;
  const state = str(json.state) ?? "unknown";
  const user = userLabel(json.user);
  const body = str(json.body);
  const lines = [
    `# ${target.owner}/${target.repo} PR #${target.number}: ${title} (${state})`,
    `_${target.repoUrl}/pull/${target.number} \xB7 opened by ${user}${str(json.created_at) !== void 0 ? ` \xB7 ${str(json.created_at)}` : ""}_`
  ];
  if (body !== void 0 && body.trim().length > 0) {
    lines.push("", "## Description", "", body.trim());
  }
  return lines.join("\n");
}
function buildIssueMarkdown(target, json) {
  const title = str(json.title) ?? `#${target.number}`;
  const state = str(json.state) ?? "unknown";
  const user = userLabel(json.user);
  const body = str(json.body);
  const lines = [
    `# ${target.owner}/${target.repo} issue #${target.number}: ${title} (${state})`,
    `_${target.repoUrl}/issues/${target.number} \xB7 opened by ${user}${str(json.created_at) !== void 0 ? ` \xB7 ${str(json.created_at)}` : ""}_`
  ];
  if (body !== void 0 && body.trim().length > 0) {
    lines.push("", "## Body", "", body.trim());
  }
  return lines.join("\n");
}
async function listTree(dir, maxEntries) {
  const { readdir, stat } = await import("node:fs/promises");
  const out = [];
  const stack = [dir];
  while (stack.length > 0 && out.length < maxEntries) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const isDir = entry.isDirectory();
      const relative = path.relative(dir, path.join(current, entry.name));
      out.push({ name: relative, isDir });
      if (isDir && out.length < maxEntries) stack.push(path.join(current, entry.name));
    }
  }
  return out.slice(0, maxEntries);
}
function resolveInRoot(root, repoPath) {
  if (repoPath.length === 0) return root;
  const resolved = path.resolve(root, repoPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new CoreError(`path "${repoPath}" escapes the repository root`, "WEB_BAD_REQUEST");
  }
  return resolved;
}
async function directorySize(dir) {
  const { readdir, stat } = await import("node:fs/promises");
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) total += (await stat(full)).size;
    }
  }
  return total;
}
function sanitizeRef(ref) {
  if (ref === void 0) return void 0;
  return ref.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);
}
function userLabel(value) {
  const user = value;
  if (user !== null && typeof user === "object" && typeof user.login === "string" && user.login.length > 0) {
    return user.type === "Bot" ? `${user.login}[bot]` : user.login;
  }
  return "unknown user";
}
function str(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function errorMessage4(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
function errorCodeOf2(error) {
  return error?.code;
}

// src/fetch/url.ts
var TRACKING_PARAM2 = /^(utm_|fbclid|gclid|mc_(eid|cid)|ref|source)/i;
function normalizeUrl2(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAM2.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

// src/fetch/provider.ts
var CACHED_FETCH_PROVIDER_ID = "cached-http";
var ACCEPT_HEADER = "text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8";
var CachedHttpFetchProvider = class {
  constructor(limits) {
    this.limits = limits;
  }
  limits;
  id = CACHED_FETCH_PROVIDER_ID;
  /** No credentials to check — an anonymous public fetcher is always usable. */
  available() {
    return isPositiveFinite(this.limits.maxUrlLength) && isPositiveFinite(this.limits.maxResponseBytes) && isPositiveFinite(this.limits.maxBodyChars) && isPositiveFinite(this.limits.timeoutMs) && Number.isInteger(this.limits.maxRedirects) && this.limits.maxRedirects >= 0 && isPositiveFinite(this.limits.cacheTtlMs);
  }
  /** Fetch one URL, serving from the cache when fresh. */
  async fetch(request, signal) {
    var _stack = [];
    try {
      if (signal?.aborted) throw new CoreError("web fetch aborted", "WEB_ABORTED");
      const url = validateFetchUrl(request.url, this.limits.maxUrlLength);
      await this.assertPublic(url);
      const key = normalizeUrl2(url.toString());
      const cached = await this.limits.store.readPage(key).catch(() => void 0);
      if (cached !== void 0) {
        if (Date.now() - cached.fetchedAt < this.limits.cacheTtlMs) {
          return cloneResult(cachedResult(cached));
        }
        if (this.limits.revalidate) return await this.revalidate(url, key, cached, signal);
      }
      const d = __using(_stack, deadline(signal, this.limits.timeoutMs, "WEB_FETCH_TIMEOUT"));
      return await this.fetchFresh(url, d.signal);
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /**
   * Assert a URL is public (not a private/reserved network target). Throws a
   * `WEB_SSRF_BLOCKED` error when the guard blocks the URL. The check runs on
   * the literal host and after DNS resolution (against rebinding).
   * @param url - the URL to check.
   */
  async assertPublic(url) {
    const check = await checkSsrf(url.toString(), { allowPrivate: this.limits.allowPrivateNetworks });
    if (!check.allowed) {
      throw new CoreError(`request to ${url.host} blocked by the SSRF guard: ${check.reason}`, "WEB_SSRF_BLOCKED");
    }
  }
  /** Fetch from the network, cache a 2xx result, and return it. */
  async fetchFresh(url, signal) {
    if (this.limits.github.enabled) {
      const target = parseGitHubUrl(url.toString());
      if (target !== void 0) {
        const document2 = await fetchGitHubDocument(
          target,
          {
            enabled: this.limits.github.enabled,
            maxCloneBytes: this.limits.github.maxCloneBytes,
            maxTreeEntries: this.limits.github.maxTreeEntries,
            maxFileBytes: this.limits.github.maxFileBytes,
            clonesDir: this.limits.github.clonesDir,
            userAgent: this.limits.userAgent,
            sourceResolver: this.limits.github.sourceResolver
          },
          signal
        );
        const truncatedByChars = document2.length > this.limits.maxBodyChars;
        const content = truncatedByChars ? document2.slice(0, this.limits.maxBodyChars) : document2;
        const result2 = {
          url: url.toString(),
          statusCode: 200,
          body: { kind: "text", content },
          truncated: truncatedByChars
        };
        await this.limits.store.recordPage({
          url: result2.url,
          normalizedUrl: normalizeUrl2(url.toString()),
          fetchedAt: Date.now(),
          statusCode: 200,
          bodyKind: "text",
          body: result2.body.content,
          truncated: result2.truncated
        }).catch(() => void 0);
        return result2;
      }
    }
    const { result, etag, lastModified } = await this.followAndRead(url, signal);
    if (result.statusCode >= 200 && result.statusCode < 300) {
      await this.limits.store.recordPage({
        url: result.url,
        normalizedUrl: normalizeUrl2(url.toString()),
        fetchedAt: Date.now(),
        ...etag !== void 0 ? { etag } : {},
        ...lastModified !== void 0 ? { lastModified } : {},
        statusCode: result.statusCode,
        bodyKind: result.body.kind,
        body: result.body.content,
        truncated: result.truncated
      }).catch(() => void 0);
    }
    return result;
  }
  /**
   * Conditional revalidation of a TTL-expired cache entry. A 304 refreshes
   * the timestamp and serves the stale body; a 2xx reads the new body from
   * the conditional response itself (one request, no second full GET) and
   * re-caches it with the fresh ETag/Last-Modified; anything else (redirects,
   * errors) falls through to a full fetch. A transport failure serves the
   * stale body (stale-on-error) rather than failing the call; caller
   * cancellation and our own timeout still fail loudly.
   */
  async revalidate(url, key, cached, signal) {
    var _stack = [];
    try {
      const d = __using(_stack, deadline(signal, this.limits.timeoutMs, "WEB_FETCH_TIMEOUT"));
      let response;
      try {
        response = await fetch(url, {
          method: "GET",
          redirect: "manual",
          headers: {
            "user-agent": this.limits.userAgent,
            "accept": ACCEPT_HEADER,
            ...cached.etag !== void 0 ? { "if-none-match": cached.etag } : {},
            ...cached.lastModified !== void 0 ? { "if-modified-since": cached.lastModified } : {}
          },
          signal: d.signal
        });
      } catch (error) {
        const translated = translateAbortOrNetwork(error, d.signal);
        if (translated.code === "WEB_ABORTED" || translated.code === "WEB_FETCH_TIMEOUT") throw translated;
        return cloneResult(cachedResult(cached));
      }
      if (response.status === 304) {
        await response.body?.cancel();
        await this.limits.store.refreshPage(key, Date.now(), cached.etag, cached.lastModified).catch(() => void 0);
        return cloneResult(cachedResult(cached));
      }
      if (response.status >= 200 && response.status < 300) {
        const result = await this.readBody(response, url, d.signal);
        const etag = response.headers.get("etag") ?? void 0;
        const lastModified = response.headers.get("last-modified") ?? void 0;
        await this.limits.store.recordPage({
          url: result.url,
          normalizedUrl: key,
          fetchedAt: Date.now(),
          ...etag !== void 0 ? { etag } : {},
          ...lastModified !== void 0 ? { lastModified } : {},
          statusCode: result.statusCode,
          bodyKind: result.body.kind,
          body: result.body.content,
          truncated: result.truncated
        }).catch(() => void 0);
        return result;
      }
      await response.body?.cancel();
      return await this.fetchFresh(url, d.signal);
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  /* jscpd:ignore-start -- transport mirrors @deepseek-ai/dsh-web-fetch-http/provider; MUST evolve together */
  /** Follow same-origin redirects up to the hop cap, then read the final response. */
  async followAndRead(initialUrl, signal) {
    let currentUrl = initialUrl;
    let redirectsFollowed = 0;
    for (; ; ) {
      const response = await this.requestOnce(currentUrl, signal);
      if (isRedirectStatus(response.status)) {
        if (redirectsFollowed >= this.limits.maxRedirects) {
          await response.body?.cancel();
          throw new CoreError(`exceeded the maximum of ${this.limits.maxRedirects} redirects`, "WEB_REDIRECT_BLOCKED");
        }
        const location = response.headers.get("location");
        if (location === null) {
          await response.body?.cancel();
          throw new CoreError(`redirect response (HTTP ${response.status}) without a Location header`, "WEB_PROVIDER_ERROR");
        }
        const target = resolveRedirect(location, currentUrl);
        let validatedTarget;
        try {
          validatedTarget = validateFetchUrl(target.toString(), this.limits.maxUrlLength);
          if (!isSameOrigin(validatedTarget, currentUrl)) {
            throw new CoreError(
              `cross-origin redirect to ${validatedTarget.origin} is not followed automatically; retry against that URL directly`,
              "WEB_REDIRECT_BLOCKED"
            );
          }
        } catch (error) {
          await response.body?.cancel();
          throw error;
        }
        await response.body?.cancel();
        currentUrl = validatedTarget;
        redirectsFollowed++;
        continue;
      }
      const result = await this.readVideoOrBody(response, currentUrl, signal);
      const etag = response.headers.get("etag") ?? void 0;
      const lastModified = response.headers.get("last-modified") ?? void 0;
      return { result, ...etag !== void 0 ? { etag } : {}, ...lastModified !== void 0 ? { lastModified } : {} };
    }
  }
  /**
   * The video branch (5.2): a YouTube watch URL fetched as a regular page is
   * enriched into a markdown document (oEmbed + meta description + public
   * transcript). Each stage is fail-soft — only when ALL of them fail does
   * the call reject (`WEB_NOT_AVAILABLE`). Non-video URLs (or the feature
   * disabled) fall through to the regular body read.
   */
  async readVideoOrBody(response, finalUrl, signal) {
    const target = this.limits.video.enabled ? parseVideoUrl(finalUrl.toString()) : void 0;
    if (target === void 0) return this.readBody(response, finalUrl, signal);
    const { bytes } = await this.readCapped(response, signal);
    const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const description = extractMetaDescription(html);
    const oembed = await this.videoStage(async () => {
      const res = await this.videoSubFetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(target.watchUrl)}&format=json`, signal);
      const json = await res.json();
      return parseOEmbed(json);
    });
    const transcript = await this.videoStage(async () => {
      const base = `https://www.youtube.com/api/timedtext?v=${target.videoId}`;
      for (const url of [base, `${base}&kind=asr`]) {
        const res = await this.videoSubFetch(url, signal);
        const { bytes: vttBytes } = await this.readCapped(res, signal);
        const text = vttToTranscript(new TextDecoder("utf-8", { fatal: false }).decode(vttBytes));
        if (text.trim().length > 0) return text;
      }
      return void 0;
    });
    const document2 = buildVideoDocument({ oembed, description, transcript }, target.watchUrl);
    if (document2 === void 0) {
      throw new CoreError(
        "no YouTube video data could be extracted (no oEmbed, meta description, or transcript available)",
        "WEB_NOT_AVAILABLE"
      );
    }
    const truncatedByChars = document2.length > this.limits.maxBodyChars;
    const content = truncatedByChars ? document2.slice(0, this.limits.maxBodyChars) : document2;
    return {
      url: finalUrl.toString(),
      statusCode: response.status,
      body: { kind: "text", content },
      truncated: truncatedByChars
    };
  }
  /**
   * Run one fail-soft video stage: any error (transport, HTTP, parse) yields
   * `undefined` rather than failing the whole fetch.
   */
  async videoStage(stage) {
    try {
      return await stage();
    } catch {
      return void 0;
    }
  }
  /** A guarded sub-request for the video stages (SSRF-checked, UA header, non-2xx rejects). */
  async videoSubFetch(url, signal) {
    const check = await checkSsrf(url, { allowPrivate: this.limits.allowPrivateNetworks });
    if (!check.allowed) {
      throw new CoreError(`request to ${new URL(url).host} blocked by the SSRF guard: ${check.reason}`, "WEB_SSRF_BLOCKED");
    }
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": this.limits.userAgent, accept: "application/json, text/vtt, text/plain, */*" },
      signal
    });
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel();
      throw new CoreError(`video sub-request returned HTTP ${response.status}`, "WEB_HTTP_ERROR");
    }
    return response;
  }
  async requestOnce(url, signal) {
    try {
      return await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": this.limits.userAgent, "accept": ACCEPT_HEADER },
        signal
      });
    } catch (error) {
      throw translateAbortOrNetwork(error, signal);
    }
  }
  /** Read, byte-cap, classify, and decode the final response body. */
  async readBody(response, finalUrl, signal) {
    const contentType = response.headers.get("content-type");
    const mime = (contentType ?? "").replace(/;.*$/s, "").trim().toLowerCase();
    const kind = classifyContentType(contentType);
    if (mime === "application/pdf" && this.limits.pdf.enabled) {
      const { bytes: bytes2, truncatedByBytes: truncatedByBytes2 } = await this.readCapped(response, signal, this.limits.pdf.maxSizeBytes);
      const { markdown } = await extractPdfToMarkdown(bytes2, finalUrl.toString(), this.limits.pdf);
      const truncatedByChars2 = markdown.length > this.limits.maxBodyChars;
      const content2 = truncatedByChars2 ? markdown.slice(0, this.limits.maxBodyChars) : markdown;
      return {
        url: finalUrl.toString(),
        statusCode: response.status,
        body: { kind: "text", content: content2 },
        truncated: truncatedByBytes2 || truncatedByChars2
      };
    }
    if (kind === void 0) {
      await response.body?.cancel();
      throw new CoreError(`unsupported content type "${contentType ?? "unknown"}"`, "WEB_UNSUPPORTED_CONTENT_TYPE");
    }
    let decoder;
    try {
      decoder = decoderForCharset(parseCharset(contentType));
    } catch (error) {
      await response.body?.cancel();
      throw error;
    }
    const { bytes, truncatedByBytes } = await this.readCapped(response, signal);
    const decoded = decoder.decode(bytes);
    const truncatedByChars = decoded.length > this.limits.maxBodyChars;
    const content = truncatedByChars ? decoded.slice(0, this.limits.maxBodyChars) : decoded;
    const body = kind === "html" ? { kind: "html", content } : { kind: "text", content };
    return {
      url: finalUrl.toString(),
      statusCode: response.status,
      body,
      truncated: truncatedByBytes || truncatedByChars
    };
  }
  /**
   * Read the response stream up to `maxBytes`. A `Content-Length` over the
   * cap rejects immediately with `WEB_FETCH_TOO_LARGE`; a stream that grows
   * past the cap is cut short (`truncatedByBytes`) rather than rejected.
   */
  async readCapped(response, signal, maxBytes) {
    const cap = maxBytes ?? this.limits.maxResponseBytes;
    const declared = response.headers.get("content-length");
    if (declared !== null) {
      const length = Number(declared);
      if (Number.isFinite(length) && length > cap) {
        await response.body?.cancel();
        throw new CoreError(`response exceeds the maximum of ${cap} bytes`, "WEB_FETCH_TOO_LARGE");
      }
    }
    if (response.body === null) return { bytes: new Uint8Array(0), truncatedByBytes: false };
    const chunks = [];
    let total = 0;
    let truncatedByBytes = false;
    const reader = response.body.getReader();
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = cap - total;
        if (value.byteLength > remaining) {
          chunks.push(value.subarray(0, remaining));
          total += remaining;
          truncatedByBytes = true;
          break;
        }
        chunks.push(value);
        total += value.byteLength;
      }
    } catch (error) {
      throw translateAbortOrNetwork(error, signal);
    } finally {
      await reader.cancel().catch(() => {
      });
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, truncatedByBytes };
  }
  /* jscpd:ignore-end */
};
function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
function resolveRedirect(location, base) {
  try {
    return new URL(location, base);
  } catch (error) {
    throw new CoreError(`invalid redirect Location "${location}"`, "WEB_PROVIDER_ERROR", { cause: error });
  }
}
function translateAbortOrNetwork(error, signal) {
  const timeout = timeoutOf(signal, "WEB_FETCH_TIMEOUT");
  if (timeout !== void 0) return new CoreError("web fetch timed out", "WEB_FETCH_TIMEOUT", { cause: timeout });
  if (signal.aborted) return new CoreError("web fetch aborted", "WEB_ABORTED", { cause: error });
  return new CoreError(`web fetch failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
}
function isPositiveFinite(value) {
  return Number.isFinite(value) && value > 0;
}
function pageToResult(page) {
  return {
    url: page.url,
    statusCode: page.statusCode,
    body: page.bodyKind === "html" ? { kind: "html", content: page.body } : { kind: "text", content: page.body },
    truncated: page.truncated
  };
}
function cachedResult(page) {
  return { ...pageToResult(page), fromCache: true };
}
function cloneResult(result) {
  return { ...result, body: { ...result.body } };
}

// src/fetch/index.ts
function buildFetchLimits(config, store, userAgent) {
  return {
    maxUrlLength: 2048,
    maxResponseBytes: config.fetch.maxBodyBytes,
    maxBodyChars: config.fetch.maxOutputChars,
    timeoutMs: config.fetch.timeoutMs,
    maxRedirects: config.fetch.maxRedirects,
    userAgent,
    cacheTtlMs: config.fetch.cacheTtlMs,
    store,
    revalidate: config.fetch.revalidate,
    allowPrivateNetworks: config.fetch.allowPrivateNetworks,
    pdf: config.fetch.pdf,
    video: config.fetch.video,
    github: {
      enabled: config.fetch.github.enabled,
      maxCloneBytes: config.fetch.github.maxCloneBytes,
      maxTreeEntries: config.fetch.github.maxTreeEntries,
      maxFileBytes: config.fetch.maxBodyBytes,
      clonesDir: path2.join(path2.dirname(config.store.path), "github-clones")
    }
  };
}

// src/platforms/builtins.ts
var GITHUB = {
  id: "github",
  name: "GitHub",
  format: "json",
  searchUrl: "https://api.github.com/search/repositories?q={query}&per_page={limit}",
  headers: {
    Accept: "application/vnd.github+json",
    "User-Agent": PRODUCT_USER_AGENT
  },
  fields: {
    items: "items",
    url: "html_url",
    title: "full_name",
    snippet: "description",
    publishedAt: "updated_at"
  },
  notes: "Repository search via the GitHub REST API. Unauthenticated requests are rate-limited (10/min)."
};
var REDDIT = {
  id: "reddit",
  name: "Reddit",
  format: "json",
  searchUrl: "https://www.reddit.com/search.json?q={query}&limit={limit}&sort=relevance",
  headers: {
    "User-Agent": PRODUCT_USER_AGENT
  },
  fields: {
    items: "data.children",
    url: "data.url",
    title: "data.title",
    snippet: "data.selftext"
  },
  notes: "Reddit search via the public .json endpoint. Unauthenticated requests are rate-limited."
};
var YOUTUBE = {
  id: "youtube",
  name: "YouTube",
  format: "json-in-html",
  searchUrl: "https://www.youtube.com/results?search_query={query}&hl=en",
  headers: {
    "User-Agent": BROWSER_LIKE_USER_AGENT
  },
  jsonInHtml: {
    marker: "ytInitialData = ",
    fields: {
      items: "contents.twoColumnSearchResults.results",
      url: "videoRenderer.navigationEndpoint.watchEndpoint.videoId",
      urlPrefix: "https://www.youtube.com/watch?v=",
      title: "videoRenderer.title.runs.0.text",
      snippet: "videoRenderer.detailedMetadataSnippets.0.snippet.runs.0.text"
    }
  },
  notes: "Best-effort: parses the embedded ytInitialData blob; may return few results if YouTube changes its page."
};
var BILIBILI = {
  id: "bilibili",
  name: "Bilibili",
  format: "json",
  searchUrl: "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword={query}",
  headers: {
    "User-Agent": BROWSER_LIKE_USER_AGENT,
    Referer: "https://www.bilibili.com"
  },
  fields: {
    items: "data.result",
    url: "bvid",
    urlPrefix: "https://www.bilibili.com/video/",
    title: "title",
    snippet: "description"
  },
  notes: "Best-effort: the search API may require a buvid3 cookie (set headers.Cookie in config)."
};
var V2EX = {
  id: "v2ex",
  name: "V2EX",
  format: "html",
  searchUrl: "https://www.v2ex.com/?q={query}",
  headers: {
    "User-Agent": BROWSER_LIKE_USER_AGENT
  },
  selectors: {
    item: "div.cell.item",
    url: "a",
    title: "a"
  },
  notes: "Best-effort: parses the server-rendered search page; markup may change."
};
var RSS = {
  id: "rss",
  name: "RSS / Atom feed",
  format: "rss",
  notes: "Pass a feed URL as the query; the feed entries are returned (title, link, description, date)."
};
var BUILTIN_PLATFORMS = [GITHUB, REDDIT, YOUTUBE, BILIBILI, V2EX, RSS];

// src/platforms/registry.ts
import { statSync, readFileSync } from "node:fs";

// src/platforms/template.ts
function expandTemplate(template, values) {
  let out = template;
  out = out.replaceAll("{query}", encodeURIComponent(values.query));
  if (values.limit !== void 0) out = out.replaceAll("{limit}", String(values.limit));
  if (values.page !== void 0) out = out.replaceAll("{page}", String(values.page));
  return out;
}
function isPlausibleSearchUrl(template) {
  const probe = expandTemplate(template, { query: "probe" });
  return URL.canParse(probe) && /^https?:/i.test(probe);
}

// src/platforms/types.ts
var RULE_PACK_VERSION = 1;

// src/platforms/rulepacks.ts
var PLATFORM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
var FORMATS = /* @__PURE__ */ new Set(["html", "json", "rss", "json-in-html"]);
function requireString(value, field, context) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`rulepack: ${context}: ${field} must be a non-empty string`);
  }
  return value;
}
function optionalString(value, field, context) {
  if (value === void 0) return void 0;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`rulepack: ${context}: ${field} must be a string when present`);
  }
  return value;
}
function optionalPositiveInt(value, field, context) {
  if (value === void 0) return void 0;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`rulepack: ${context}: ${field} must be a positive integer when present`);
  }
  return value;
}
function validateHeaders(value, context) {
  if (value === void 0) return void 0;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`rulepack: ${context}: headers must be an object when present`);
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") throw new Error(`rulepack: ${context}: headers.${key} must be a string`);
    out[key] = entry;
  }
  return out;
}
function validateSelectors(value, context) {
  if (value === null || typeof value !== "object") {
    throw new Error(`rulepack: ${context}: selectors must be an object for html platforms`);
  }
  const item = requireString(value.item, "selectors.item", context);
  const url = optionalString(value.url, "selectors.url", context);
  const title = optionalString(value.title, "selectors.title", context);
  const snippet = optionalString(value.snippet, "selectors.snippet", context);
  return {
    item,
    ...url !== void 0 ? { url } : {},
    ...title !== void 0 ? { title } : {},
    ...snippet !== void 0 ? { snippet } : {}
  };
}
function validateFields(value, context) {
  if (value === null || typeof value !== "object") {
    throw new Error(`rulepack: ${context}: fields must be an object for json platforms`);
  }
  const items = requireString(value.items, "fields.items", context);
  const url = requireString(value.url, "fields.url", context);
  const urlPrefix = optionalString(value.urlPrefix, "fields.urlPrefix", context);
  const title = optionalString(value.title, "fields.title", context);
  const snippet = optionalString(value.snippet, "fields.snippet", context);
  const publishedAt = optionalString(value.publishedAt, "fields.publishedAt", context);
  return {
    items,
    url,
    ...urlPrefix !== void 0 ? { urlPrefix } : {},
    ...title !== void 0 ? { title } : {},
    ...snippet !== void 0 ? { snippet } : {},
    ...publishedAt !== void 0 ? { publishedAt } : {}
  };
}
function validateJsonInHtml(value, context) {
  if (value === null || typeof value !== "object") {
    throw new Error(`rulepack: ${context}: jsonInHtml must be an object for json-in-html platforms`);
  }
  const marker = requireString(value.marker, "jsonInHtml.marker", context);
  const fields = validateFields(value.fields, context);
  return { marker, fields };
}
function validatePlatform(raw, context) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`rulepack: ${context}: platform must be an object`);
  }
  const obj = raw;
  const id = requireString(obj.id, "id", context);
  if (!PLATFORM_ID_PATTERN.test(id)) throw new Error(`rulepack: ${context}: id "${id}" is not a valid platform id`);
  const name = requireString(obj.name, "name", context);
  const formatRaw = requireString(obj.format, "format", context);
  if (!FORMATS.has(formatRaw)) throw new Error(`rulepack: ${context}: format "${formatRaw}" is not one of html|json|rss|json-in-html`);
  const format = formatRaw;
  const platform = { id, name, format };
  const searchUrl = optionalString(obj.searchUrl, "searchUrl", context);
  if (searchUrl !== void 0) platform.searchUrl = searchUrl;
  const headers = validateHeaders(obj.headers, context);
  if (headers !== void 0) platform.headers = headers;
  const maxResults = optionalPositiveInt(obj.maxResults, "maxResults", context);
  if (maxResults !== void 0) platform.maxResults = maxResults;
  const notes = optionalString(obj.notes, "notes", context);
  if (notes !== void 0) platform.notes = notes;
  switch (format) {
    case "html": {
      if (searchUrl === void 0 || !isPlausibleSearchUrl(searchUrl)) {
        throw new Error(`rulepack: ${context}: html platforms need a plausible absolute searchUrl`);
      }
      platform.selectors = validateSelectors(obj.selectors, context);
      break;
    }
    case "json": {
      if (searchUrl === void 0 || !isPlausibleSearchUrl(searchUrl)) {
        throw new Error(`rulepack: ${context}: json platforms need a plausible absolute searchUrl`);
      }
      platform.fields = validateFields(obj.fields, context);
      break;
    }
    case "json-in-html": {
      if (searchUrl === void 0 || !isPlausibleSearchUrl(searchUrl)) {
        throw new Error(`rulepack: ${context}: json-in-html platforms need a plausible absolute searchUrl`);
      }
      platform.jsonInHtml = validateJsonInHtml(obj.jsonInHtml, context);
      break;
    }
    case "rss": {
      break;
    }
  }
  return platform;
}
function validateRulePack(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("rulepack: top level must be an object");
  }
  const obj = raw;
  if (obj.version !== RULE_PACK_VERSION) {
    throw new Error(`rulepack: unsupported version ${String(obj.version)} (expected ${RULE_PACK_VERSION})`);
  }
  const name = requireString(obj.name, "name", "pack");
  const description = optionalString(obj.description, "description", "pack");
  if (!Array.isArray(obj.platforms)) throw new Error("rulepack: platforms must be an array");
  const platforms = obj.platforms.map((entry, index) => validatePlatform(entry, `platforms[${index}]`));
  const seen = /* @__PURE__ */ new Set();
  for (const platform of platforms) {
    if (seen.has(platform.id)) throw new Error(`rulepack: duplicate platform id "${platform.id}"`);
    seen.add(platform.id);
  }
  return { version: RULE_PACK_VERSION, name, ...description !== void 0 ? { description } : {}, platforms };
}
function importRulePack(input) {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  return validateRulePack(parsed);
}
function exportRulePack(pack) {
  return `${JSON.stringify(pack, null, 2)}
`;
}

// src/platforms/registry.ts
function mergePlatforms(groups) {
  const byId = /* @__PURE__ */ new Map();
  const order = [];
  for (const group of groups) {
    for (const platform of group) {
      if (!byId.has(platform.id)) order.push(platform.id);
      byId.set(platform.id, platform);
    }
  }
  return order.map((id) => byId.get(id));
}
var PlatformRegistry = class {
  builtins;
  configured;
  rulePackPaths;
  rulePackCache = /* @__PURE__ */ new Map();
  constructor(options) {
    this.builtins = options.builtins;
    this.configured = options.configured;
    this.rulePackPaths = options.rulePackPaths;
  }
  /**
   * Re-read rule-pack files whose mtime changed (hot reload). Safe to call on
   * every search; unchanged files are not re-read.
   */
  refresh() {
    for (const path3 of this.rulePackPaths) {
      let mtimeMs;
      try {
        mtimeMs = statSync(path3).mtimeMs;
      } catch {
        this.rulePackCache.set(path3, { mtimeMs: -1, platforms: [] });
        continue;
      }
      const cached = this.rulePackCache.get(path3);
      if (cached !== void 0 && cached.mtimeMs === mtimeMs) continue;
      try {
        const text = readFileSync(path3, "utf8");
        const pack = importRulePack(text);
        this.rulePackCache.set(path3, { mtimeMs, platforms: pack.platforms });
      } catch (error) {
        const previous = this.rulePackCache.get(path3);
        this.rulePackCache.set(path3, {
          mtimeMs,
          platforms: previous?.platforms ?? [],
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  /** The merged platform list (built-ins < configured < rule packs). */
  list() {
    this.refresh();
    const rulePackGroups = this.rulePackPaths.map((path3) => this.rulePackCache.get(path3)?.platforms ?? []);
    return mergePlatforms([this.builtins, this.configured, ...rulePackGroups]);
  }
  /** Look up one platform by id. */
  get(id) {
    return this.list().find((platform) => platform.id === id);
  }
  /** Whether a platform id is registered. */
  has(id) {
    return this.get(id) !== void 0;
  }
  /** All registered platform ids, in merge order. */
  ids() {
    return this.list().map((platform) => platform.id);
  }
  /** The most recent rule-pack load errors (path → message), if any. */
  rulePackErrors() {
    const errors = {};
    for (const [path3, entry] of this.rulePackCache) {
      if (entry.error !== void 0) errors[path3] = entry.error;
    }
    return errors;
  }
};

// src/platforms/parse-html.ts
import * as cheerio4 from "cheerio";
function cleanText(text) {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > 0 ? value : void 0;
}
function resolveHref(href, base) {
  if (href === void 0) return void 0;
  const trimmed = href.trim();
  if (trimmed.length === 0) return void 0;
  try {
    const resolved = new URL(trimmed, base).toString();
    return /^https?:/i.test(resolved) ? resolved : void 0;
  } catch {
    return void 0;
  }
}
function parseHtmlResults(html, selectors, baseUrl) {
  const $ = cheerio4.load(html);
  const sources = [];
  const seen = /* @__PURE__ */ new Set();
  $(selectors.item).each((_index, element) => {
    const $item = $(element);
    let href;
    if (selectors.url !== void 0) {
      href = $item.find(selectors.url).first().attr("href");
    } else {
      const selfHref = $item.attr("href");
      href = selfHref !== void 0 && selfHref.length > 0 ? selfHref : $item.find("a").first().attr("href");
    }
    const url = resolveHref(href, baseUrl);
    if (url === void 0 || seen.has(url)) return;
    seen.add(url);
    const source = { url };
    const title = selectors.title !== void 0 ? cleanText($item.find(selectors.title).first().text()) : cleanText($item.text());
    if (title !== void 0) source.title = title;
    const snippet = selectors.snippet !== void 0 ? cleanText($item.find(selectors.snippet).first().text()) : void 0;
    if (snippet !== void 0) source.snippet = snippet;
    sources.push(source);
  });
  return sources;
}

// src/platforms/parse-json.ts
function resolvePath(value, path3) {
  let current = value;
  for (const segment of path3.split(".")) {
    if (current === null || typeof current !== "object") return void 0;
    current = current[segment];
  }
  return current;
}
function asText(value) {
  if (typeof value !== "string") return void 0;
  const text = value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : void 0;
}
function parseJsonResults(text, fields) {
  const root = JSON.parse(text);
  return itemsToSources(root, fields);
}
function itemsToSources(root, fields) {
  const items = resolvePath(root, fields.items);
  if (!Array.isArray(items)) return [];
  const sources = [];
  for (const item of items) {
    const rawUrl = asText(resolvePath(item, fields.url));
    if (rawUrl === void 0) continue;
    const url = fields.urlPrefix !== void 0 ? `${fields.urlPrefix}${rawUrl}` : rawUrl;
    const source = { url };
    if (fields.title !== void 0) {
      const title = asText(resolvePath(item, fields.title));
      if (title !== void 0) source.title = title;
    }
    if (fields.snippet !== void 0) {
      const snippet = asText(resolvePath(item, fields.snippet));
      if (snippet !== void 0) source.snippet = snippet;
    }
    if (fields.publishedAt !== void 0) {
      const publishedAt = asText(resolvePath(item, fields.publishedAt));
      if (publishedAt !== void 0) source.publishedAt = publishedAt;
    }
    sources.push(source);
  }
  return sources;
}
function extractJsonAfterMarker(html, marker) {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error(`json-in-html marker not found: ${marker}`);
  const start = html.indexOf("{", markerIndex + marker.length);
  if (start < 0) throw new Error(`json-in-html: no object after marker ${marker}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error("json-in-html: unbalanced object after marker");
}

// src/platforms/parse-rss.ts
import * as cheerio5 from "cheerio";
function cleanText2(text) {
  if (text === void 0) return void 0;
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > 0 ? value : void 0;
}
function resolveLink(link, base) {
  const trimmed = link?.trim();
  if (trimmed === void 0 || trimmed.length === 0) return void 0;
  try {
    const resolved = new URL(trimmed, base).toString();
    return /^https?:/i.test(resolved) ? resolved : void 0;
  } catch {
    return void 0;
  }
}
function parseRssResults(xml, feedUrl) {
  const $ = cheerio5.load(xml, { xml: true });
  const sources = [];
  const seen = /* @__PURE__ */ new Set();
  const emit = (url, title, snippet, publishedAt) => {
    if (url === void 0 || seen.has(url)) return;
    seen.add(url);
    const source = { url };
    if (title !== void 0) source.title = title;
    if (snippet !== void 0) source.snippet = snippet;
    if (publishedAt !== void 0) source.publishedAt = publishedAt;
    sources.push(source);
  };
  if ($("item").length > 0) {
    $("item").each((_index, element) => {
      const $item = $(element);
      const url = resolveLink($item.find("link").first().text(), feedUrl);
      const title = cleanText2($item.find("title").first().text());
      const snippet = cleanText2($item.find("description").first().text()) ?? cleanText2($item.find("summary").first().text());
      const publishedAt = cleanText2($item.find("pubDate").first().text());
      emit(url, title, snippet, publishedAt);
    });
    return sources;
  }
  $("entry").each((_index, element) => {
    const $entry = $(element);
    const href = $entry.find("link").first().attr("href");
    const url = resolveLink(href, feedUrl);
    const title = cleanText2($entry.find("title").first().text());
    const snippet = cleanText2($entry.find("summary").first().text()) ?? cleanText2($entry.find("content").first().text());
    const publishedAt = cleanText2($entry.find("published").first().text()) ?? cleanText2($entry.find("updated").first().text());
    emit(url, title, snippet, publishedAt);
  });
  return sources;
}

// src/platforms/search.ts
function classifyPlatformError(error, signal, context) {
  const timeout = timeoutOf(signal, "WEB_SEARCH_TIMEOUT");
  if (timeout !== void 0) return new CoreError("platform search timed out", "WEB_SEARCH_TIMEOUT", { cause: timeout });
  if (signal.aborted) return new CoreError("platform search aborted", "WEB_ABORTED", { cause: error });
  return new CoreError(`${context}: ${error instanceof Error ? error.message : String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
}
async function readCappedText2(response, maxBytes) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) throw new Error(`body exceeds ${maxBytes} bytes`);
  }
  if (response.body === null) return "";
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      if (remaining <= 0) throw new Error(`body exceeds ${maxBytes} bytes`);
      const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(slice);
      total += slice.byteLength;
      if (value.byteLength > remaining) break;
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(concatBytes(chunks));
}
function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
async function fetchText(url, headers, signal, maxBytes, allowPrivateNetworks) {
  let response;
  try {
    response = await fetchPublic(url, {
      allowPrivate: allowPrivateNetworks,
      ...headers !== void 0 ? { headers } : {},
      signal
    });
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      throw new CoreError(`request to ${url} blocked by the SSRF guard: ${error.reason}`, "WEB_SSRF_BLOCKED", { cause: error });
    }
    throw classifyPlatformError(error, signal, `fetch ${url}`);
  }
  if (!response.ok) {
    throw new CoreError(`platform search got HTTP ${response.status} from ${url}`, "WEB_PROVIDER_ERROR");
  }
  try {
    return await readCappedText2(response, maxBytes);
  } catch (error) {
    throw classifyPlatformError(error, signal, `read ${url}`);
  }
}
function parseByFormat(platform, body, url) {
  switch (platform.format) {
    case "html":
      if (platform.selectors === void 0) throw new CoreError(`platform "${platform.id}" is missing html selectors`, "WEB_PROVIDER_ERROR");
      return parseHtmlResults(body, platform.selectors, url);
    case "json":
      if (platform.fields === void 0) throw new CoreError(`platform "${platform.id}" is missing json fields`, "WEB_PROVIDER_ERROR");
      return parseJsonResults(body, platform.fields);
    case "json-in-html":
      if (platform.jsonInHtml === void 0) throw new CoreError(`platform "${platform.id}" is missing jsonInHtml config`, "WEB_PROVIDER_ERROR");
      const jsonText = extractJsonAfterMarker(body, platform.jsonInHtml.marker);
      return parseJsonResults(jsonText, platform.jsonInHtml.fields);
    case "rss":
      return parseRssResults(body, url);
  }
}
async function searchPlatform(args, deps, signal) {
  var _stack = [];
  try {
    const platform = deps.registry.get(args.platform);
    if (platform === void 0) {
      const available = deps.registry.ids().join(", ");
      throw new CoreError(`unknown platform "${args.platform}"; available: ${available}`, "WEB_PROVIDER_ERROR");
    }
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? deps.maxResults), 1), deps.maxResults);
    let url;
    if (platform.format === "rss") {
      url = args.query.trim();
    } else {
      if (platform.searchUrl === void 0) throw new CoreError(`platform "${platform.id}" has no searchUrl`, "WEB_PROVIDER_ERROR");
      url = expandTemplate(platform.searchUrl, { query: args.query, limit });
    }
    if (!URL.canParse(url) || !/^https?:/i.test(url)) {
      throw new CoreError(`platform "${platform.id}" produced an invalid URL: ${url}`, "WEB_INVALID_URL");
    }
    const d = __using(_stack, deadline(signal, deps.timeoutMs, "WEB_SEARCH_TIMEOUT"));
    const body = await fetchText(url, platform.headers, d.signal, deps.maxBytes, deps.allowPrivateNetworks);
    const parsed = parseByFormat(platform, body, url);
    const cap = platform.maxResults !== void 0 ? Math.min(limit, platform.maxResults) : limit;
    const truncated = parsed.length > cap;
    return { platform: platform.id, query: args.query, sources: parsed.slice(0, cap), truncated };
  } catch (_) {
    var _error = _, _hasError = true;
  } finally {
    __callDispose(_stack, _error, _hasError);
  }
}

// src/store/index.ts
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// src/store/schema.ts
var WEB_STORE_SCHEMA_VERSION = 2;
var WEB_STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS web_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS web_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT NOT NULL UNIQUE,
  query TEXT NOT NULL,
  engines TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL DEFAULT 0,
  sources TEXT NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  content TEXT
);
CREATE TABLE IF NOT EXISTS web_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL UNIQUE,
  fetched_at INTEGER NOT NULL,
  last_accessed_at INTEGER NOT NULL DEFAULT 0,
  etag TEXT,
  last_modified TEXT,
  status_code INTEGER NOT NULL,
  body_kind TEXT NOT NULL,
  body TEXT NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_web_searches_created_at ON web_searches (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_searches_last_accessed_at ON web_searches (last_accessed_at ASC);
CREATE INDEX IF NOT EXISTS idx_web_pages_fetched_at ON web_pages (fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_pages_last_accessed_at ON web_pages (last_accessed_at ASC);
`;
var WEB_STORE_MIGRATIONS = [
  {
    // v1 -> v2: add the LRU column to both tables (existing rows default to 0,
    // which sorts them as "never accessed" and evicts them first).
    from: 1,
    up: `
ALTER TABLE web_searches ADD COLUMN last_accessed_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE web_pages ADD COLUMN last_accessed_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_web_searches_last_accessed_at ON web_searches (last_accessed_at ASC);
CREATE INDEX IF NOT EXISTS idx_web_pages_last_accessed_at ON web_pages (last_accessed_at ASC);
`
  }
];

// src/store/index.ts
var WebStore = class {
  constructor(options) {
    this.options = options;
  }
  options;
  db;
  opening;
  closed = false;
  /** Open the database (idempotent) and return the handle. */
  async ensureOpen() {
    if (this.closed) throw new Error("web-store: store is closed");
    if (this.db !== void 0) return this.db;
    if (this.opening === void 0) this.opening = this.open();
    const db = await this.opening;
    this.db = db;
    return db;
  }
  async open() {
    const { DatabaseSync } = await import("node:sqlite");
    if (this.options.path !== ":memory:") {
      await mkdir(dirname(resolve(this.options.path)), { recursive: true });
    }
    const db = new DatabaseSync(this.options.path);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE IF NOT EXISTS web_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    this.migrate(db);
    db.exec(WEB_STORE_SCHEMA);
    return db;
  }
  /**
   * Apply pending schema migrations. Reads the stored version; if it is older
   * than {@link WEB_STORE_SCHEMA_VERSION}, runs each migration in order and
   * records the new version. A missing version is resolved by probing the
   * actual shape: a missing `web_searches` table means a brand-new file (the
   * DDL will create the current shape, so only the version is stamped), while
   * an existing table without the LRU column means a pre-versioning file,
   * upgraded via the ALTER-based migrations. Must run BEFORE the full schema
   * DDL, whose index statements reference columns older files lack.
   * @param db - the open database handle (web_meta already created).
   */
  migrate(db) {
    const row = db.prepare("SELECT value FROM web_meta WHERE key = ?").get("schema_version");
    let current;
    if (row === void 0) {
      const columns = db.prepare("PRAGMA table_info(web_searches)").all();
      if (columns.length === 0) {
        current = WEB_STORE_SCHEMA_VERSION;
      } else {
        current = columns.some((column) => column.name === "last_accessed_at") ? WEB_STORE_SCHEMA_VERSION : 1;
      }
    } else {
      current = Number(row.value);
    }
    if (current >= WEB_STORE_SCHEMA_VERSION) {
      if (row === void 0) {
        db.prepare("INSERT OR REPLACE INTO web_meta (key, value) VALUES (?, ?)").run(
          "schema_version",
          String(WEB_STORE_SCHEMA_VERSION)
        );
      }
      return;
    }
    for (const migration of WEB_STORE_MIGRATIONS) {
      if (migration.from < current) continue;
      if (migration.from >= WEB_STORE_SCHEMA_VERSION) break;
      db.exec(migration.up);
    }
    db.prepare("INSERT OR REPLACE INTO web_meta (key, value) VALUES (?, ?)").run(
      "schema_version",
      String(WEB_STORE_SCHEMA_VERSION)
    );
  }
  /** Insert or replace one search record. Returns the row id. */
  async recordSearch(entry) {
    const db = await this.ensureOpen();
    const now = Date.now();
    const result = db.prepare(
      `INSERT INTO web_searches (cache_key, query, engines, created_at, last_accessed_at, sources, truncated, content)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           query = excluded.query,
           engines = excluded.engines,
           last_accessed_at = excluded.last_accessed_at,
           sources = excluded.sources,
           truncated = excluded.truncated,
           content = excluded.content`
    ).run(
      entry.cacheKey,
      entry.query,
      JSON.stringify(entry.engines),
      entry.createdAt,
      now,
      JSON.stringify(entry.sources),
      entry.truncated ? 1 : 0,
      entry.content ?? null
    );
    this.maybeEvict(db);
    return Number(result.lastInsertRowid);
  }
  /**
   * Read one search record by cache key (and mark it accessed for LRU).
   *
   * The LRU touch is a synchronous `UPDATE` on the read path — a deliberate
   * cost of LRU semantics (a cache hit must count as an access or hot entries
   * would be evicted). WAL mode keeps this cheap and non-blocking for other
   * connections; at this plugin's scale (a handful of reads per search) it is
   * not a concern.
   */
  async readSearch(cacheKey) {
    const db = await this.ensureOpen();
    const row = db.prepare("SELECT * FROM web_searches WHERE cache_key = ?").get(cacheKey);
    if (row === void 0) return void 0;
    db.prepare("UPDATE web_searches SET last_accessed_at = ? WHERE id = ?").run(Date.now(), row.id);
    return mapSearchRow(row);
  }
  /** Recent search history, newest first. */
  async recentSearches(limit) {
    const db = await this.ensureOpen();
    const rows = db.prepare("SELECT * FROM web_searches ORDER BY created_at DESC, id DESC LIMIT ?").all(limit);
    return rows.map(mapSearchRow);
  }
  /** Delete all search records. Returns the number of rows deleted. */
  async clearSearches() {
    const db = await this.ensureOpen();
    const result = db.prepare("DELETE FROM web_searches").run();
    return Number(result.changes);
  }
  /** Insert or update one page record by normalized URL. Returns the row id. */
  async recordPage(entry) {
    const db = await this.ensureOpen();
    const now = Date.now();
    const result = db.prepare(
      `INSERT INTO web_pages (url, normalized_url, fetched_at, last_accessed_at, etag, last_modified, status_code, body_kind, body, truncated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(normalized_url) DO UPDATE SET
           url = excluded.url,
           fetched_at = excluded.fetched_at,
           last_accessed_at = excluded.last_accessed_at,
           etag = excluded.etag,
           last_modified = excluded.last_modified,
           status_code = excluded.status_code,
           body_kind = excluded.body_kind,
           body = excluded.body,
           truncated = excluded.truncated`
    ).run(
      entry.url,
      entry.normalizedUrl,
      entry.fetchedAt,
      now,
      entry.etag ?? null,
      entry.lastModified ?? null,
      entry.statusCode,
      entry.bodyKind,
      entry.body,
      entry.truncated ? 1 : 0
    );
    this.maybeEvict(db);
    return Number(result.lastInsertRowid);
  }
  /** Read one page record by normalized URL (and mark it accessed for LRU). */
  async readPage(normalizedUrl) {
    const db = await this.ensureOpen();
    const row = db.prepare("SELECT * FROM web_pages WHERE normalized_url = ?").get(normalizedUrl);
    if (row === void 0) return void 0;
    db.prepare("UPDATE web_pages SET last_accessed_at = ? WHERE id = ?").run(Date.now(), row.id);
    return mapPageRow(row);
  }
  /** Recent page history, newest first. */
  async recentPages(limit) {
    const db = await this.ensureOpen();
    const rows = db.prepare("SELECT * FROM web_pages ORDER BY fetched_at DESC, id DESC LIMIT ?").all(limit);
    return rows.map(mapPageRow);
  }
  /** Refresh a page's freshness metadata after a 304 revalidation. */
  async refreshPage(normalizedUrl, fetchedAt, etag, lastModified) {
    const db = await this.ensureOpen();
    db.prepare(
      "UPDATE web_pages SET fetched_at = ?, etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified) WHERE normalized_url = ?"
    ).run(fetchedAt, etag ?? null, lastModified ?? null, normalizedUrl);
  }
  /** Delete all page records. Returns the number of rows deleted. */
  async clearPages() {
    const db = await this.ensureOpen();
    const result = db.prepare("DELETE FROM web_pages").run();
    return Number(result.changes);
  }
  /** Store statistics. */
  async stats() {
    const db = await this.ensureOpen();
    const searchesRow = db.prepare("SELECT COUNT(*) AS n, MAX(created_at) AS last FROM web_searches").get();
    const pagesRow = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(body)), 0) AS bytes, MAX(fetched_at) AS last FROM web_pages").get();
    return {
      searches: searchesRow.n,
      pages: pagesRow.n,
      pageBytes: pagesRow.bytes,
      ...searchesRow.last !== null ? { lastSearchAt: searchesRow.last } : {},
      ...pagesRow.last !== null ? { lastPageAt: pagesRow.last } : {}
    };
  }
  /**
   * Evict the least-recently-accessed entries beyond the given caps. Keeps at
   * most `maxSearches` search records and `maxPages` page records, deleting
   * the oldest (by `last_accessed_at`, then `id`) beyond each cap. A cap of 0
   * deletes everything; an undefined cap leaves that table untouched. Returns
   * the number of rows evicted per table.
   * @param limits - the per-table entry caps.
   */
  async evict(limits) {
    const db = await this.ensureOpen();
    let searches = 0;
    let pages = 0;
    if (limits.maxSearches !== void 0) {
      const result = db.prepare(
        `DELETE FROM web_searches WHERE id NOT IN (
             SELECT id FROM web_searches ORDER BY last_accessed_at DESC, id DESC LIMIT ?
           )`
      ).run(limits.maxSearches);
      searches = Number(result.changes);
    }
    if (limits.maxPages !== void 0) {
      const result = db.prepare(
        `DELETE FROM web_pages WHERE id NOT IN (
             SELECT id FROM web_pages ORDER BY last_accessed_at DESC, id DESC LIMIT ?
           )`
      ).run(limits.maxPages);
      pages = Number(result.changes);
    }
    return { searches, pages };
  }
  /**
   * Merge eviction caps into the store's current caps. A store shared by the
   * search and fetch modules starts cap-less; each module merges its own
   * resolved cap (search → `maxSearches`, fetch → `maxPages`) after resolving
   * its config, so the shared store accumulates both.
   * @param limits - the caps to merge in (undefined fields are preserved).
   */
  setEvictLimits(limits) {
    const current = this.options.evictLimits ?? {};
    this.options.evictLimits = { ...current, ...limits };
  }
  /**
   * Evict the least-recently-accessed entries beyond the configured caps (a
   * no-op when no caps are set or the store is within the cap). Called after
   * each write to keep the store bounded.
   */
  maybeEvict(db) {
    const limits = this.options.evictLimits;
    if (limits === void 0) return;
    if (limits.maxSearches === void 0 && limits.maxPages === void 0) return;
    void this.evict(limits).catch(() => void 0);
  }
  /** Close the database. Subsequent operations throw. */
  async close() {
    if (this.opening !== void 0) await this.opening.catch(() => void 0);
    this.db?.close();
    this.db = void 0;
    this.opening = void 0;
    this.closed = true;
  }
};
function mapSearchRow(row) {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    query: row.query,
    engines: JSON.parse(row.engines),
    createdAt: row.created_at,
    sources: JSON.parse(row.sources),
    truncated: row.truncated === 1,
    ...row.content !== null ? { content: row.content } : {}
  };
}
function mapPageRow(row) {
  return {
    id: row.id,
    url: row.url,
    normalizedUrl: row.normalized_url,
    fetchedAt: row.fetched_at,
    ...row.etag !== null ? { etag: row.etag } : {},
    ...row.last_modified !== null ? { lastModified: row.last_modified } : {},
    statusCode: row.status_code,
    bodyKind: row.body_kind === "text" ? "text" : "html",
    body: row.body,
    truncated: row.truncated === 1
  };
}

// src/markdown.ts
import * as cheerio6 from "cheerio";
function isTextNode(node) {
  return node.type === "text";
}
function isTagNode(node) {
  return node.type === "tag";
}
var MAIN_SELECTORS = [
  "article",
  "main",
  '[role="main"]',
  'div[class*="content"]',
  'div[class*="article"]',
  'div[class*="post"]',
  'div[class*="entry"]'
];
var STRIPPED_TAGS = /* @__PURE__ */ new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "object",
  "embed",
  "video",
  "audio",
  "source",
  "track",
  "map",
  "link",
  "meta",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  "nav",
  "aside",
  "footer",
  "header",
  "figure",
  "figcaption",
  "dialog",
  "menu",
  "datalist"
]);
function htmlToMarkdown(html) {
  const $ = cheerio6.load(html);
  $("head").remove();
  for (const tag of STRIPPED_TAGS) $(tag).remove();
  const $root = pickMainRoot($);
  const lines = [];
  walk($, $root, lines);
  return collapse(lines).trim();
}
function pickMainRoot($) {
  for (const selector of MAIN_SELECTORS) {
    const matches = $(selector);
    if (matches.length > 0) {
      let best = null;
      let bestText = 0;
      for (const el of matches) {
        const text = $.root().find(el).text().length;
        if (text > bestText) {
          bestText = text;
          best = $(el);
        }
      }
      if (best !== null && bestText >= 200) return best;
    }
  }
  return $("body").length > 0 ? $("body") : $("html");
}
function plainText(node) {
  if (isTextNode(node)) return node.data;
  if (!isTagNode(node)) return "";
  return node.children.map((child) => plainText(child)).join("");
}
function walk($, node, lines) {
  const state = { depth: 0 };
  for (const child of node.children()) {
    walkNode($, child, state, lines);
  }
}
function walkNode($, node, state, lines) {
  if (isTextNode(node)) {
    const text = node.data;
    if (text.length > 0) lines.push(text);
    return;
  }
  if (!isTagNode(node)) return;
  const tag = node.tagName.toLowerCase();
  if (STRIPPED_TAGS.has(tag)) return;
  const $self = $(node);
  const inline = isInlineTag(tag);
  const parts = [];
  if (inline) {
    if (tag === "a") {
      const href = $self.attr("href") ?? "";
      const text = plainText(node).trim();
      if (href.length > 0 && /^https?:/i.test(href) && text.length > 0) parts.push(`[${text}](${href})`);
      else if (text.length > 0) parts.push(text);
      return;
    }
    if (tag === "code") {
      const text = plainText(node).trim();
      if (text.length > 0) parts.push(`\`${text}\``);
      return;
    }
    if (tag === "img") {
      const src = $self.attr("src") ?? "";
      if (src.length > 0) parts.push(`![image](${src})`);
      return;
    }
    if (tag === "br") {
      parts.push("\n");
      return;
    }
    for (const child of node.children) walkInline($, child, parts);
    return;
  }
  switch (tag) {
    case "pre": {
      const code = $self.text();
      if (code.trim().length > 0) {
        lines.push("```");
        lines.push(code.trimEnd());
        lines.push("```");
      }
      return;
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = Number(tag[1]);
      const text = collectInlineText($, node).trim();
      if (text.length > 0) lines.push(`${"#".repeat(level)} ${text}`);
      return;
    }
    case "p":
    case "div":
    case "section":
    case "article":
    case "main": {
      const inner = collectInlineText($, node).trim();
      if (tag === "p" && inner.length > 0) {
        lines.push(inner);
        return;
      }
      for (const child of node.children) walkNode($, child, state, lines);
      return;
    }
    case "ul":
    case "ol": {
      let index = 1;
      const indent = "  ".repeat(state.depth);
      for (const child of node.children) {
        if (!isTagNode(child) || child.tagName.toLowerCase() !== "li") continue;
        const bullet = tag === "ol" ? `${index++}.` : "-";
        const directParts = [];
        for (const liChild of child.children) {
          if (isTagNode(liChild) && (liChild.tagName.toLowerCase() === "ul" || liChild.tagName.toLowerCase() === "ol")) continue;
          directParts.push(collectInlineText($, liChild));
        }
        const liText = directParts.join("").trim();
        if (liText.length > 0) {
          lines.push(`${indent}${bullet} ${liText}`);
        }
        for (const grand of child.children) {
          if (isTagNode(grand) && (grand.tagName.toLowerCase() === "ul" || grand.tagName.toLowerCase() === "ol")) {
            state.depth += 1;
            walkNode($, grand, state, lines);
            state.depth -= 1;
          }
        }
      }
      return;
    }
    case "blockquote": {
      const inner = collectInlineText($, node).trim();
      if (inner.length > 0) lines.push(inner.split("\n").map((line) => `> ${line}`).join("\n"));
      return;
    }
    case "hr": {
      lines.push("---");
      return;
    }
    case "table": {
      const rows = [];
      $self.find("tr").each((_i, tr) => {
        const cells = $(tr).find("th, td").map((_j, cell) => $(cell).text().trim()).get();
        const row = cells.filter((cell) => cell.length > 0).join("	");
        if (row.length > 0) rows.push(row);
      });
      if (rows.length > 0) lines.push(rows.join("\n"));
      return;
    }
    default:
      for (const child of node.children) walkNode($, child, state, lines);
      return;
  }
}
function isInlineTag(tag) {
  return ["a", "code", "strong", "b", "em", "i", "u", "s", "small", "span", "sub", "sup", "abbr", "cite", "q", "img", "br"].includes(tag);
}
function collectInlineText($, node) {
  const parts = [];
  walkInline($, node, parts);
  return parts.join("");
}
function walkInline($, node, parts) {
  if (isTextNode(node)) {
    const text = node.data;
    if (text.length > 0) parts.push(collapseWhitespace(text));
    return;
  }
  if (!isTagNode(node)) return;
  const tag = node.tagName.toLowerCase();
  if (STRIPPED_TAGS.has(tag)) return;
  const $self = $(node);
  if (tag === "a") {
    const href = $self.attr("href") ?? "";
    const text = plainText(node).trim();
    if (href.length > 0 && /^https?:/i.test(href) && text.length > 0) parts.push(`[${text}](${href})`);
    else if (text.length > 0) parts.push(text);
    return;
  }
  if (tag === "code") {
    const text = plainText(node).trim();
    if (text.length > 0) parts.push(`\`${text}\``);
    return;
  }
  if (tag === "img") {
    const src = $self.attr("src") ?? "";
    if (src.length > 0) parts.push(`![image](${src})`);
    return;
  }
  if (tag === "br") {
    parts.push(" ");
    return;
  }
  for (const child of node.children) walkInline($, child, parts);
}
function collapseWhitespace(text) {
  return text.replace(/\s+/g, " ");
}
function collapse(lines) {
  const out = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length === 0) return;
    const paragraph = buffer.join("\n");
    out.push(paragraph);
    buffer = [];
  };
  for (const line of lines) {
    const match = line.match(/^(\s*)([\s\S]*)$/);
    const indent = match?.[1] ?? "";
    const body = (match?.[2] ?? "").replace(/\s+/g, " ").trim();
    if (body.length === 0) {
      flush();
      continue;
    }
    const isBlock = body.startsWith("#") || body.startsWith("```") || body.startsWith("- ") || /^\d+\. /.test(body) || body.startsWith(">") || body.startsWith("---") || body.startsWith("![") || body.includes("	");
    if (isBlock) {
      flush();
      out.push(`${indent}${body}`);
    } else {
      buffer.push(`${indent}${body}`);
    }
  }
  flush();
  const result = [];
  for (const block of out) {
    if (result.length > 0) result.push("");
    result.push(block);
  }
  return result.join("\n");
}

// src/tools/index.ts
function guarded(body) {
  return async (args, ctx) => {
    try {
      return await body(args, ctx);
    } catch (error) {
      if (error instanceof CoreError) {
        return { text: `Error (${errorCodeOf(error)}): ${error.message}`, isError: true };
      }
      return {
        text: `Error (WEB_INTERNAL): ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      };
    }
  };
}
function assertArray(args, field, min, max) {
  if (!Array.isArray(args) || args.length < min || args.length > max || args.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new CoreError(`${field} must be an array of ${min}-${max} non-empty strings`, "WEB_BAD_REQUEST");
  }
  return args;
}
function assertPositiveInt2(args, field, max) {
  if (args === void 0) return void 0;
  if (typeof args !== "number" || !Number.isInteger(args) || args < 1 || args > max) {
    throw new CoreError(`${field} must be an integer between 1 and ${max}`, "WEB_BAD_REQUEST");
  }
  return args;
}
function asRecord(args) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new CoreError("tool arguments must be an object", "WEB_BAD_REQUEST");
  }
  return args;
}
function formatSearchResult(result, maxResults) {
  const lines = [];
  if (result.content !== void 0) {
    lines.push("Answer:");
    lines.push(result.content);
    lines.push("");
    lines.push("Sources:");
  }
  if (result.sources.length === 0) {
    lines.push("No results found.");
    return lines.join("\n");
  }
  result.sources.slice(0, maxResults).forEach((source, index) => {
    lines.push(`${index + 1}. ${source.title ?? source.url}`);
    lines.push(`   ${source.url}`);
    if (source.snippet !== void 0 && source.snippet.length > 0) lines.push(`   ${source.snippet.slice(0, 300)}`);
  });
  if (result.truncated) lines.push(`(truncated to ${maxResults} sources)`);
  return lines.join("\n");
}
function buildSearchTool(host) {
  const defaultMax = 5;
  return {
    name: "web_search",
    description: "Search the web for current information. Accepts 1-4 queries (merged, deduplicated). Returns ranked sources with titles, URLs, snippets, and optionally a generated answer. For platform-specific search (github, reddit, youtube, bilibili, v2ex, rss) use web_platform_search.",
    parameters: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          description: "Search queries (1-4). Multiple queries are searched and merged (deduplicated).",
          items: { type: "string" },
          minItems: 1,
          maxItems: 4
        },
        max_results: { type: "integer", description: "Maximum number of sources to return (1-20).", minimum: 1, maximum: 20, default: 5 },
        recency: { type: "string", enum: ["day", "week", "month", "year"], description: "Freshness hint (engines that support it honor it)." },
        domains: {
          type: "array",
          description: 'Domain filters. Plain = include only; "-domain.com" = exclude.',
          items: { type: "string" }
        },
        engine: { type: "string", description: 'Force a specific engine id (e.g. "ddg", "bing", "exa"). Default: auto (configured engine list).' }
      },
      required: ["queries"],
      additionalProperties: false
    },
    execute: guarded(async (args, { signal }) => {
      const record = asRecord(args);
      const queries = assertArray(record["queries"], "queries", 1, 4);
      const maxResults = assertPositiveInt2(record["max_results"], "max_results", 20) ?? defaultMax;
      const domains = Array.isArray(record["domains"]) && record["domains"].every((item) => typeof item === "string") ? record["domains"] : void 0;
      const recency = typeof record["recency"] === "string" ? record["recency"] : void 0;
      const engine = typeof record["engine"] === "string" && record["engine"] !== "auto" ? record["engine"] : void 0;
      const merged = [];
      const seen = /* @__PURE__ */ new Set();
      const contents = [];
      const enginesUsed = /* @__PURE__ */ new Set();
      let anyTruncated = false;
      let fromCache = false;
      for (const query of queries) {
        const result = await host.search(
          {
            query: String(query),
            maxResults,
            ...recency !== void 0 ? { recency } : {},
            ...domains !== void 0 ? { domains } : {},
            ...engine !== void 0 ? { engine } : {}
          },
          signal
        );
        if (result.fromCache) fromCache = true;
        if (result.truncated) anyTruncated = true;
        for (const id of result.enginesUsed ?? []) enginesUsed.add(id);
        if (result.content !== void 0 && result.content.length > 0) contents.push(result.content);
        for (const source of result.sources) {
          const key = normalizeUrl(source.url);
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(source);
        }
      }
      const text = formatSearchResult(
        {
          sources: merged.slice(0, maxResults),
          ...contents.length > 0 ? { content: contents.join("\n\n").slice(0, 4e3) } : {},
          truncated: anyTruncated || merged.length > maxResults
        },
        maxResults
      );
      return {
        text,
        details: {
          queries,
          engines: [...enginesUsed],
          fromCache,
          sources: merged.slice(0, maxResults)
        }
      };
    })
  };
}
function buildFetchTool(host) {
  return {
    name: "web_fetch",
    description: "Fetch a URL and return its readable content (HTML is converted to Markdown; PDFs are extracted locally). Use after web_search to read a specific page in full. With `question`, the host LLM answers the question from the fetched document (PDF/HTML).",
    maxOutputChars: host.config.fetch.maxOutputChars,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to fetch." },
        mode: {
          type: "string",
          enum: ["readable", "raw"],
          description: "'readable' (default): readable content as Markdown. 'raw': the decoded body as-is."
        },
        question: {
          type: "string",
          description: "Optional: a question about the fetched document (page or PDF). The host LLM answers it from the fetched content (requires the host LLM client; `question` is ignored in `raw` mode)."
        }
      },
      required: ["url"],
      additionalProperties: false
    },
    execute: guarded(async (args, { signal }) => {
      const record = asRecord(args);
      const url = typeof record["url"] === "string" ? record["url"] : "";
      if (url.length === 0) throw new CoreError("url is required", "WEB_BAD_REQUEST");
      const mode = record["mode"] === "raw" ? "raw" : "readable";
      const question = typeof record["question"] === "string" && record["question"].trim() !== "" ? record["question"].trim() : void 0;
      const result = await host.fetch({ url }, signal);
      const raw = result.body.content;
      let content;
      if (mode === "raw" || result.body.kind === "text") {
        content = raw;
      } else {
        content = htmlToMarkdown(raw);
      }
      const maxChars = host.config.fetch.maxOutputChars;
      const truncated = result.truncated || content.length > maxChars;
      if (content.length > maxChars) content = `${content.slice(0, maxChars)}
[...truncated...]`;
      const header = `Fetched ${result.url} (HTTP ${result.statusCode}, ${result.body.kind}${result.fromCache ? ", cache" : ""}, ${content.length} chars${truncated ? ", truncated" : ""})`;
      if (question !== void 0 && mode !== "raw") {
        return answerFromLlm(host, question, content, result, header, signal);
      }
      return {
        text: `${header}
${content}`,
        details: {
          url: result.url,
          statusCode: result.statusCode,
          kind: result.body.kind,
          fromCache: result.fromCache ?? false,
          truncated
        }
      };
    })
  };
}
var QUESTION_EXCERPT_CHARS = 6e4;
async function answerFromLlm(host, question, content, result, header, signal) {
  const llm = host.llm;
  if (llm === void 0) {
    throw new CoreError(
      "web_fetch question mode requires the host LLM client (HostAdapter.llm), which this host does not provide",
      "WEB_NOT_AVAILABLE"
    );
  }
  const excerpt = content.length > QUESTION_EXCERPT_CHARS ? content.slice(0, QUESTION_EXCERPT_CHARS) + "\n[...document excerpt ends...]" : content;
  const prompt = `You are answering a question strictly from the document provided below. If the document does not contain the answer, say so explicitly. Be concise; quote the document when it supports the answer.

Document (${result.url}):
---
${excerpt}
---

Question: ${question}`;
  const completion = await llm.complete({ prompt, maxTokens: 1024, signal });
  const answer = completion.text.trim();
  const truncated = answer.length > host.config.fetch.maxOutputChars;
  const text = truncated ? `${answer.slice(0, host.config.fetch.maxOutputChars)}
[...truncated...]` : answer;
  return {
    text: `${header}

Answer to "${question}"${completion.model !== void 0 ? ` (model: ${completion.model})` : ""}:
${text}`,
    details: {
      url: result.url,
      statusCode: result.statusCode,
      kind: result.body.kind,
      fromCache: result.fromCache ?? false,
      question,
      model: completion.model ?? null
    }
  };
}
function buildPlatformSearchTool(host) {
  return {
    name: "web_platform_search",
    description: "Search a specific platform (github, reddit, youtube, bilibili, v2ex, rss, plus configured platforms). For the rss platform the query is a feed URL.",
    parameters: {
      type: "object",
      properties: {
        platform: { type: "string", description: 'Platform id (e.g. "github", "reddit", "rss").' },
        query: { type: "string", description: "The search query; for rss, the feed URL." },
        max_results: { type: "integer", description: "Maximum number of results (1-20).", minimum: 1, maximum: 20 }
      },
      required: ["platform", "query"],
      additionalProperties: false
    },
    execute: guarded(async (args, { signal }) => {
      const record = asRecord(args);
      const platform = typeof record["platform"] === "string" ? record["platform"] : "";
      const query = typeof record["query"] === "string" ? record["query"] : "";
      if (platform.length === 0 || query.length === 0) throw new CoreError("platform and query are required", "WEB_BAD_REQUEST");
      const maxResults = assertPositiveInt2(record["max_results"], "max_results", 20);
      const result = await host.platformSearch({ platform, query, ...maxResults !== void 0 ? { maxResults } : {} }, signal);
      const lines = [`Platform search: ${result.platform} \u2014 ${result.query} (${result.sources.length} results)`];
      for (const [index, source] of result.sources.entries()) {
        lines.push(`${index + 1}. ${source.title ?? source.url}`);
        lines.push(`   ${source.url}`);
        if (source.snippet !== void 0 && source.snippet.length > 0) lines.push(`   ${source.snippet.slice(0, 300)}`);
      }
      if (result.truncated) lines.push("(truncated)");
      return { text: lines.join("\n"), details: { platform: result.platform, sources: result.sources } };
    })
  };
}
function buildHistoryTool(host) {
  return {
    name: "web_history",
    description: "Show recent web search/fetch history from the local store (no network).",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["search", "fetch", "all"], description: "History kind. Default: all." },
        query: { type: "string", description: "Optional substring filter." },
        limit: { type: "integer", description: "Maximum entries (1-100). Default 20.", minimum: 1, maximum: 100 }
      }
    },
    execute: guarded(async (args) => {
      const record = asRecord(args);
      const kind = record["kind"] === "search" || record["kind"] === "fetch" || record["kind"] === "all" ? record["kind"] : "all";
      const filter = typeof record["query"] === "string" ? record["query"].toLowerCase() : "";
      const limit = Math.min(Math.max(Math.trunc(record["limit"] ?? 20), 1), 100);
      const lines = [];
      if (kind === "search" || kind === "all") {
        const searches = await host.store.recentSearches(limit);
        for (const row of searches) {
          if (filter.length > 0 && !row.query.toLowerCase().includes(filter)) continue;
          const sources = row.sources;
          lines.push(`[${new Date(row.createdAt).toISOString()}] search: ${row.query} \u2192 ${sources.length} sources (engines: ${row.engines.join(",")})`);
        }
      }
      if (kind === "fetch" || kind === "all") {
        const pages = await host.store.recentPages(limit);
        for (const row of pages) {
          if (filter.length > 0 && !row.url.toLowerCase().includes(filter)) continue;
          lines.push(`[${new Date(row.fetchedAt).toISOString()}] fetch: ${row.url} \u2192 HTTP ${row.statusCode} (${row.bodyKind}, ${row.body.length} chars${row.truncated ? ", truncated" : ""})`);
        }
      }
      if (lines.length === 0) return { text: "No matching history entries." };
      return { text: lines.join("\n") };
    })
  };
}
function buildStatsTool(host) {
  return {
    name: "web_search_stats",
    description: "Show web store statistics (stored searches, pages, bytes). No network requests.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: guarded(async () => {
      const stats = await host.store.stats();
      const lines = [
        `Stored searches: ${stats.searches}${stats.lastSearchAt !== void 0 ? ` (last: ${new Date(stats.lastSearchAt).toISOString()})` : ""}`,
        `Stored pages: ${stats.pages}${stats.lastPageAt !== void 0 ? ` (last: ${new Date(stats.lastPageAt).toISOString()})` : ""}`,
        `Page bytes: ${stats.pageBytes}`,
        `Store: ${host.config.store.path}`
      ];
      return { text: lines.join("\n"), details: stats };
    })
  };
}
function buildCacheClearTool(host) {
  return {
    name: "web_cache_clear",
    description: "Clear the local web search/page cache. No network requests.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["search", "pages", "all"], description: "What to clear. Default: all." }
      }
    },
    execute: guarded(async (args) => {
      const record = asRecord(args);
      const scope = record["scope"] === "search" || record["scope"] === "pages" || record["scope"] === "all" ? record["scope"] : "all";
      const lines = [];
      if (scope === "search" || scope === "all") lines.push(`Cleared ${await host.store.clearSearches()} search records.`);
      if (scope === "pages" || scope === "all") lines.push(`Cleared ${await host.store.clearPages()} page records.`);
      return { text: lines.join(" ") };
    })
  };
}
function buildCoreTools(host) {
  const tools = [
    buildSearchTool(host),
    buildFetchTool(host),
    buildPlatformSearchTool(host),
    buildHistoryTool(host),
    buildStatsTool(host),
    buildCacheClearTool(host)
  ];
  return host.config.platforms.enabled === false ? tools.filter((tool) => tool.name !== "web_platform_search") : tools;
}

// src/browser/types.ts
var BROWSER_CODES = {
  UNAVAILABLE: "BROWSER_UNAVAILABLE",
  NOT_OPEN: "BROWSER_NOT_OPEN",
  ALREADY_OPEN: "BROWSER_ALREADY_OPEN",
  INVALID_URL: "BROWSER_INVALID_URL",
  ACTION_FAILED: "BROWSER_ACTION_FAILED",
  TIMEOUT: "BROWSER_TIMEOUT",
  ABORTED: "BROWSER_ABORTED",
  APPROVAL_DENIED: "BROWSER_APPROVAL_DENIED",
  APPROVAL_UNAVAILABLE: "BROWSER_APPROVAL_UNAVAILABLE",
  AUTH_MISSING: "BROWSER_AUTH_MISSING",
  SSRF_BLOCKED: "BROWSER_SSRF_BLOCKED"
};

// src/browser/playwright.ts
async function assertPublicNavigation(url, allowPrivate) {
  const check = await checkSsrf(url, { allowPrivate });
  if (!check.allowed) {
    throw new CoreError(
      `navigation to ${url} blocked by the SSRF guard: ${check.reason ?? "private/reserved target"}`,
      BROWSER_CODES.SSRF_BLOCKED
    );
  }
}
var DEFAULT_TIMEOUT_MS = 3e4;
var DEFAULT_MAX_TEXT_LENGTH = 2e4;
var DEFAULT_MAX_ELEMENTS = 200;
var playwrightModule;
var playwrightLoad;
var playwrightLoadFailed = false;
function loadPlaywright() {
  playwrightLoad ??= import("playwright").then(
    (mod) => {
      playwrightModule = mod;
      return mod;
    },
    (error) => {
      playwrightLoadFailed = true;
      throw error;
    }
  );
  return playwrightLoad;
}
var INTERACTIVE_SELECTOR = 'a[href], button, input, select, textarea, [role="button"], [role="link"][role="textbox"], [role="checkbox"], [role="radio"], [role="combobox"], [role="switch"]';
function collectFrameElements(params) {
  const helpers = {
    /** Infer an ARIA role from a tag (and input type) when no explicit role is set. */
    roleFromTag(tag, el) {
      if (tag === "a") return "link";
      if (tag === "button") return "button";
      if (tag === "textarea") return "textbox";
      if (tag === "select") return "combobox";
      if (tag === "input") {
        const type = (el.getAttribute("type") ?? "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "button" || type === "submit" || type === "reset") return "button";
        return "textbox";
      }
      return tag;
    },
    /** Best-effort accessible name for an element. */
    accessibleName(el, tag) {
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel !== null && ariaLabel !== "") return ariaLabel.trim();
      if (tag === "input") {
        const placeholder = el.getAttribute("placeholder");
        if (placeholder !== null && placeholder !== "") return placeholder.trim();
        const name = el.getAttribute("name");
        if (name !== null && name !== "") return name.trim();
      }
      const rawText = el.textContent;
      const text2 = (rawText ?? "").trim().replace(/\s+/g, " ");
      if (text2 !== "") return text2.length > 120 ? `${text2.slice(0, 117)}...` : text2;
      const id = el.getAttribute("id");
      return id !== null && id !== "" ? id : "(unnamed)";
    }
  };
  const elements = [];
  const nodes = Array.from(document.querySelectorAll(params.selector));
  let index = 0;
  for (const el of nodes) {
    if (el.getClientRects().length === 0) continue;
    const ref = `@e${params.start + index + 1}`;
    index += 1;
    el.setAttribute("data-aws-ref", ref);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") ?? helpers.roleFromTag(tag, el);
    const name = helpers.accessibleName(el, tag);
    const href = tag === "a" ? el.getAttribute("href") : null;
    elements.push({ role, name, tag, href });
  }
  const text = document.body.innerText;
  return { elements, text };
}
var PlaywrightProvider = class {
  id = "playwright";
  headless;
  timeoutMs;
  authProfiles;
  maxTextLength;
  maxElements;
  allowPrivateNetworks;
  constructor(config = {}) {
    this.headless = config.headless ?? true;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.authProfiles = config.authProfiles ?? {};
    this.maxTextLength = DEFAULT_MAX_TEXT_LENGTH;
    this.maxElements = DEFAULT_MAX_ELEMENTS;
    this.allowPrivateNetworks = config.allowPrivateNetworks ?? false;
    void loadPlaywright().catch(() => void 0);
  }
  /** Cheap local usability check: the Chromium executable must resolve. */
  available() {
    if (playwrightModule !== void 0) {
      try {
        return playwrightModule.chromium.executablePath() !== "";
      } catch {
        return false;
      }
    }
    return !playwrightLoadFailed;
  }
  async open(options, signal) {
    throwIfAborted(signal);
    let pw;
    try {
      pw = await loadPlaywright();
    } catch (error) {
      throw new CoreError(
        "playwright is not installed: it is an optional dependency of @agents-web-search/core \u2014 install it (npm install playwright) where the core is consumed, then re-run `npx playwright install chromium`",
        BROWSER_CODES.UNAVAILABLE,
        { cause: error }
      );
    }
    const storageState = this.resolveStorageState(options.authProfile);
    const browser = await pw.chromium.launch({ headless: options.headless ?? this.headless });
    const contextOptions = {};
    if (storageState !== void 0) contextOptions.storageState = storageState;
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    return new PlaywrightSession(browser, page, this.timeoutMs, this.maxTextLength, this.maxElements, this.allowPrivateNetworks);
  }
  resolveStorageState(profileName) {
    if (profileName === void 0) return void 0;
    const path3 = this.authProfiles[profileName];
    if (path3 === void 0) {
      throw new CoreError(
        `auth profile "${profileName}" is not configured; known profiles: ${Object.keys(this.authProfiles).join(", ") || "(none)"}`,
        BROWSER_CODES.AUTH_MISSING
      );
    }
    return path3;
  }
};
var PlaywrightSession = class {
  constructor(browser, page, timeoutMs, maxTextLength, maxElements, allowPrivateNetworks) {
    this.browser = browser;
    this.page = page;
    this.timeoutMs = timeoutMs;
    this.maxTextLength = maxTextLength;
    this.maxElements = maxElements;
    this.allowPrivateNetworks = allowPrivateNetworks;
  }
  browser;
  page;
  timeoutMs;
  maxTextLength;
  maxElements;
  allowPrivateNetworks;
  providerId = "playwright";
  closed = false;
  /** Frame owning each `data-aws-ref` from the last snapshot (main frame when absent). */
  frameRefs = /* @__PURE__ */ new Map();
  url() {
    return this.page.url();
  }
  async navigate(url, signal) {
    this.ensureOpen(signal);
    const target = assertHttpUrl(url);
    await assertPublicNavigation(target, this.allowPrivateNetworks);
    try {
      await this.page.goto(target, { waitUntil: "load", timeout: this.timeoutMs });
    } catch (error) {
      throw classifyPlaywrightError(error, "navigate");
    }
    const finalUrl = this.page.url();
    if (finalUrl.length > 0 && finalUrl !== "about:blank") {
      await assertPublicNavigation(finalUrl, this.allowPrivateNetworks);
    }
    const title = await this.page.title().catch(() => void 0);
    return { url: finalUrl, ...title !== void 0 ? { title } : {} };
  }
  async snapshot(options = {}, signal) {
    this.ensureOpen(signal);
    const maxTextLength = options.maxTextLength ?? this.maxTextLength;
    const maxElements = options.maxElements ?? this.maxElements;
    const frames = this.page.frames();
    const raw = [];
    let mainText = "";
    for (const frame of frames) {
      try {
        const data = await frame.evaluate(collectFrameElements, { selector: INTERACTIVE_SELECTOR, start: raw.length });
        if (frame === this.page.mainFrame()) mainText = data.text;
        for (const el of data.elements) raw.push({ el, frame });
      } catch {
        continue;
      }
    }
    const elements = raw.slice(0, maxElements).map(({ el, frame }, i) => {
      const ref = `@e${i + 1}`;
      this.frameRefs.set(ref, frame);
      return {
        ref,
        role: el.role,
        name: el.name,
        tag: el.tag,
        ...el.href !== null && el.href !== "" ? { href: el.href } : {},
        ...frame === this.page.mainFrame() ? {} : { frame: frame.url() }
      };
    });
    const truncated = raw.length > maxElements || mainText.length > maxTextLength;
    return {
      url: this.page.url(),
      title: await this.page.title().catch(() => ""),
      elements,
      text: mainText.slice(0, maxTextLength),
      truncated
    };
  }
  async click(target, signal) {
    this.ensureOpen(signal);
    const locator = this.locatorFor(target);
    try {
      await locator.click({ timeout: this.timeoutMs });
    } catch (error) {
      throw classifyPlaywrightError(error, "click");
    }
  }
  async type(target, text, signal) {
    this.ensureOpen(signal);
    const locator = this.locatorFor(target);
    try {
      await locator.fill(text, { timeout: this.timeoutMs });
    } catch (error) {
      throw classifyPlaywrightError(error, "type");
    }
  }
  async evaluate(expression, signal) {
    this.ensureOpen(signal);
    try {
      return await this.page.evaluate(expression);
    } catch (error) {
      throw classifyPlaywrightError(error, "evaluate");
    }
  }
  async screenshot(options = {}, signal) {
    this.ensureOpen(signal);
    try {
      const buffer = options.selector !== void 0 ? await this.page.locator(options.selector).screenshot({ timeout: this.timeoutMs }) : await this.page.screenshot({ fullPage: options.fullPage ?? false, timeout: this.timeoutMs });
      return { buffer, mimeType: "image/png" };
    } catch (error) {
      throw classifyPlaywrightError(error, "screenshot");
    }
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.browser.close().catch(() => void 0);
  }
  locatorFor(target) {
    if (target.kind === "ref") {
      const frame = this.frameRefs.get(target.ref);
      return (frame ?? this.page).locator(`[data-aws-ref="${target.ref}"]`);
    }
    return this.page.locator(target.selector);
  }
  ensureOpen(signal) {
    if (this.closed) throw new CoreError("the browser session is closed; open a new one", BROWSER_CODES.NOT_OPEN);
    throwIfAborted(signal);
  }
};
function assertHttpUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new CoreError(`invalid URL: ${url}`, BROWSER_CODES.INVALID_URL);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CoreError(`only http(s) URLs are supported, got "${parsed.protocol}"`, BROWSER_CODES.INVALID_URL);
  }
  return parsed.toString();
}
function throwIfAborted(signal) {
  if (signal !== void 0 && signal.aborted) {
    throw new CoreError("the browser action was aborted", BROWSER_CODES.ABORTED);
  }
}
function classifyPlaywrightError(error, action) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(message)) {
    return new CoreError(`browser ${action} timed out: ${message}`, BROWSER_CODES.TIMEOUT, { cause: error });
  }
  if (/target closed|browser has been closed|context closed/i.test(message)) {
    return new CoreError(`browser ${action} failed (session closed): ${message}`, BROWSER_CODES.NOT_OPEN, { cause: error });
  }
  return new CoreError(`browser ${action} failed: ${message}`, BROWSER_CODES.ACTION_FAILED, { cause: error });
}

// src/browser/manager.ts
var ANON_KEY = /* @__PURE__ */ Symbol("browser-anon-session");
function createBrowserManager(options = {}) {
  const provider = options.provider ?? new PlaywrightProvider({
    headless: options.headless,
    timeoutMs: options.timeoutMs,
    authProfiles: options.authProfiles,
    allowPrivateNetworks: options.allowPrivateNetworks
  });
  const maxTabs = Math.max(options.maxConcurrentTabs ?? 1, 1);
  const sessions = /* @__PURE__ */ new Map();
  const keyOf = (agent) => agent ?? ANON_KEY;
  return {
    providerId: provider.id,
    session(agent) {
      return sessions.get(keyOf(agent));
    },
    async open(agent, openOptions = {}, signal) {
      const key = keyOf(agent);
      const existing = sessions.get(key);
      if (existing !== void 0) {
        throw new CoreError("a browser session is already open for this agent; close it first (browser_close)", BROWSER_CODES.ALREADY_OPEN);
      }
      if (sessions.size >= maxTabs) {
        throw new CoreError(`the browser tab limit is reached (${maxTabs} concurrent session${maxTabs > 1 ? "s" : ""}); close one first`, BROWSER_CODES.ALREADY_OPEN);
      }
      const session = await provider.open(openOptions, signal);
      sessions.set(key, session);
      return session;
    },
    async close(agent) {
      const key = keyOf(agent);
      const session = sessions.get(key);
      if (session === void 0) return;
      sessions.delete(key);
      await session.close();
    },
    async closeAll() {
      const open = [...sessions.values()];
      sessions.clear();
      await Promise.all(open.map((session) => session.close()));
    },
    available() {
      return provider.available();
    }
  };
}

// src/browser/screenshot.ts
import { randomUUID } from "node:crypto";
import { mkdir as mkdir2, writeFile } from "node:fs/promises";
import { join } from "node:path";
async function writeScreenshot(buffer, dir) {
  await mkdir2(dir, { recursive: true });
  const path3 = join(dir, `browser-${randomUUID()}.png`);
  await writeFile(path3, buffer);
  return path3;
}

// src/browser/tools.ts
function requiresApproval(policy, kind) {
  if (policy === "never") return false;
  if (policy === "all") return true;
  return kind === "browser_navigate" || kind === "browser_evaluate";
}
async function approve(deps, kind, description) {
  if (!requiresApproval(deps.config.browser.approval, kind)) return;
  const host = deps.host;
  if (host.approve === void 0) {
    throw new CoreError(
      `browser ${kind.slice("browser_".length)} requires approval (policy "${deps.config.browser.approval}"), but the host provides no approval channel \u2014 the action is denied (fail-closed)`,
      BROWSER_CODES.APPROVAL_UNAVAILABLE
    );
  }
  const granted = await host.approve({ kind, description });
  if (granted !== true) {
    throw new CoreError(`browser ${kind.slice("browser_".length)} was not approved`, BROWSER_CODES.APPROVAL_DENIED);
  }
}
function guarded2(body) {
  return async (args, ctx) => {
    try {
      return await body(args, ctx);
    } catch (error) {
      if (error instanceof CoreError) {
        return { text: `Error (${errorCodeOf(error)}): ${error.message}`, isError: true };
      }
      return { text: `Error (WEB_INTERNAL): ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
  };
}
function requireSession(deps) {
  const session = deps.manager.session();
  if (session === void 0) {
    throw new CoreError("no browser session is open; call browser_open first", BROWSER_CODES.NOT_OPEN);
  }
  return session;
}
function renderSnapshot(value) {
  const lines = [`URL: ${value.url}`, `Title: ${value.title}`, ""];
  if (value.elements.length === 0) {
    lines.push("No interactive elements.");
  } else {
    lines.push("Interactive elements (click/type by ref or selector; elements in child frames are marked):");
    for (const el of value.elements) {
      const href = el.href !== void 0 ? ` (${el.href})` : "";
      const frame = el.frame !== void 0 ? ` [in iframe: ${frameLabel(el.frame)}]` : "";
      lines.push(`  ${el.ref} [${el.role}] "${el.name}"${href}${frame}`);
    }
  }
  lines.push("", "Page text:");
  lines.push(value.text === "" ? "(empty)" : value.text);
  if (value.truncated) lines.push("(truncated)");
  return lines.join("\n");
}
function frameLabel(url) {
  if (!url || url === "about:blank" || url === "about:srcdoc") return "about:blank";
  try {
    const origin = new URL(url).origin;
    return origin === "null" ? url : origin;
  } catch {
    return url;
  }
}
function toOutputJson(value) {
  if (value === void 0) return "null";
  let text;
  try {
    text = JSON.stringify(JSON.parse(JSON.stringify(value)));
  } catch {
    return String(value).slice(0, 2e4);
  }
  if (text.length > 2e4) text = `${text.slice(0, 2e4)}\u2026(truncated)`;
  return text;
}
function resolveTarget(args) {
  const ref = typeof args["ref"] === "string" ? args["ref"] : "";
  const selector = typeof args["selector"] === "string" ? args["selector"] : "";
  if (ref.length > 0 && selector.length > 0) {
    throw new CoreError('provide exactly one of "ref" or "selector"', BROWSER_CODES.INVALID_URL);
  }
  if (ref.length > 0) return { kind: "ref", ref };
  if (selector.length > 0) return { kind: "selector", selector };
  throw new CoreError('provide "ref" (from browser_snapshot) or "selector" (CSS)', BROWSER_CODES.INVALID_URL);
}
function buildBrowserTools(deps) {
  const screenshotDir = `${deps.host.paths.stateDir.replace(/\/+$/, "")}/browser-screenshots`;
  const inlineDefault = deps.config.browser.screenshotInlineDefault;
  return [
    {
      name: "browser_open",
      description: "Open a local headless Chromium browser session (Playwright). Optionally navigate to a URL immediately. Navigate is a sensitive action and may require approval per the configured policy.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Absolute http(s) URL to open immediately (optional)." }
        }
      },
      execute: guarded2(async (args, { signal }) => {
        const record = asRecord2(args);
        const url = typeof record["url"] === "string" && record["url"].length > 0 ? record["url"] : void 0;
        const session = await deps.manager.open(void 0, {}, signal);
        let text = `Browser session opened (provider: ${session.providerId}).`;
        if (url !== void 0) {
          await approve(deps, "browser_navigate", `Navigate to ${url}`);
          const result = await session.navigate(url, signal);
          text += ` Navigated to ${result.url}${result.title !== void 0 ? ` ("${result.title}")` : ""}.`;
        }
        return { text, details: { url: session.url() } };
      })
    },
    {
      name: "browser_navigate",
      description: "Navigate the open browser session to an absolute http(s) URL and wait for load.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Absolute http(s) URL." }
        },
        required: ["url"]
      },
      execute: guarded2(async (args, { signal }) => {
        const record = asRecord2(args);
        const url = typeof record["url"] === "string" ? record["url"] : "";
        if (url.length === 0) throw new CoreError("url is required", BROWSER_CODES.INVALID_URL);
        await approve(deps, "browser_navigate", `Navigate to ${url}`);
        const session = requireSession(deps);
        const result = await session.navigate(url, signal);
        return { text: `Navigated to ${result.url}${result.title !== void 0 ? ` ("${result.title}")` : ""}.`, details: result };
      })
    },
    {
      name: "browser_snapshot",
      description: "Capture the current page: interactive elements (addressable by ref for click/type) and visible text.",
      parameters: {
        type: "object",
        properties: {
          max_elements: { type: "integer", description: "Maximum interactive elements (default 200)." },
          max_text: { type: "integer", description: "Maximum visible-text characters (default 20000)." }
        }
      },
      execute: guarded2(async (args) => {
        const record = asRecord2(args);
        const session = requireSession(deps);
        const snapshot = await session.snapshot({
          ...typeof record["max_elements"] === "number" ? { maxElements: record["max_elements"] } : {},
          ...typeof record["max_text"] === "number" ? { maxTextLength: record["max_text"] } : {}
        });
        return { text: renderSnapshot(snapshot), details: snapshot };
      })
    },
    {
      name: "browser_click",
      description: "Click an element of the open browser page, addressed by snapshot ref or CSS selector.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: 'Element ref from browser_snapshot (e.g. "@e3").' },
          selector: { type: "string", description: "CSS selector (alternative to ref)." }
        }
      },
      execute: guarded2(async (args, { signal }) => {
        const record = asRecord2(args);
        const target = resolveTarget(record);
        await approve(deps, "browser_click", `Click ${describeTarget(target)}`);
        const session = requireSession(deps);
        await session.click(target, signal);
        return { text: `Clicked ${describeTarget(target)}.` };
      })
    },
    {
      name: "browser_type",
      description: "Type text into an element of the open browser page (replacing its value).",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: 'Element ref from browser_snapshot (e.g. "@e3").' },
          selector: { type: "string", description: "CSS selector (alternative to ref)." },
          text: { type: "string", description: "The text to type." }
        },
        required: ["text"]
      },
      execute: guarded2(async (args, { signal }) => {
        const record = asRecord2(args);
        const target = resolveTarget(record);
        const text = typeof record["text"] === "string" ? record["text"] : "";
        if (text.length === 0) throw new CoreError("text is required", BROWSER_CODES.INVALID_URL);
        await approve(deps, "browser_type", `Type into ${describeTarget(target)}`);
        const session = requireSession(deps);
        await session.type(target, text, signal);
        return { text: `Typed ${text.length} characters into ${describeTarget(target)}.` };
      })
    },
    {
      name: "browser_evaluate",
      description: "Evaluate JavaScript in the page context and return the JSON-serializable result.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "The JavaScript expression to evaluate." }
        },
        required: ["expression"]
      },
      execute: guarded2(async (args, { signal }) => {
        const record = asRecord2(args);
        const expression = typeof record["expression"] === "string" ? record["expression"] : "";
        if (expression.length === 0) throw new CoreError("expression is required", BROWSER_CODES.INVALID_URL);
        await approve(deps, "browser_evaluate", `Evaluate: ${expression.slice(0, 200)}`);
        const session = requireSession(deps);
        const result = await session.evaluate(expression, signal);
        return { text: toOutputJson(result) };
      })
    },
    {
      name: "browser_screenshot",
      description: `Capture a PNG screenshot of the page (or one element). By default written to a file in the state dir; inline: true returns a data URI instead. Default mode: ${inlineDefault ? "inline" : "file"}.`,
      parameters: {
        type: "object",
        properties: {
          full_page: { type: "boolean", description: "Capture the full scrollable page (default false)." },
          selector: { type: "string", description: "Capture a single element (CSS selector) instead of the page." },
          inline: { type: "boolean", description: "Return a data:image/png;base64 URI instead of a file path." }
        }
      },
      execute: guarded2(async (args, { signal }) => {
        const record = asRecord2(args);
        const session = requireSession(deps);
        const inline = typeof record["inline"] === "boolean" ? record["inline"] : inlineDefault;
        const screenshot = await session.screenshot({
          ...typeof record["full_page"] === "boolean" ? { fullPage: record["full_page"] } : {},
          ...typeof record["selector"] === "string" ? { selector: record["selector"] } : {}
        }, signal);
        if (inline) {
          return {
            text: `data:image/png;base64,${screenshot.buffer.toString("base64")}`,
            details: { inline: true }
          };
        }
        const path3 = await writeScreenshot(screenshot.buffer, screenshotDir);
        return { text: `Screenshot saved to ${path3}.`, details: { path: path3 } };
      })
    },
    {
      name: "browser_close",
      description: "Close the open browser session and release the browser.",
      parameters: { type: "object", properties: {} },
      execute: guarded2(async () => {
        await deps.manager.close(void 0);
        return { text: "Browser session closed." };
      })
    }
  ];
}
function describeTarget(target) {
  return target.kind === "ref" ? target.ref : `"${target.selector}"`;
}
function asRecord2(args) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return {};
  return args;
}

// src/stack.ts
var COOLDOWN_BASE_MS = 3e4;
var COOLDOWN_MAX_MS = 36e5;
var DEFAULT_MAX_RESULTS = 5;
function createWebStack(host) {
  const config = resolveCoreConfig(host.config, host.paths.stateDir);
  const userAgent = composeUserAgent(host);
  const store = new WebStore({
    path: config.store.path,
    evictLimits: config.store.evictLimits
  });
  const fetcher = new CachedHttpFetchProvider(buildFetchLimits(config, store, userAgent));
  const engines = buildEngines({ config, host, userAgent });
  const explicitOnly = explicitOnlyEngineIds(config);
  const multi = new MultiSearchProvider({
    engines: config.search.engines,
    mode: config.search.mode,
    defaultMaxResults: DEFAULT_MAX_RESULTS,
    store,
    engineById: engines,
    enrich: config.search.enrich.enabled,
    enrichFetchLimit: config.search.enrich.fetchLimit,
    enrichKeep: config.search.enrich.keep,
    searchCacheTtlMs: config.search.cacheTtlMs,
    pageCacheTtlMs: config.fetch.cacheTtlMs,
    timeoutMs: config.search.timeoutMs,
    cooldownBaseMs: COOLDOWN_BASE_MS,
    cooldownMaxMs: COOLDOWN_MAX_MS,
    enrichOptions: {
      pageTimeoutMs: config.search.enrich.fetchTimeoutMs,
      pageCacheTtlMs: config.fetch.cacheTtlMs,
      maxPageBytes: config.fetch.maxBodyBytes,
      maxBodyChars: config.fetch.maxOutputChars,
      snippetChars: 500,
      userAgent,
      concurrency: 3,
      allowPrivateNetworks: config.fetch.allowPrivateNetworks
    },
    logger: host.log !== void 0 ? { info: (message, ...meta) => host.log?.("info", message, toMeta(meta)) } : void 0
  });
  const registry = new PlatformRegistry({
    builtins: BUILTIN_PLATFORMS,
    configured: config.platforms.platforms.map((raw, index) => {
      try {
        return validatePlatform(raw, `platforms.platforms[${index}]`);
      } catch (error) {
        throw new CoreError(
          `invalid configured platform at platforms.platforms[${index}]: ${error instanceof Error ? error.message : String(error)}`,
          "WEB_BAD_REQUEST",
          { cause: error }
        );
      }
    }),
    rulePackPaths: config.platforms.rulePackPaths
  });
  const browserManager = config.browser.enabled ? createBrowserManager({
    headless: config.browser.headless,
    timeoutMs: config.browser.timeoutMs,
    authProfiles: config.browser.authProfiles,
    allowPrivateNetworks: config.browser.allowPrivateNetworks,
    maxConcurrentTabs: config.browser.maxConcurrentTabs
  }) : void 0;
  const stackToolHost = {
    config,
    store,
    search: (request, signal) => searchStack(request, signal),
    fetch: (request, signal) => fetcher.fetch({ url: request.url }, signal),
    platformSearch: (request, signal) => platformSearchStack(request, signal),
    llm: host.llm
  };
  async function searchStack(request, signal) {
    const forced = request.engine;
    if (forced !== void 0 && explicitOnly.has(forced)) {
    }
    const query = request.query?.trim();
    if (query === void 0 || query.length === 0) {
      throw new CoreError("search query must be a non-empty string", "WEB_BAD_REQUEST");
    }
    const maxResults = request.maxResults !== void 0 ? Math.min(Math.max(request.maxResults, 1), 20) : DEFAULT_MAX_RESULTS;
    const provider = forced !== void 0 ? forcedProviders.get(forced) ?? buildForcedProvider(forced) : multi;
    if (forced !== void 0) forcedProviders.set(forced, provider);
    const result = await provider.search(
      {
        query,
        maxResults,
        ...request.recency !== void 0 ? { recency: request.recency } : {},
        ...request.domains !== void 0 ? { domains: [...request.domains] } : {}
      },
      signal
    );
    return {
      ...result,
      enginesUsed: forced !== void 0 ? [forced] : void 0
    };
  }
  const forcedProviders = /* @__PURE__ */ new Map();
  function buildForcedProvider(engineId) {
    return new MultiSearchProvider({
      engines: [engineId],
      forcedEngine: engineId,
      mode: config.search.mode,
      defaultMaxResults: DEFAULT_MAX_RESULTS,
      store,
      engineById: engines,
      enrich: false,
      enrichFetchLimit: 0,
      enrichKeep: 0,
      searchCacheTtlMs: config.search.cacheTtlMs,
      pageCacheTtlMs: config.fetch.cacheTtlMs,
      timeoutMs: config.search.timeoutMs,
      cooldownBaseMs: COOLDOWN_BASE_MS,
      cooldownMaxMs: COOLDOWN_MAX_MS,
      enrichOptions: {
        pageTimeoutMs: config.search.enrich.fetchTimeoutMs,
        pageCacheTtlMs: config.fetch.cacheTtlMs,
        maxPageBytes: config.fetch.maxBodyBytes,
        maxBodyChars: config.fetch.maxOutputChars,
        snippetChars: 500,
        userAgent,
        concurrency: 1,
        allowPrivateNetworks: config.fetch.allowPrivateNetworks
      }
    });
  }
  async function platformSearchStack(request, signal) {
    registry.refresh();
    const platformSignal = signal ?? new AbortController().signal;
    return await searchPlatform(
      { platform: request.platform, query: request.query, ...request.maxResults !== void 0 ? { limit: request.maxResults } : {} },
      {
        registry,
        timeoutMs: config.platforms.timeoutMs,
        maxBytes: config.platforms.maxBytes,
        maxResults: config.platforms.maxResults,
        allowPrivateNetworks: config.platforms.allowPrivateNetworks
      },
      platformSignal
    );
  }
  let disposed = false;
  return {
    host,
    config,
    store,
    userAgent,
    engines,
    browser: browserManager,
    search: searchStack,
    fetch: (request, signal) => {
      const url = request.url?.trim();
      if (url === void 0 || url.length === 0) {
        return Promise.reject(new CoreError("fetch url must be a non-empty string", "WEB_BAD_REQUEST"));
      }
      return fetcher.fetch({ url }, signal);
    },
    platformSearch: platformSearchStack,
    tools() {
      const core = buildCoreTools(stackToolHost);
      if (browserManager === void 0) return core;
      return [...core, ...buildBrowserTools({ manager: browserManager, host, config })];
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await browserManager?.closeAll();
      await host.dispose?.();
      await store.close();
    }
  };
  function toMeta(meta) {
    const record = {};
    meta.forEach((value, index) => {
      if (value !== void 0) record[`meta${index}`] = value;
    });
    return record;
  }
}
function composeUserAgent(host) {
  const identity = host.identity.name;
  const version = host.identity.version;
  return version !== void 0 && version.length > 0 ? `${PRODUCT_USER_AGENT} ${identity}/${version}` : `${PRODUCT_USER_AGENT} ${identity}`;
}
export {
  ANON_KEY,
  BROWSER_CODES,
  BUILTIN_PLATFORMS,
  CACHED_FETCH_PROVIDER_ID,
  CachedHttpFetchProvider,
  CoreError,
  DEFAULT_BLOCKED_DOMAINS,
  DEFAULT_ENGINES,
  KNOWN_ENGINES,
  MULTI_SEARCH_PROVIDER_ID,
  MultiSearchProvider,
  PRODUCT_USER_AGENT,
  PlatformRegistry,
  PlaywrightProvider,
  TimeoutReason,
  WebStore,
  assertPublicNavigation,
  buildBrowserTools,
  buildCacheClearTool,
  buildCoreTools,
  buildEngines,
  buildFetchLimits,
  buildFetchTool,
  buildHistoryTool,
  buildPlatformSearchTool,
  buildSearchTool,
  buildStatsTool,
  checkSsrf,
  createBrowserManager,
  createWebStack,
  deadline,
  errorCodeOf,
  errorMessage,
  explicitOnlyEngineIds,
  exportRulePack,
  htmlToMarkdown,
  importRulePack,
  isCoreError,
  loadPlaywright,
  normalizeUrl,
  resolveCoreConfig,
  searchCacheKey,
  timeoutOf,
  toCoreError,
  validatePlatform,
  validateRulePack,
  writeScreenshot
};
