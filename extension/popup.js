// popup.js

let allCredentials = [];
let currentDomain  = '';
let editingCredential = null;
const SPECIAL_LOGIN_URLS = {
  'auth.digikey.com': 'https://www.digikey.com/MyDigiKey/Login?site=US&lang=en&returnurl=https%3A%2F%2Fwww.digikey.com%2F',
  'www.digikey.com': 'https://www.digikey.com/MyDigiKey/Login?site=US&lang=en&returnurl=https%3A%2F%2Fwww.digikey.com%2F',
  'digikey.com': 'https://www.digikey.com/MyDigiKey/Login?site=US&lang=en&returnurl=https%3A%2F%2Fwww.digikey.com%2F',
};

async function getLoginUrlOverrides() {
  const { loginUrlOverrides } = await chrome.storage.local.get('loginUrlOverrides');
  return loginUrlOverrides || {};
}

async function setLoginUrlOverride(id, loginUrl) {
  if (!id || !loginUrl) return;
  const loginUrlOverrides = await getLoginUrlOverrides();
  loginUrlOverrides[id] = loginUrl;
  await chrome.storage.local.set({ loginUrlOverrides });
}

async function removeLoginUrlOverride(id) {
  if (!id) return;
  const loginUrlOverrides = await getLoginUrlOverrides();
  if (!(id in loginUrlOverrides)) return;
  delete loginUrlOverrides[id];
  await chrome.storage.local.set({ loginUrlOverrides });
}

// ---- Tab switching ----
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ---- Toggle password visibility ----
function toggleVisibility(inputId, btn) {
  const el = document.getElementById(inputId);
  if (el.type === 'password') { el.type = 'text'; btn.textContent = '🙈'; }
  else { el.type = 'password'; btn.textContent = '👁'; }
}
document.getElementById('togglePass').addEventListener('click', () => toggleVisibility('addPassword', document.getElementById('togglePass')));
document.getElementById('toggleKey').addEventListener('click',  () => toggleVisibility('apiKey', document.getElementById('toggleKey')));

// ---- Toast helper ----
function showToast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.className = 'toast', 2500);
}

// ---- Load current domain ----
async function getCurrentDomain() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { return new URL(tab?.url || '').hostname; } catch { return ''; }
}

async function getCurrentPageUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url || '';
}

function normalizeDomain(value) {
  const raw = (value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return raw.replace(/^www\./, '').replace(/\/.*$/, '');
  }
}

