/**
 * @name DashSender
 * @author sunny
 * @version 1.0.0
 * @description Sends the notes queued in Dash's Discord category as DMs from your own account.
 */

const SUPABASE_URL = 'https://zcsfiovwomnkdhnfkoqk.supabase.co';
// Public by design: row-level security limits each account to its own rows.
const SUPABASE_KEY = 'sb_publishable_cg6T49bzij-iV46Wha2AaA_cVnfbHMx';
const NAME = 'DashSender';
const UNDO_WINDOW_MS = 2 * 60 * 1000;
const RUN_EVERY_MS = 60 * 1000;
const MAX_PER_RUN = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const norm = (s) => String(s || '').toLowerCase().replace(/^[\s@]+|[\s.,:;!?]+$/g, '').trim();

module.exports = class DashSender {
  start() {
    this.running = false;
    this.stopped = false;
    this.timers = new Set();
    this.interval = setInterval(() => this.run(), RUN_EVERY_MS);
    this.later(() => this.run(), 5000);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.interval);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  }

  wait(ms) {
    return new Promise((resolve) => this.later(resolve, ms));
  }

  // ---------- storage ----------
  load(key, fallback) {
    const v = BdApi.Data.load(NAME, key);
    return v === undefined || v === null ? fallback : v;
  }

  save(key, value) {
    BdApi.Data.save(NAME, key, value);
  }

  toast(msg, type = 'info') {
    BdApi.UI.showToast(msg, { type });
  }

  // ---------- supabase ----------
  async http(method, url, headers, body) {
    const res = await BdApi.Net.fetch(url, {
      method,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json };
  }

  async authRequest(path, body) {
    const res = await this.http('POST', `${SUPABASE_URL}/auth/v1/${path}`, {}, body);
    if (!res.ok) {
      const j = res.json || {};
      const err = new Error(j.msg || j.error_description || j.message || `Error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json;
  }

  saveSession(s) {
    this.save('session', {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_at: s.expires_at || Math.floor(Date.now() / 1000) + s.expires_in,
      user: { id: s.user.id, email: s.user.email },
    });
  }

  async sendCode(email) {
    await this.authRequest('otp', { email, create_user: false });
  }

  async verifyCode(email, token) {
    this.saveSession(await this.authRequest('verify', { type: 'email', email, token }));
  }

  logOut() {
    this.save('session', null);
  }

  // Returns the access token, refreshing it when it's about to expire. Null when logged out.
  async accessToken() {
    const s = this.load('session', null);
    if (!s) return null;
    if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
    try {
      // Save right away: refresh tokens rotate and work only once.
      this.saveSession(await this.authRequest('token?grant_type=refresh_token', { refresh_token: s.refresh_token }));
    } catch (err) {
      if ([400, 401, 403].includes(err.status)) {
        this.logOut();
        this.toast('DashSender: log in again in plugin settings', 'error');
        return null;
      }
      throw err;
    }
    return this.load('session', null).access_token;
  }

  async rest(method, path, body, prefer) {
    const token = await this.accessToken();
    if (!token) throw new Error('logged out');
    const res = await this.http(method, `${SUPABASE_URL}/rest/v1/${path}`, {
      Authorization: `Bearer ${token}`,
      Prefer: prefer || 'return=minimal',
    }, body);
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    return res.json;
  }

  // ---------- discord internals ----------
  modules() {
    const W = BdApi.Webpack;
    const m = {
      RelationshipStore: W.getStore('RelationshipStore'),
      UserStore: W.getStore('UserStore'),
      ChannelStore: W.getStore('ChannelStore'),
      opener: W.getByKeys('openPrivateChannel') || W.getByKeys('ensurePrivateChannel'),
      sender: W.getByKeys('sendMessage', 'editMessage'),
    };
    const missing = Object.keys(m).filter((k) => !m[k]);
    if (missing.length) throw new Error(`missing Discord module: ${missing.join(', ')}`);
    return m;
  }

  // Every user we could DM, with the names they can be called: [{id, names: []}].
  candidates(m) {
    const ids = new Set(m.RelationshipStore.getFriendIDs?.() || []);
    const channels = m.ChannelStore.getSortedPrivateChannels ? m.ChannelStore.getSortedPrivateChannels() : [];
    for (const c of channels) if (c.type === 1 && c.recipients?.length === 1) ids.add(c.recipients[0]);
    const out = [];
    for (const id of ids) {
      const u = m.UserStore.getUser(id);
      if (!u) continue;
      const names = [m.RelationshipStore.getNickname?.(id), u.globalName, u.username]
        .map(norm).filter(Boolean);
      out.push({ id, names });
    }
    return out;
  }

  aliases() {
    const out = {};
    for (const line of String(this.load('aliases', '')).split('\n')) {
      const i = line.indexOf('=');
      if (i < 1) continue;
      const name = norm(line.slice(0, i));
      const target = line.slice(i + 1).trim();
      if (name && target) out[name] = target;
    }
    return out;
  }

  // Longest-first match of up to 3 leading words. Returns {target, message} or throws a reason.
  parse(text, aliases, cands) {
    // Dictation and typing both put a break after the name: "test. Hey", "test, hey",
    // "test: hey", "test - hey", "test — hey". Dashes become separate words, and the
    // name can't run past a word that ends in punctuation ("test. Hey are" is not a name).
    const words = text.replace(/\s*[—–]\s*/g, ' - ').split(/\s+/).filter(Boolean);
    for (let n = Math.min(3, words.length); n >= 1; n--) {
      if (words.slice(0, n - 1).some((w) => /[.,:;!?]$/.test(w))) continue;
      const name = norm(words.slice(0, n).join(' '));
      const message = words.slice(n).join(' ').replace(/^[\s:;,.!?-]+/, '').trim();
      let target = null;
      if (aliases[name]) {
        target = { alias: aliases[name] };
      } else {
        const hits = cands.filter((c) => c.names.includes(name));
        if (hits.length > 1) throw new Error(`several people called ${name}`);
        if (hits.length === 1) target = { userId: hits[0].id };
      }
      if (!target) continue;
      if (!message) throw new Error('empty message');
      return { target, message, name };
    }
    throw new Error(`no friend called ${norm(words[0] || '')}`);
  }

  async channelFor(target, m) {
    if (target.alias) {
      const a = target.alias;
      if (m.ChannelStore.getChannel(a)) return a;
      const hits = this.candidatesCache.filter((c) => c.names.includes(norm(a)) || c.id === a);
      if (hits.length !== 1) throw new Error(`alias target ${a} not found`);
      return this.channelFor({ userId: hits[0].id }, m);
    }
    const existing = m.ChannelStore.getDMFromUserId(target.userId);
    if (existing) return existing;
    const fn = m.opener.ensurePrivateChannel || m.opener.openPrivateChannel;
    const res = await fn.call(m.opener, target.userId);
    const id = typeof res === 'string' ? res : res?.id;
    if (!id) throw new Error('could not open DM');
    return id;
  }

  // ---------- run loop ----------
  async run() {
    if (this.running || this.stopped) return;
    this.running = true;
    const summary = { sent: 0, failed: 0 };
    try {
      if (!(await this.accessToken())) return;
      await this.markPending();

      const cutoff = new Date(Date.now() - UNDO_WINDOW_MS).toISOString();
      const rows = await this.rest('GET',
        `qn_entries?category=eq.Discord&deleted_at=is.null&updated_at=lt.${encodeURIComponent(cutoff)}` +
        `&order=created_at.asc&limit=${MAX_PER_RUN}&select=id,text,created_at`, undefined, 'return=representation');
      if (!rows || !rows.length) return;

      let m;
      try {
        m = this.modules();
      } catch (err) {
        this.toast(`DashSender: ${err.message}`, 'error');
        return;
      }
      this.candidatesCache = this.candidates(m);
      const aliases = this.aliases();

      let first = true;
      for (const row of rows) {
        if (this.stopped) break;
        const text = row.text.replace(/^\s*-\s*/, '').trim();
        if (text.startsWith('!')) continue;
        if (!first) await this.wait(3000 + Math.random() * 3000);
        first = false;
        let channelId, message;
        try {
          const p = this.parse(text, aliases, this.candidatesCache);
          message = p.message;
          channelId = await this.channelFor(p.target, m);
        } catch (err) {
          await this.fail(row, text, err.message);
          summary.failed++;
          continue;
        }
        try {
          // Remember the id before the PATCH so a failed PATCH can never cause a second send.
          await m.sender.sendMessage(channelId, { content: message, tts: false, invalidEmojis: [], validNonShortcutEmojis: [] }, undefined, {});
          const ids = this.load('sentIds', []);
          ids.push(row.id);
          this.save('sentIds', ids.slice(-200));
          summary.sent++;
        } catch (err) {
          await this.fail(row, text, `send failed: ${err.message}`);
          summary.failed++;
          continue;
        }
        await this.markPending();
      }
    } catch (err) {
      console.warn('[DashSender]', err);
    } finally {
      this.running = false;
      if (summary.sent || summary.failed) {
        const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.save('lastRun', `Sent ${summary.sent}, ${summary.failed} failed, ${t}`);
        this.toast(`DashSender: sent ${summary.sent}, failed ${summary.failed}`, summary.failed ? 'warning' : 'success');
      }
    }
  }

  // Marks every sent-but-unmarked note as sent on the server.
  async markPending() {
    const ids = this.load('sentIds', []);
    const left = [];
    for (const id of ids) {
      try {
        const now = new Date().toISOString();
        await this.rest('PATCH', `qn_entries?id=eq.${encodeURIComponent(id)}`,
          { deleted_at: now, deleted_how: 'sent', updated_at: now });
      } catch {
        left.push(id);
      }
    }
    this.save('sentIds', left);
  }

  async fail(row, text, reason) {
    try {
      const now = new Date().toISOString();
      const user = this.load('session', null).user.id;
      await this.rest('POST', 'qn_entries', {
        id: newId(), user_id: user, category: 'Discord',
        text: `- ! ${text} (${reason})`, created_at: now, updated_at: now,
      });
      await this.rest('PATCH', `qn_entries?id=eq.${encodeURIComponent(row.id)}`,
        { deleted_at: now, deleted_how: 'replaced', updated_at: now });
    } catch (err) {
      console.warn('[DashSender] could not record failure', err);
    }
  }

  // ---------- settings ----------
  getSettingsPanel() {
    const root = document.createElement('div');
    root.style.cssText = 'color: var(--text-normal); display: flex; flex-direction: column; gap: 8px; padding: 8px;';
    const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
    const input = (placeholder) => el('input', { placeholder, style: 'padding:6px;' });
    const button = (label, onclick) => el('button', { textContent: label, onclick, style: 'padding:6px 12px; cursor:pointer;' });

    const draw = () => {
      root.replaceChildren();
      const s = this.load('session', null);
      if (s) {
        root.append(
          el('div', { textContent: `Logged in as ${s.user.email}` }),
          button('Log out', () => { this.logOut(); draw(); }),
        );
      } else {
        const email = input('Dash email');
        const code = input('Code from email');
        const status = el('div');
        root.append(
          email,
          button('Send code', async () => {
            try { await this.sendCode(email.value.trim()); status.textContent = 'Code sent.'; }
            catch (e) { status.textContent = e.message; }
          }),
          code,
          button('Verify', async () => {
            try { await this.verifyCode(email.value.trim(), code.value.trim()); draw(); }
            catch (e) { status.textContent = e.message; }
          }),
          status,
        );
      }
      const aliases = el('textarea', {
        value: this.load('aliases', ''), rows: 5, style: 'padding:6px;',
        placeholder: 'name = username | user id | channel id',
        onblur: () => this.save('aliases', aliases.value),
      });
      const last = el('div', { textContent: this.load('lastRun', 'No runs yet.') });
      root.append(
        el('div', { textContent: 'Aliases (one per line)' }), aliases,
        button('Send now', async () => { await this.run(); last.textContent = this.load('lastRun', 'Nothing to send.'); }),
        last,
      );
    };
    draw();
    return root;
  }
};
