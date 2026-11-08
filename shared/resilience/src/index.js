const CircuitBreaker = require('opossum');

async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 3000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; e.data = data; throw e; }
    return data;
  } finally { clearTimeout(t); }
}

// Retries network errors and 5xx only; 4xx are answers, not failures.
async function withRetry(fn, { retries = 2, baseMs = 100 } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (err) {
      if ((err.status && err.status < 500) || i >= retries) throw err;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
}

// Internal HTTP client: timeout + retry + circuit breaker. 4xx responses never trip the breaker.
function createInternalClient({ baseUrl, token, breakerOptions = {} }) {
  const call = (path, headers) => withRetry(() => fetchJson(`${baseUrl}${path}`, { headers: { 'x-internal-token': token, ...headers } }));
  const breaker = new CircuitBreaker(call, {
    timeout: 8000, errorThresholdPercentage: 50, resetTimeout: 10000, volumeThreshold: 5,
    errorFilter: (err) => Boolean(err.status && err.status < 500), ...breakerOptions,
  });
  return { get: (path, headers = {}) => breaker.fire(path, headers), breaker };
}

module.exports = { fetchJson, withRetry, createInternalClient };