function isCredentialMatch(hostname, savedDomain) {
  const host = normalizeDomain(hostname);
  const domain = normalizeDomain(savedDomain);
  if (!host || !domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

function getCredentialUrl(cred) {
  const loginUrl = (cred?.loginUrl || '').trim();
  if (loginUrl) return loginUrl;
  const normalizedDomain = normalizeDomain(cred?.domain || '');
  if (normalizedDomain && SPECIAL_LOGIN_URLS[normalizedDomain]) {
    return SPECIAL_LOGIN_URLS[normalizedDomain];
  }
  const raw = (cred?.domain || '').trim();
  if (!raw) return '';
  return raw.includes('://') ? raw : `https://${raw}`;
}

function getFaviconUrl(cred) {
  const url = getCredentialUrl(cred);
  const host = normalizeDomain(url || cred?.domain || '');
  if (!host) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256`;
}

function canonicalLoginUrl(value) {
  const raw = (value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.toString();
  } catch {
    return raw;
  }
}

function showAddTab() {
  document.querySelector('[data-tab="add"]').click();
}

function resetCredentialForm() {
  editingCredential = null;
  document.getElementById('addSectionTitle').textContent = 'Save new credential';
  document.getElementById('saveBtn').textContent = 'Save to Server';
  document.getElementById('cancelEditBtn').style.display = 'none';
  document.getElementById('addDomain').value = '';
  document.getElementById('addUsername').value = '';
  document.getElementById('addPassword').value = '';
  document.getElementById('addLoginUrl').value = '';
}

function updateUsernameSuggestions() {
  const list = document.getElementById('savedUsernames');
  if (!list) return;

  const usernames = [...new Set(
    allCredentials
      .map(cred => (cred.username || '').trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  list.replaceChildren(...usernames.map(username => {
    const option = document.createElement('option');
    option.value = username;
    return option;
  }));
}

function startEditingCredential(cred) {
  editingCredential = { ...cred };
  document.getElementById('addSectionTitle').textContent = 'Update credential';
  document.getElementById('saveBtn').textContent = 'Update Credential';
  document.getElementById('cancelEditBtn').style.display = 'block';
  document.getElementById('addDomain').value = cred.domain || '';
  document.getElementById('addUsername').value = cred.username || '';
  document.getElementById('addPassword').value = cred.password || '';
  document.getElementById('addLoginUrl').value = cred.loginUrl || '';
  showAddTab();
}

function urlLooksLikeLoginPage(url) {
  const normalized = canonicalLoginUrl(url);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    const target = `${parsed.pathname} ${parsed.search} ${parsed.hash}`.toLowerCase();
    return /(login|logon|signin|sign-in|auth|authenticate|account\/login|user\/login|member\/login|session)/.test(target);
  } catch {
    return false;
  }
}

async function syncCredentialLoginUrl(cred, nextUrl) {
  const loginUrl = canonicalLoginUrl(nextUrl);
  if (!loginUrl || canonicalLoginUrl(cred.loginUrl) === loginUrl) return false;

  const res = await chrome.runtime.sendMessage({
    type: 'SAVE_CREDENTIAL',
    payload: {
      domain: cred.domain,
      username: cred.username,
      password: cred.password,
      loginUrl,
    },
  });
  if (res?.error) throw new Error(res.error);

  await setLoginUrlOverride(cred.id, loginUrl);
  cred.loginUrl = loginUrl;
  allCredentials = allCredentials.map(entry =>
    entry.id === cred.id ? { ...entry, loginUrl } : entry
  );
  return true;
}

async function pageLooksLikeLoginPage(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const passwordField = document.querySelector(
          'input[type="password"], input[autocomplete="current-password"], input[name*="password" i], input[id*="password" i]'
        );
        const userField = document.querySelector(
          'input[type="email"], input[autocomplete="username"], input[autocomplete="email"], input[name*="user" i], input[name*="login" i], input[id*="user" i], input[id*="login" i], input[type="text"]'
        );
        const submitControl = document.querySelector(
          'button[type="submit"], input[type="submit"], button:not([type="button"]):not([type="reset"])'
        );
        const text = `${document.title} ${location.pathname} ${document.body?.innerText?.slice(0, 2000) || ''}`.toLowerCase();
        const loginWords = /(sign[\s-]?in|log[\s-]?in|user id|username|password|remember me)/i.test(text);

        return Boolean(
          passwordField ||
          (userField && submitControl && loginWords) ||
          (submitControl && loginWords)
        );
      },
    });
    return results?.some(r => r.result === true) || false;
  } catch {
    return false;
  }
}

async function syncMatchingCredentialsForPage(tabId) {
  const pageUrl = canonicalLoginUrl(await getCurrentPageUrl());
  if (!pageUrl || !currentDomain) return;
  if (!urlLooksLikeLoginPage(pageUrl) && !(await pageLooksLikeLoginPage(tabId))) return;

  const matches = allCredentials.filter(cred => isCredentialMatch(currentDomain, cred.domain));
  if (!matches.length) return;

  let changed = false;
  for (const cred of matches) {
    const previous = canonicalLoginUrl(cred.loginUrl);
    if (previous === pageUrl) continue;
    try {
      changed = await syncCredentialLoginUrl(cred, pageUrl) || changed;
    } catch (err) {
      console.warn('[SenKey] failed to sync matching credential login URL', err);
    }
  }

  if (changed) {
    renderCredentials();
    showToast('Updated saved login URL', 'ok');
  }
}

// ---- Load credentials from server ----
async function loadCredentials() {
  const list = document.getElementById('credList');
  list.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div>Fetching from server…</div>';

  try {
    const res = await chrome.runtime.sendMessage({ type: 'FETCH_CREDENTIALS' });
    if (res.error) throw new Error(res.error);
    const overrides = await getLoginUrlOverrides();
    allCredentials = (res.credentials || []).map(cred =>
      overrides[cred.id] ? { ...cred, loginUrl: overrides[cred.id] } : cred
    );
    updateUsernameSuggestions();
    renderCredentials();
  } catch (err) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div>${err.message}</div>`;
    updateUsernameSuggestions();
  }
}

// ---- Render credential cards ----
function renderCredentials() {
  const list = document.getElementById('credList');
  if (!allCredentials.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">🔒</div>No credentials saved yet.<br>Use the <strong>Add</strong> tab to add one.</div>';
    return;
  }

  const sorted = [...allCredentials].sort((a, b) => {
    const aMatch = isCredentialMatch(currentDomain, a.domain);
    const bMatch = isCredentialMatch(currentDomain, b.domain);
    return (bMatch ? 1 : 0) - (aMatch ? 1 : 0);
  });

  list.innerHTML = '';
  sorted.forEach(cred => {
    const isMatch = isCredentialMatch(currentDomain, cred.domain);
    const initials = (cred.domain[0] || '?').toUpperCase();
    const faviconUrl = getFaviconUrl(cred);

    const card = document.createElement('div');
    card.className = 'cred-card' + (isMatch ? ' match' : '');
    card.innerHTML = `
      <div class="cred-avatar">
        <img src="${escHtml(faviconUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <span class="cred-avatar-fallback">${initials}</span>
      </div>
      <div class="cred-info">
        <div class="cred-domain">${escHtml(cred.domain)}</div>
<!--        <div class="cred-user">${escHtml(cred.username)}</div>-->
      </div>
      <div class="cred-actions">
        <button class="btn-icon fill" title="Autofill this page">▶</button>
        <button class="btn-icon edit" title="Update username/password">✎</button>
        <button class="btn-icon del"  title="Delete">✕</button>
      </div>`;

    const avatarImg = card.querySelector('.cred-avatar img');
    const avatarFallback = card.querySelector('.cred-avatar-fallback');
    if (!faviconUrl) {
      avatarImg?.remove();
      if (avatarFallback) avatarFallback.style.display = 'flex';
    } else if (avatarImg && avatarFallback) {
      avatarImg.addEventListener('error', () => {
        avatarImg.style.display = 'none';
        avatarFallback.style.display = 'flex';
      }, { once: true });
    }

    card.querySelector('.fill').addEventListener('click', e => {
      e.stopPropagation();
      autofillPage(cred);
    });
    card.querySelector('.edit').addEventListener('click', e => {
      e.stopPropagation();
      startEditingCredential(cred);
    });
    card.querySelector('.del').addEventListener('click', e => {
      e.stopPropagation();
      deleteCredential(cred.id);
    });
    card.addEventListener('click', () => autofillPage(cred));

    list.appendChild(card);
  });
}

// ---- Autofill ----
async function autofillPage(cred) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return showToast('No active tab', 'err');
  const currentUrl = canonicalLoginUrl(tab.url || '');

  const tabDomain = (() => {
    try { return new URL(tab.url || '').hostname; } catch { return ''; }
  })();
  if (!isCredentialMatch(tabDomain, cred.domain)) {
    const url = getCredentialUrl(cred);
    if (!url) return showToast('Saved domain is invalid', 'err');
    const res = await chrome.runtime.sendMessage({
      type: 'NAVIGATE_AND_AUTOFILL',
      tabId: tab.id,
      url,
      username: cred.username,
      password: cred.password,
    });
    if (res?.error) throw new Error(res.error);
    showToast(`Opening and filling ${normalizeDomain(url)}`, 'ok');
    setTimeout(() => window.close(), 400);
    return;
  }

  const onLoginPage = await pageLooksLikeLoginPage(tab.id);
  const loginLikeUrl = urlLooksLikeLoginPage(currentUrl);
  if (!onLoginPage) {
    const url = getCredentialUrl(cred);
    if (url && canonicalLoginUrl(url) !== currentUrl) {
      const res = await chrome.runtime.sendMessage({
        type: 'NAVIGATE_AND_AUTOFILL',
        tabId: tab.id,
        url,
        username: cred.username,
        password: cred.password,
      });
      if (res?.error) throw new Error(res.error);
      showToast(`Opening and filling ${normalizeDomain(url)}`, 'ok');
      setTimeout(() => window.close(), 400);
      return;
    }
  }

  if (onLoginPage || loginLikeUrl) {
    try {
      await syncCredentialLoginUrl(cred, currentUrl);
    } catch (err) {
      console.warn('[SenKey] failed to sync login URL before fill', err);
    }
  }

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: async (username, password) => {
        const userSelectors = [
          'input[type="email"]',
          'input[autocomplete="username"]',
          'input[autocomplete="email"]',
          'input[name*="account" i]',
          'input[name*="user" i]',
          'input[name*="email" i]',
          'input[name*="login" i]',
          'input[id*="user" i]',
          'input[id*="email" i]',
          'input[id*="login" i]',
          'input[id*="account" i]',
          'input[placeholder*="email" i]',
          'input[placeholder*="user" i]',
          'input[placeholder*="account" i]',
          'input[placeholder*="login" i]',
          'input[type="tel"]:not([readonly]):not([disabled])',
          'input[type="text"]:not([readonly]):not([disabled])',
        ];
        const passSelectors = [
          'input[type="password"]',
          'input[autocomplete="current-password"]',
          'input[name*="password" i]',
          'input[id*="password" i]',
          'input[placeholder*="password" i]',
        ];

        // Access shadow roots whether open or closed.
        // Only probe closed roots on custom elements (tag name contains "-") to avoid
        // calling the extension API on thousands of built-in elements.
        function getShadowRoot(el) {
          if (el.shadowRoot) return el.shadowRoot;
          if (el.tagName?.includes('-')) {
            try { return chrome.dom.openOrClosedShadowRoot(el); } catch { return null; }
          }
          return null;
        }

        // Search standard DOM and recursively through shadow roots
        function queryDeep(root, selectors) {
          for (const sel of selectors) {
            const el = root.querySelector(sel);
            if (el) return el;
          }
          for (const el of root.querySelectorAll('*')) {
            const shadow = getShadowRoot(el);
            if (shadow) {
              const found = queryDeep(shadow, selectors);
              if (found) return found;
            }
          }
          return null;
        }

        function queryAllDeep(root, selectors, out = []) {
          for (const sel of selectors) {
            out.push(...root.querySelectorAll(sel));
          }
          for (const el of root.querySelectorAll('*')) {
            const shadow = getShadowRoot(el);
            if (shadow) queryAllDeep(shadow, selectors, out);
          }
          return out.filter((el, i, arr) => arr.indexOf(el) === i);
        }

        function isVisible(el) {
          const s = window.getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden') return false;
          // offsetParent is null for elements inside shadow DOM even when visible,
          // so use getBoundingClientRect which works correctly across shadow boundaries.
          const r = el.getBoundingClientRect();
          return r.width > 0 || r.height > 0;
        }

        // Prefer the form with exactly one password field — that's the sign-in form.
        // Register forms always have two (password + confirm).
        function findSignInForm() {
          const allPass = queryAllDeep(document, passSelectors);
          if (!allPass.length) return { passField: null, formRoot: document };

          const visiblePass = allPass.filter(isVisible);
          const candidates = visiblePass.length ? visiblePass : allPass;
          const byForm = new Map();
          const orphans = [];
          for (const f of candidates) {
            const form = f.closest('form');
            form ? (byForm.get(form) || byForm.set(form, []) && byForm.get(form)).push(f)
                 : orphans.push(f);
          }

          // Form with exactly 1 password field wins
          for (const [form, fields] of byForm) {
            if (fields.length === 1) return { passField: fields[0], formRoot: form };
          }
          // Fallback: first form found
          if (byForm.size) {
            const [form, fields] = [...byForm][0];
            return { passField: fields[0], formRoot: form };
          }
          return { passField: orphans[0] || null, formRoot: document };
        }

        let { passField, formRoot } = findSignInForm();
        let userField = queryDeep(formRoot, userSelectors);

        // If nothing found yet, the form may still be loading — wait up to 3s.
        if (!userField && !passField) {
          for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 200));
            ({ passField, formRoot } = findSignInForm());
            userField = queryDeep(formRoot, userSelectors);
            if (userField || passField) break;
          }
        }

        if (!userField && !passField) {
          const total = document.querySelectorAll('input').length;
          const url = location.href.replace(/^https?:\/\//, '').substring(0, 60);
          return { success: false, debug: `0 fields (${total} inputs) @ ${url}` };
        }

        function execFill(el, value) {
          el.focus();
          el.select?.();
          document.execCommand('insertText', false, value);
          if (el.value === value) return; // execCommand worked — done

          // execCommand was a no-op (common for type="password").
          // Set value via native setter on the inner element.
          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(el, value);

          // Shadow DOM event retargeting: when a composed event crosses a shadow boundary,
          // event.target becomes the shadow host — so Angular reads host.value, not el.value.
          // Fix: dispatch from the host and set host.value so Angular sees the right value.
          const host = el.getRootNode?.()?.host;
          if (host) {
            try { host.value = value; } catch {}
            host.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
            host.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: value }));
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          }
        }

        if (userField) execFill(userField, username);
        await new Promise(r => setTimeout(r, 120)); // let validators settle

        // Some sites render only the username step first, then reveal or inject the
        // password field after a continue action. Advance and then re-query for a
        // fresh password field reference because the DOM may be replaced entirely.
        if (!passField || !isVisible(passField)) {
          const submitBtn = (formRoot !== document ? formRoot : document).querySelector(
            'button[type="submit"], input[type="submit"], button:not([type="button"]):not([type="reset"])'
          );
          if (submitBtn) submitBtn.click();
          for (let i = 0; i < 25; i++) {
            await new Promise(r => setTimeout(r, 200));
            // Re-query each iteration — the SPA may replace the DOM element entirely.
            const fresh = findSignInForm().passField || queryDeep(document, ['input[type="password"]']);
            if (fresh && isVisible(fresh)) { passField = fresh; break; }
          }
        }

        if (passField && isVisible(passField)) {
          const passHost = passField.getRootNode?.()?.host;
          const origType = passField.getAttribute('type') || 'password';
          let filled = false;

          // Strategy 1: Angular Ivy API — directly update the component/directive
          // that owns the form control, bypassing DOM event handling entirely.
          if (!filled && passHost) {
            try {
              const ng = window.ng;
              if (ng) {
                const dirs = ng.getDirectives?.(passHost) || [];
                for (const d of dirs) {
                  if (typeof d.writeValue === 'function') { d.writeValue(password); filled = true; break; }
                }
                if (!filled) {
                  const comp = ng.getComponent?.(passHost);
                  if (comp) {
                    if (typeof comp.writeValue === 'function') { comp.writeValue(password); filled = true; }
                    else if (comp.value !== undefined) { comp.value = password; filled = true; }
                  }
                }
                if (filled) ng.applyChanges?.(passHost);
              }
            } catch {}
          }

          // Strategy 2: set value on shadow host's value property + dispatch from host.
          if (!filled && passHost) {
            try {
              passHost.value = password;
              passHost.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: password }));
              passHost.dispatchEvent(new Event('change', { bubbles: true }));
            } catch {}
          }

          // Strategy 3: temporarily change type to "text" so execCommand fires the
          // real input pipeline (execCommand is a no-op on type="password").
          if (!filled) {
            passField.setAttribute('type', 'text');
            execFill(passField, password);
            passField.setAttribute('type', origType);
            // Belt-and-suspenders: re-fire events after restoring type, in case
            // the type switch caused Angular to discard the execCommand event.
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            if (passField.value !== password) nativeSetter.call(passField, password);
            passField.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: password }));
            passField.dispatchEvent(new Event('change', { bubbles: true }));
          }

          // Wait for Angular's change-detection zone to settle fully.
          await new Promise(r => setTimeout(r, 500));
          filled = passField.value === password;

          console.log('[SenKey]', JSON.stringify({
            filled, origType,
            passVal: passField.value.substring(0, 3),
            host: passHost?.tagName,
            ng: !!window.ng,
          }));

          if (!filled) {
            return { success: false, debug: `pass blank after all strategies (host=${passHost?.tagName ?? 'none'}, ng=${!!window.ng})` };
          }
        } else if (userField) {
          return { success: false, debug: 'password field did not become visible after username step' };
        }

        // Do NOT blur — some Angular forms reset on blur before submitting.
        return { success: true };
      },
      args: [cred.username, cred.password],
    });
  } catch {
    return showToast('Cannot fill on this page', 'err');
  }

  if (results?.some(r => r.result?.success)) {
    showToast('✓ Filled!', 'ok');
    setTimeout(() => window.close(), 800);
  } else {
    const frames = results?.length ?? 0;
    const debugMsgs = results?.map(r => r.result?.debug).filter(Boolean) ?? [];
    const detail = debugMsgs.length ? debugMsgs.join(' | ') : `${frames} frame(s) checked`;
    showToast(`No fields found — ${detail}`, 'err');
  }
}

