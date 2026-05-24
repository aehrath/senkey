// background.js – service worker for SenKey extension

try {
  importScripts('oauth_config.js');
} catch {
  self.SENKEY_WEB_GOOGLE_OAUTH_CLIENT_ID = '';
}

const pendingAutofills = new Map();

chrome.runtime.onInstalled.addListener(details => {
  if (!details?.reason) return;
  if (details.reason !== 'install' && details.reason !== 'update') return;
  const url = chrome.runtime.getURL(`manual.html?reason=${encodeURIComponent(details.reason)}`);
  chrome.tabs.create({ url });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FETCH_CREDENTIALS') {
    handleFetch().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'SAVE_CREDENTIAL') {
    handleSave(msg.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'DELETE_CREDENTIAL') {
    handleDelete(msg.id).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'FETCH_LOGINPAGES' || msg.type === 'FETCH_BOOKMARKS') {
    handleFetchLoginPages().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'SAVE_LOGINPAGES' || msg.type === 'SAVE_BOOKMARKS') {
    handleSaveLoginPages(msg.payload).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'RESET_KEYS') {
    _keyPair = null;
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === 'GOOGLE_SIGN_IN') {
    googleSignIn().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GOOGLE_AUTH_DIAGNOSTICS') {
    sendResponse(getGoogleAuthDiagnostics());
    return true;
  }
  if (msg.type === 'GOOGLE_SIGN_OUT') {
    googleSignOut().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'NAVIGATE_AND_AUTOFILL') {
    scheduleNavigateAndAutofill(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  pendingAutofills.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const pending = pendingAutofills.get(tabId);
  if (!pending) return;
  void maybeRunPendingAutofill(tabId, tab?.url || '');
});

// ---- Crypto helpers ----

let _keyPair = null;

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}

async function getOrCreateKeyPair() {
  if (_keyPair) return _keyPair;

  const stored = await new Promise(resolve =>
    chrome.storage.local.get(['publicKey', 'privateKey'], resolve)
  );

  if (stored.publicKey && stored.privateKey) {
    const publicKey = await crypto.subtle.importKey(
      'spki', base64ToBuffer(stored.publicKey),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false, ['encrypt']
    );
    const privateKey = await crypto.subtle.importKey(
      'pkcs8', base64ToBuffer(stored.privateKey),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false, ['decrypt']
    );
    _keyPair = { publicKey, privateKey };
  } else {
    _keyPair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']
    );
    const pub  = await crypto.subtle.exportKey('spki',  _keyPair.publicKey);
    const priv = await crypto.subtle.exportKey('pkcs8', _keyPair.privateKey);
    await new Promise(resolve => chrome.storage.local.set({
      publicKey:  bufferToBase64(pub),
      privateKey: bufferToBase64(priv),
    }, resolve));
  }

  return _keyPair;
}

async function encryptPassword(password) {
  const { publicKey } = await getOrCreateKeyPair();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    publicKey,
    new TextEncoder().encode(password)
  );
  return bufferToBase64(encrypted);
}

async function decryptPassword(value) {
  try {
    const { privateKey } = await getOrCreateKeyPair();
    const decrypted = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      base64ToBuffer(value)
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return value; // plaintext fallback for credentials saved before encryption
  }
}

// ---- Config / auth ----

async function getConfig() {
  return new Promise(resolve => chrome.storage.local.get(['serverUrl', 'apiKey'], resolve));
}

async function getGoogleToken() {
  const { googleAccessToken, googleAccessTokenExpiresAt } =
    await chrome.storage.local.get(['googleAccessToken', 'googleAccessTokenExpiresAt']);
  if (googleAccessToken && googleAccessTokenExpiresAt && Date.now() < googleAccessTokenExpiresAt - 60000) {
    return googleAccessToken;
  }

  const token = await new Promise(resolve => {
    chrome.identity.getAuthToken({ interactive: false }, token => {
      resolve(chrome.runtime.lastError ? null : token);
    });
  });
  if (token) return token;

  await chrome.storage.local.remove(['googleAccessToken', 'googleAccessTokenExpiresAt']);
  return null;
}

