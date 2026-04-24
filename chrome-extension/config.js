(function initXcrabConfig(globalScope) {
  const DEFAULT_BASE_URL = 'https://xcrab.net';
  let envCachePromise = null;

  function normalizeBaseUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  }

  function parseEnv(text) {
    const env = {};
    for (const rawLine of String(text).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;
      const key = line.slice(0, eqIndex).trim();
      const value = line.slice(eqIndex + 1).trim();
      env[key] = value;
    }
    return env;
  }

  async function readEnv() {
    if (!envCachePromise) {
      envCachePromise = fetch(chrome.runtime.getURL('.env'))
        .then((response) => (response.ok ? response.text() : ''))
        .then((text) => parseEnv(text))
        .catch(() => ({}));
    }
    return envCachePromise;
  }

  async function getBaseUrl() {
    const env = await readEnv();
    return normalizeBaseUrl(env.BASE_URL) || DEFAULT_BASE_URL;
  }

  globalScope.readExtensionEnv = readEnv;
  globalScope.getBaseUrl = getBaseUrl;
})(globalThis);