// ---- Save credential ----
document.getElementById('saveBtn').addEventListener('click', async () => {
  const domain   = document.getElementById('addDomain').value.trim();
  const username = document.getElementById('addUsername').value.trim();
  const password = document.getElementById('addPassword').value.trim();
  const loginUrl = document.getElementById('addLoginUrl').value.trim();

  if (!domain || !username || !password) {
    return showToast('All fields are required', 'err');
  }
  if (loginUrl) {
    try { new URL(loginUrl); } catch { return showToast('Login URL is invalid', 'err'); }
  }

  const btn = document.getElementById('saveBtn');
  const cancelBtn = document.getElementById('cancelEditBtn');
  btn.disabled = true;
  cancelBtn.disabled = true;
  btn.textContent = editingCredential ? 'Updating…' : 'Saving…';

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'SAVE_CREDENTIAL',
      payload: { domain, username, password, loginUrl },
    });
    if (res.error) throw new Error(res.error);
    if (loginUrl && res.id) await setLoginUrlOverride(res.id, canonicalLoginUrl(loginUrl));
    if (!loginUrl && res.id) await removeLoginUrlOverride(res.id);
    if (editingCredential && editingCredential.id && editingCredential.id !== res.id) {
      const delRes = await chrome.runtime.sendMessage({ type: 'DELETE_CREDENTIAL', id: editingCredential.id });
      if (delRes?.error) throw new Error(delRes.error);
      await removeLoginUrlOverride(editingCredential.id);
    }
    showToast(editingCredential ? '✓ Credential updated' : '✓ Saved to server', 'ok');
    resetCredentialForm();
    await loadCredentials();
    document.querySelector('[data-tab="autofill"]').click();
  } catch (err) {
    showToast(err.message, 'err');
  } finally {
    btn.disabled = false;
    cancelBtn.disabled = false;
    btn.textContent = editingCredential ? 'Update Credential' : 'Save to Server';
  }
});