function getGoogleAuthErrorMessage(message) {
  const diagnostics = getGoogleAuthDiagnostics();
  return [
    message || 'Google sign-in failed.',
    `Extension ID: ${diagnostics.extensionId}`,
    `OAuth client: ${diagnostics.oauthClientId}`,
    `Redirect URI: ${diagnostics.redirectUri}`,
    `Web OAuth client: ${diagnostics.webOAuthClientId}`,
    'In Brave, open brave://settings/extensions, enable "Allow Google login for extensions", sign into Google in a normal Brave tab, reload SenKey, and try again.',
    'For Brave fallback, create a Google OAuth Web application client and set WEB_GOOGLE_OAUTH_CLIENT_ID in .env.',
    'For unpacked builds, load the dist/ folder created by ./build.sh so the extension ID matches the Google OAuth client.',
  ].filter(Boolean).join(' | ');
}

function getGoogleAuthDiagnostics() {
  const manifest = chrome.runtime.getManifest();
  const webOAuthClientId = self.SENKEY_WEB_GOOGLE_OAUTH_CLIENT_ID || '';
  return {
    extensionId: chrome.runtime.id,
    oauthClientId: manifest.oauth2?.client_id || 'missing',
    webOAuthClientId: webOAuthClientId || 'not configured',
    redirectUri: chrome.identity.getRedirectURL('oauth2'),
    webAuthFlow: 'enabled',
    extensionName: manifest.name,
    version: manifest.version,
  };
}

function randomState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function isGoogleAuthUrl(value) {
  try {
    const url = new URL(value || '');
    return url.hostname === 'accounts.google.com' &&
      (/\/o\/oauth2\//.test(url.pathname) || /\/signin\/oauth/.test(url.pathname));
  } catch {
    return false;
  }
}

async function getGoogleAuthTabIds() {
  return new Promise(resolve => {
    chrome.tabs.query({ url: 'https://accounts.google.com/*' }, tabs => {
      if (chrome.runtime.lastError) {
        resolve(new Set());
        return;
      }
      resolve(new Set((tabs || []).filter(tab => isGoogleAuthUrl(tab.url)).map(tab => tab.id)));
    });
  });
}

async function closeNewGoogleAuthTabs(previousTabIds) {
  return new Promise(resolve => {
    chrome.tabs.query({ url: 'https://accounts.google.com/*' }, tabs => {
      if (chrome.runtime.lastError) {
        resolve();
        return;
      }
      const tabIds = (tabs || [])
        .filter(tab => tab.id && !previousTabIds.has(tab.id) && isGoogleAuthUrl(tab.url))
        .map(tab => tab.id);
      if (!tabIds.length) {
        resolve();
        return;
      }
      chrome.tabs.remove(tabIds, () => resolve());
    });
  });
}

async function getTokenWithChromeIdentity(interactive) {
  const existingGoogleAuthTabIds = interactive ? await getGoogleAuthTabIds() : new Set();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void closeNewGoogleAuthTabs(existingGoogleAuthTabIds);
      reject(new Error('Chrome identity sign-in did not finish.'));
    }, interactive ? 2000 : 1000);

    chrome.identity.getAuthToken({ interactive }, token => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(token);
    });
  });
}

