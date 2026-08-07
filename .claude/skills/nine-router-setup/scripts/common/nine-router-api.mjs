#!/usr/bin/env node
// nine-router-api.mjs — authenticated client for the 9Router local management API.
//
// Verified against 9router 0.5.45 (2026-08-07). Uses the dashboard login session
// (auth_token cookie) for the /api/* management surface and the local API key for
// the /v1/* gateway. Never prints secrets.
//
// Exposes a small class + a handful of high-level helpers used by the shared
// configure/test scripts.

const DEFAULT_BASE = "http://127.0.0.1:20128";
const DEFAULT_INITIAL_PASSWORD = "123456";

function mask(v) {
  if (typeof v !== "string" || v.length === 0) return "<empty>";
  if (v.length <= 6) return "<short>";
  return `${v.slice(0, 3)}…${v.slice(-3)}`;
}

export class NineRouterClient {
  /**
   * @param {string} base Base URL, e.g. http://127.0.0.1:20128
   * @param {{timeoutMs?:number}} opts
   */
  constructor(base = DEFAULT_BASE, opts = {}) {
    this.base = base.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs || 30000;
    this.cookie = null;
    this.apiKey = null;
    // Optional machine-local CLI token (x-9r-cli-token). The management API
    // accepts either the dashboard session cookie or this token.
    this.cliToken = null;
  }

  /**
   * Set the machine-local CLI token used by 9Router automation (x-9r-cli-token).
   * Lets the management API be driven without the dashboard password when the
   * token is available locally.
   */
  useCliToken(token) {
    this.cliToken = token;
  }

  _url(path) {
    return `${this.base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async _req(method, path, body, { auth = "session" } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth === "session" && this.cookie) headers.Cookie = this.cookie;
    if (auth === "session" && !this.cookie && this.cliToken) headers["x-9r-cli-token"] = this.cliToken;
    if (auth === "key" && this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(this._url(path), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(t);
      throw new Error(`request failed ${method} ${path}: ${err.message}`);
    }
    clearTimeout(t);
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = data && typeof data === "object" && data.error ? data.error : text || res.statusText;
      throw new Error(`HTTP ${res.status} ${method} ${path}: ${msg}`);
    }
    return data;
  }

  // ---- dashboard session ----

  /**
   * Log in to the dashboard. On success stores the session cookie in memory only.
   * @param {string} password
   * @returns {Promise<{success:boolean, mustChangePassword:boolean}>}
   */
  async login(password) {
    const resp = await fetch(this._url("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const setCookie = resp.headers.get("set-cookie");
    if (setCookie) {
      this.cookie = setCookie.split(";")[0];
    }
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const txt = typeof body === "object" && body.error ? body.error : JSON.stringify(body);
      throw new Error(`login failed HTTP ${resp.status}: ${txt}`);
    }
    return { success: !!body.success, mustChangePassword: !!body.mustChangePassword };
  }

  async authStatus() {
    return this._req("GET", "/api/auth/status");
  }

  // ---- settings ----

  async getSettings() {
    return this._req("GET", "/api/settings");
  }

  async patchSettings(partial) {
    return this._req("PATCH", "/api/settings", partial);
  }

  // ---- keys ----

  async listKeys() {
    const data = await this._req("GET", "/api/keys");
    return data?.keys || [];
  }

  /**
   * Create a local API key by name. The key value is returned only at creation.
   * @returns {Promise<{key:string,name:string,id:string}>}
   */
  async createKey(name) {
    return this._req("POST", "/api/keys", { name });
  }

  // ---- providers ----

  async listProviders() {
    const data = await this._req("GET", "/api/providers");
    return data?.connections || [];
  }

  async createProvider(body) {
    const data = await this._req("POST", "/api/providers", body);
    return data?.connection || data;
  }

  async listProviderNodes() {
    const data = await this._req("GET", "/api/provider-nodes");
    return data?.nodes || [];
  }

  async createProviderNode(body) {
    const data = await this._req("POST", "/api/provider-nodes", body);
    return data?.node || data;
  }

  async getProviderModels(connectionId) {
    return this._req("GET", `/api/providers/${encodeURIComponent(connectionId)}/models`);
  }

  // ---- combos ----

  async listCombos() {
    const data = await this._req("GET", "/api/combos");
    return data?.combos || [];
  }

  async createCombo(body) {
    return this._req("POST", "/api/combos", body);
  }

  // ---- models ----

  async listModels() {
    const data = await this._req("GET", "/api/models");
    return data?.models || [];
  }

  // ---- gateway (chat) ----

  /**
   * Send a minimal Claude-format request through the router's /v1/messages endpoint
   * using the local API key.
   * @param {string} model Routed model string or combo name
   * @param {{maxTokens?:number, prompt?:string, images?:Array<{type:string,source:{type:string,data:string}}>}} opts
   */
  async chat(model, opts = {}) {
    const maxTokens = opts.maxTokens || 1500;
    const prompt = opts.prompt ?? "Reply with the single word: ok";
    const body = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: opts.images?.length ? [
        { type: "text", text: prompt },
        ...opts.images,
      ] : prompt }],
    };
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const res = await fetch(this._url("/v1/messages"), {
      method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  /**
   * Small OpenAI-format probe through /v1/chat/completions (used for effort probing
   * when a provider only surfaces reasoning_effort through the OpenAI surface).
   */
  async chatOpenAI(model, opts = {}) {
    const body = {
      model,
      max_tokens: opts.maxTokens || 16,
      messages: [{ role: "user", content: opts.prompt ?? "hi" }],
    };
    if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await fetch(this._url("/v1/chat/completions"), {
      method: "POST", headers, body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  async health() {
    const res = await fetch(this._url("/api/health"), { signal: AbortSignal.timeout(5000) });
    return { status: res.status, ok: res.ok };
  }
}

export { DEFAULT_BASE, DEFAULT_INITIAL_PASSWORD, mask };