document.getElementById('cancelEditBtn').addEventListener('click', () => {
  resetCredentialForm();
  prefillDomain();
});

// ---- Delete credential ----
async function deleteCredential(id) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'DELETE_CREDENTIAL', id });
    if (res.error) throw new Error(res.error);
    await removeLoginUrlOverride(id);
    showToast('Deleted', 'ok');
    await loadCredentials();
  } catch (err) {
    showToast(err.message, 'err');
  }
}

// ---- Google auth state ----
async function loadAuthState() {
  const { googleUser } = await chrome.storage.local.get('googleUser');
  if (googleUser) {
    document.getElementById('signedOut').style.display = 'none';
    document.getElementById('signedIn').style.display  = 'block';
    document.getElementById('userName').textContent    = googleUser.name  || '';
    document.getElementById('userEmail').textContent   = googleUser.email || '';
    document.getElementById('userInitial').textContent = (googleUser.name || googleUser.email || '?')[0].toUpperCase();
  } else {
    document.getElementById('signedOut').style.display = 'block';
    document.getElementById('signedIn').style.display  = 'none';
  }
}

document.getElementById('signInBtn').addEventListener('click', async () => {
  const btn = document.getElementById('signInBtn');
  btn.disabled = true;
  btn.querySelector('svg').nextSibling.textContent = ' Signing in…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GOOGLE_SIGN_IN' });
    if (res.error) throw new Error(res.error);
    showToast('✓ Signed in as ' + res.email, 'ok');
    await loadAuthState();
    await loadCredentials();
  } catch (err) {
    showToast(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.querySelector('svg').nextSibling.textContent = ' Sign in with Google';
  }
});