async function getTokenWithWebAuthFlow() {
  const manifest = chrome.runtime.getManifest();
  const webOAuthClientId = self.SENKEY_WEB_GOOGLE_OAUTH_CLIENT_ID || '';
  if (!webOAuthClientId) {
    throw new Error('Brave web auth fallback is missing WEB_GOOGLE_OAUTH_CLIENT_ID.');
  }

  const redirectUri = chrome.identity.getRedirectURL('oauth2');
  const state = randomState();
  const authParams = new URLSearchParams({
    client_id: webOAuthClientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: (manifest.oauth2?.scopes || []).join(' '),
    state,
    prompt: 'select_account',
  });

  const finalUrl = await chrome.identity.launchWebAuthFlow({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`,
    interactive: true,
  });
  if (!finalUrl) throw new Error('Google sign-in was cancelled.');

  const parsed = new URL(finalUrl);
  const params = new URLSearchParams(parsed.hash ? parsed.hash.slice(1) : parsed.search.slice(1));
  if (params.get('state') !== state) throw new Error('Google sign-in state mismatch.');
  if (params.get('error')) {
    throw new Error(params.get('error_description') || params.get('error') || 'Google sign-in failed.');
  }

  const token = params.get('access_token');
  if (!token) throw new Error('Google did not return an access token.');
  const expiresIn = Number(params.get('expires_in') || 3600);
  await chrome.storage.local.set({
    googleAccessToken: token,
    googleAccessTokenExpiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
  });
  return token;
}

async function makeHeaders(includeContentType = false) {
  const { apiKey } = await getConfig();
  const token = await getGoogleToken();
  if (!token) throw new Error('Sign In With Google first (open the Settings tab)');
  const headers = {
    'X-API-Key': apiKey || '',
    'Authorization': `Bearer ${token}`,
  };
  if (includeContentType) headers['Content-Type'] = 'application/json';
  return headers;
}

// ---- API handlers ----

async function handleFetch() {
  const { serverUrl } = await getConfig();
  if (!serverUrl) throw new Error('Server URL not configured. Open Settings.');
  const res = await fetch(serverUrl, { headers: await makeHeaders() });
  if (!res.ok) throw new Error(await getServerErrorMessage(res));
  const data = await res.json();
  const credentials = await Promise.all(
    (data.credentials || []).map(async cred => ({
      ...cred,
      password: await decryptPassword(cred.password),
    }))
  );
  return { credentials };
}

async function handleSave(payload) {
  const { serverUrl } = await getConfig();
  if (!serverUrl) throw new Error('Server URL not configured.');
  const encrypted = { ...payload, password: await encryptPassword(payload.password) };
  const res = await fetch(serverUrl, {
    method: 'POST',
    headers: await makeHeaders(true),
    body: JSON.stringify(encrypted),
  });
  if (!res.ok) throw new Error(await getServerErrorMessage(res));
  return res.json();
}

async function getServerErrorMessage(res) {
  let detail = '';
  try {
    const data = await res.clone().json();
    detail = data?.error || data?.message || '';
  } catch {
    try {
      detail = (await res.clone().text()).trim();
    } catch {}
  }
  return detail ? `Server error ${res.status}: ${detail}` : `Server error ${res.status}`;
}

function withResource(url, resource) {
  const next = new URL(url);
  next.searchParams.set('resource', resource);
  return next.toString();
}

async function handleFetchLoginPages() {
  const { serverUrl } = await getConfig();
  if (!serverUrl) throw new Error('Server URL not configured. Open Settings.');
  const res = await fetch(withResource(serverUrl, 'loginpages'), { headers: await makeHeaders() });
  if (!res.ok) throw new Error(await getServerErrorMessage(res));
  return res.json();
}

async function handleSaveLoginPages(payload) {
  const { serverUrl } = await getConfig();
  if (!serverUrl) throw new Error('Server URL not configured.');
  const res = await fetch(withResource(serverUrl, 'loginpages'), {
    method: 'POST',
    headers: await makeHeaders(true),
    body: JSON.stringify({ roots: payload?.roots || [] }),
  });
  if (!res.ok) throw new Error(await getServerErrorMessage(res));
  return res.json();
}

async function handleDelete(id) {
  const { serverUrl } = await getConfig();
  if (!serverUrl) throw new Error('Server URL not configured.');
  const res = await fetch(serverUrl, {
    method: 'DELETE',
    headers: await makeHeaders(true),
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(await getServerErrorMessage(res));
  return res.json();
}

async function googleSignIn() {
  let token;
  let identityError = null;
  try {
    token = await getTokenWithChromeIdentity(true);
  } catch (err) {
    identityError = err;
    token = await getTokenWithWebAuthFlow().catch(webErr => {
      throw new Error(getGoogleAuthErrorMessage(`${identityError.message} | Web auth flow: ${webErr.message}`));
    });
  }

  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch user info from Google');
  const info = await res.json();
  await chrome.storage.local.set({
    googleUser: { email: info.email, name: info.name, picture: info.picture },
  });
  return { email: info.email, name: info.name };
}

async function googleSignOut() {
  const token = await getGoogleToken();
  if (token) {
    await new Promise(resolve => chrome.identity.removeCachedAuthToken({ token }, resolve));
  }
  await new Promise(resolve => chrome.identity.clearAllCachedAuthTokens(resolve));
  await chrome.storage.local.remove(['googleUser', 'googleAccessToken', 'googleAccessTokenExpiresAt']);
  return { success: true };
}

function normalizeHost(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isWebUrl(value) {
  return /^https?:\/\//i.test(value || '');
}

async function scheduleNavigateAndAutofill({ tabId, url, username, password }) {
  if (!tabId || !url || !username || !password) {
    throw new Error('tabId, url, username, and password are required');
  }

  pendingAutofills.set(tabId, {
    username,
    password,
    attempts: 0,
  });

  await chrome.tabs.update(tabId, { url });
  return { success: true };
}

async function maybeRunPendingAutofill(tabId, currentUrl) {
  const pending = pendingAutofills.get(tabId);
  if (!pending) return;
  if (!isWebUrl(currentUrl)) return;

  pending.attempts += 1;
  const result = await executeAutofillScript(tabId, pending.username, pending.password);
  if (result.success || pending.attempts >= 5) {
    pendingAutofills.delete(tabId);
  } else {
    pendingAutofills.set(tabId, pending);
    setTimeout(() => {
      void maybeRunPendingAutofill(tabId, currentUrl);
    }, 1200);
  }
}

async function executeAutofillScript(tabId, username, password) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: async (usernameArg, passwordArg) => {
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

        function getShadowRoot(el) {
          if (el.shadowRoot) return el.shadowRoot;
          if (el.tagName?.includes('-')) {
            try { return chrome.dom.openOrClosedShadowRoot(el); } catch { return null; }
          }
          return null;
        }

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
          for (const sel of selectors) out.push(...root.querySelectorAll(sel));
          for (const el of root.querySelectorAll('*')) {
            const shadow = getShadowRoot(el);
            if (shadow) queryAllDeep(shadow, selectors, out);
          }
          return out.filter((el, i, arr) => arr.indexOf(el) === i);
        }

        function isVisible(el) {
          const s = window.getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden') return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 || r.height > 0;
        }

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

          for (const [form, fields] of byForm) {
            if (fields.length === 1) return { passField: fields[0], formRoot: form };
          }
          if (byForm.size) {
            const [form, fields] = [...byForm][0];
            return { passField: fields[0], formRoot: form };
          }
          return { passField: orphans[0] || null, formRoot: document };
        }

        let { passField, formRoot } = findSignInForm();
        let userField = queryDeep(formRoot, userSelectors);

        if (!userField && !passField) {
          for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 200));
            ({ passField, formRoot } = findSignInForm());
            userField = queryDeep(formRoot, userSelectors);
            if (userField || passField) break;
          }
        }

        if (!userField && !passField) return { success: false };

        function execFill(el, value) {
          el.focus();
          el.select?.();
          document.execCommand('insertText', false, value);
          if (el.value === value) return;

          const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(el, value);

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

        if (userField) execFill(userField, usernameArg);
        await new Promise(r => setTimeout(r, 120));

        if (!passField || !isVisible(passField)) {
          const submitBtn = (formRoot !== document ? formRoot : document).querySelector(
            'button[type="submit"], input[type="submit"], button:not([type="button"]):not([type="reset"])'
          );
          if (submitBtn) submitBtn.click();
          for (let i = 0; i < 25; i++) {
            await new Promise(r => setTimeout(r, 200));
            const fresh = findSignInForm().passField || queryDeep(document, ['input[type="password"]']);
            if (fresh && isVisible(fresh)) { passField = fresh; break; }
          }
        }

        if (passField && isVisible(passField)) {
          const passHost = passField.getRootNode?.()?.host;
          const origType = passField.getAttribute('type') || 'password';
          let filled = false;

          if (!filled && passHost) {
            try {
              const ng = window.ng;
              if (ng) {
                const dirs = ng.getDirectives?.(passHost) || [];
                for (const d of dirs) {
                  if (typeof d.writeValue === 'function') { d.writeValue(passwordArg); filled = true; break; }
                }
                if (!filled) {
                  const comp = ng.getComponent?.(passHost);
                  if (comp) {
                    if (typeof comp.writeValue === 'function') { comp.writeValue(passwordArg); filled = true; }
                    else if (comp.value !== undefined) { comp.value = passwordArg; filled = true; }
                  }
                }
                if (filled) ng.applyChanges?.(passHost);
              }
            } catch {}
          }

          if (!filled && passHost) {
            try {
              passHost.value = passwordArg;
              passHost.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: passwordArg }));
              passHost.dispatchEvent(new Event('change', { bubbles: true }));
            } catch {}
          }

          if (!filled) {
            passField.setAttribute('type', 'text');
            execFill(passField, passwordArg);
            passField.setAttribute('type', origType);
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            if (passField.value !== passwordArg) nativeSetter.call(passField, passwordArg);
            passField.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: passwordArg }));
            passField.dispatchEvent(new Event('change', { bubbles: true }));
          }

          await new Promise(r => setTimeout(r, 500));
          return { success: passField.value === passwordArg };
        }

        return { success: false, debug: 'password field did not become visible after username step' };
      },
      args: [username, password],
    });

    return { success: results?.some(r => r.result?.success) };
  } catch {
    return { success: false };
  }
}