document.getElementById('signOutBtn').addEventListener('click', async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GOOGLE_SIGN_OUT' });
    if (res.error) throw new Error(res.error);
    showToast('Signed out', 'ok');
    await loadAuthState();
    allCredentials = [];
    updateUsernameSuggestions();
    renderCredentials();
  } catch (err) {
    showToast(err.message, 'err');
  }
});

// ---- Key export / import ----
document.getElementById('exportKeyBtn').addEventListener('click', async () => {
  const { publicKey, privateKey } = await chrome.storage.local.get(['publicKey', 'privateKey']);
  if (!publicKey || !privateKey) return showToast('No keys yet — save a credential first', 'err');
  const blob = new Blob(
    [JSON.stringify({ senkey: true, publicKey, privateKey }, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'senkey-keys.json'; a.click();
  URL.revokeObjectURL(url);
  showToast('Keys exported', 'ok');
});

document.getElementById('importKeyFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.senkey || !data.publicKey || !data.privateKey) throw new Error('Invalid key file');
    await chrome.storage.local.set({ publicKey: data.publicKey, privateKey: data.privateKey });
    await chrome.runtime.sendMessage({ type: 'RESET_KEYS' });
    showToast('✓ Keys imported', 'ok');
    await loadCredentials();
  } catch (err) {
    showToast(err.message || 'Invalid key file', 'err');
  }
  e.target.value = '';
});

// ---- Settings ----
async function loadSettings() {
  const { serverUrl, apiKey } = await chrome.storage.local.get(['serverUrl', 'apiKey']);
  document.getElementById('serverUrl').value = serverUrl || '';
  document.getElementById('apiKey').value    = apiKey    || '';
  await loadAuthState();
}

document.getElementById('saveSettings').addEventListener('click', async () => {
  const serverUrl = document.getElementById('serverUrl').value.trim();
  const apiKey    = document.getElementById('apiKey').value.trim();
  if (!serverUrl) return showToast('API URL is required', 'err');

  try { new URL(serverUrl); } catch { return showToast('Invalid server URL', 'err'); }

  await chrome.storage.local.set({ serverUrl, apiKey });
  showToast('✓ Settings saved', 'ok');
  await loadCredentials();
});

document.getElementById('openHelpBtn').addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('manual.html?reason=help') });
  window.close();
});

// ---- Pre-fill domain in Add tab from current page ----
async function prefillDomain() {
  if (editingCredential) return;
  const dom = document.getElementById('addDomain');
  const loginUrl = document.getElementById('addLoginUrl');
  if (!dom.value && currentDomain) dom.value = currentDomain;
  if (!loginUrl.value) {
    const url = await getCurrentPageUrl();
    if (/^https?:\/\//i.test(url)) loginUrl.value = url;
  }
}
document.querySelector('[data-tab="add"]').addEventListener('click', prefillDomain);

// ---- Escape HTML ----
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---- Init ----
(async () => {
  document.getElementById('versionBadge').textContent = 'v' + chrome.runtime.getManifest().version;
  await loadSettings();
  currentDomain = await getCurrentDomain();
  document.getElementById('currentDomain').textContent = currentDomain || 'unknown site';
  await loadCredentials();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await syncMatchingCredentialsForPage(tab?.id);
})();
