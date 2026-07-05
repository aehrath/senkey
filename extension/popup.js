// popup.js

let allCredentials = [];
let currentDomain  = '';
let currentPageUrl = '';
let editingCredential = null;
let folderAssignments = {};
const collapsedFolders = new Set();
let activeLoginActionHidden = false;
let activeLoginActionTimer = null;
const SPECIAL_LOGIN_URLS = {
  'auth.digikey.com': 'https://www.digikey.com/MyDigiKey/Login?site=US&lang=en&returnurl=https%3A%2F%2Fwww.digikey.com%2F',
  'www.digikey.com': 'https://www.digikey.com/MyDigiKey/Login?site=US&lang=en&returnurl=https%3A%2F%2Fwww.digikey.com%2F',
  'digikey.com': 'https://www.digikey.com/MyDigiKey/Login?site=US&lang=en&returnurl=https%3A%2F%2Fwww.digikey.com%2F',
};
const PENDING_FOLDER_SYNCS_KEY = 'pendingFolderSyncs';
const ACTIVE_LOGIN_ACTION_MS = 6000;
const LOGIN_PAGES_CLOUD_CHECKED_AT_KEY = 'loginPagesCloudCheckedAt';
const LOGIN_PAGES_CLOUD_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
let credentialsRefreshInFlight = null;
const PASSWORD_SUGGESTION_LENGTH = 20;
const PASSWORD_SUGGESTION_CHARSETS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%^&*()-_=+[]{};:,.?',
];

const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

function populateDatalist(elementId, values) {
  const list = document.getElementById(elementId);
  if (!list) return;
  list.replaceChildren(
    ...[...new Set(values)].filter(Boolean).sort(byName)
      .map(v => Object.assign(document.createElement('option'), { value: v }))
  );
}

function folderPathParts(path) {
  const parts = (path || '').trim().split('/').map(p => p.trim()).filter(Boolean);
  const result = [];
  let cum = '';
  for (const part of parts) {
    cum = cum ? `${cum}/${part}` : part;
    result.push({ part, fullPath: cum });
  }
  return result;
}

function normalizeFolderPath(path) {
  return (path || '').trim().split('/').map(p => p.trim()).filter(Boolean).join('/');
}

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

async function setFolderAssignment(id, folder) {
  if (!id) return;
  const normalized = normalizeFolderPath(folder);
  if (!normalized) delete folderAssignments[id];
  else folderAssignments[id] = normalized;
}

async function getPendingFolderSyncs() {
  const data = await chrome.storage.local.get(PENDING_FOLDER_SYNCS_KEY);
  return data[PENDING_FOLDER_SYNCS_KEY] || {};
}

async function setPendingFolderSync(id, folder) {
  if (!id) return;
  const pending = await getPendingFolderSyncs();
  pending[id] = normalizeFolderPath(folder);
  await chrome.storage.local.set({ [PENDING_FOLDER_SYNCS_KEY]: pending });
}

async function clearPendingFolderSync(id) {
  if (!id) return;
  const pending = await getPendingFolderSyncs();
  if (!(id in pending)) return;
  delete pending[id];
  await chrome.storage.local.set({ [PENDING_FOLDER_SYNCS_KEY]: pending });
}

async function saveCredentialRecord(cred, folder = '') {
  const payload = {
    domain: cred.domain,
    username: cred.username,
    password: cred.password,
    loginUrl: canonicalLoginUrl(cred.loginUrl || ''),
    folder: normalizeFolderPath(folder),
  };
  const res = await chrome.runtime.sendMessage({ type: 'SAVE_CREDENTIAL', payload });
  if (res?.error) throw new Error(res.error);
  return res;
}

async function removeFolderAssignment(id) {
  if (!id) return;
  delete folderAssignments[id];
  await clearPendingFolderSync(id);
}

async function renameFolder(oldPath, nextPath) {
  const from = normalizeFolderPath(oldPath);
  const to = normalizeFolderPath(nextPath);
  if (!from || !to || from === to) return false;
  if (to.startsWith(`${from}/`)) {
    throw new Error('Cannot move a folder inside itself');
  }

  let changed = false;
  for (const [id, path] of Object.entries(folderAssignments)) {
    const current = normalizeFolderPath(path);
    if (current === from || current.startsWith(`${from}/`)) {
      folderAssignments[id] = `${to}${current.slice(from.length)}`;
      changed = true;
    }
  }
  if (!changed) return false;

  const affectedCreds = allCredentials.filter(cred => {
    const current = normalizeFolderPath(folderAssignments[cred.id]);
    return current === to || current.startsWith(`${to}/`);
  });
  for (const cred of affectedCreds) {
    await setPendingFolderSync(cred.id, folderAssignments[cred.id]);
    await saveCredentialRecord(cred, folderAssignments[cred.id]);
  }

  const nextCollapsedFolders = new Set();
  for (const path of collapsedFolders) {
    const current = normalizeFolderPath(path);
    nextCollapsedFolders.add(
      current === from || current.startsWith(`${from}/`)
        ? `${to}${current.slice(from.length)}`
        : current
    );
  }
  collapsedFolders.clear();
  for (const path of nextCollapsedFolders) collapsedFolders.add(path);

  await chrome.storage.local.set({ collapsedFolders: [...collapsedFolders] });
  updateFolderSuggestions();
  renderCredentials();
  return true;
}

function updateFolderSuggestions() {
  const allPaths = new Set();
  for (const path of Object.values(folderAssignments)) {
    for (const { fullPath } of folderPathParts(path)) allPaths.add(fullPath);
  }
  populateDatalist('savedFolders', [...allPaths]);
}

async function removeLoginUrlOverride(id) {
  if (!id) return;
  const loginUrlOverrides = await getLoginUrlOverrides();
  if (!(id in loginUrlOverrides)) return;
  delete loginUrlOverrides[id];
  await chrome.storage.local.set({ loginUrlOverrides });
}

function getSavedCredentialId(saveResponse, domain, username) {
  if (saveResponse?.id) return saveResponse.id;
  if (
    editingCredential?.id &&
    (editingCredential.domain || '').trim() === domain &&
    (editingCredential.username || '').trim() === username
  ) {
    return editingCredential.id;
  }
  return '';
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

function secureRandomIndex(max) {
  const limit = 0x100000000 - (0x100000000 % max);
  const random = new Uint32Array(1);
  do {
    crypto.getRandomValues(random);
  } while (random[0] >= limit);
  return random[0] % max;
}

function randomCharacter(chars) {
  return chars[secureRandomIndex(chars.length)];
}

function shuffleCharacters(chars) {
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = secureRandomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

function suggestSecurePassword(length = PASSWORD_SUGGESTION_LENGTH) {
  const password = PASSWORD_SUGGESTION_CHARSETS.map(randomCharacter);
  const allCharacters = PASSWORD_SUGGESTION_CHARSETS.join('');
  while (password.length < length) {
    password.push(randomCharacter(allCharacters));
  }
  return shuffleCharacters(password).join('');
}

document.getElementById('suggestPass').addEventListener('click', () => {
  const password = document.getElementById('addPassword');
  password.value = suggestSecurePassword();
  password.focus();
  showToast('Secure password suggested', 'ok');
});

// ---- Toast helper ----
function showToast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.className = 'toast', 2500);
}

function closeAfterLoginPlayback() {
  window.close();
}

function showAuthError(message = '') {
  const el = document.getElementById('authError');
  if (!el) return;
  el.textContent = message;
  el.style.display = message ? 'block' : 'none';
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
  document.getElementById('saveBtn').textContent = 'Save To Server';
  document.getElementById('cancelEditBtn').style.display = 'none';
  document.getElementById('addDomain').value = '';
  document.getElementById('addUsername').value = '';
  document.getElementById('addPassword').value = '';
  document.getElementById('addLoginUrl').value = '';
  document.getElementById('addFolder').value = '';
}

function updateUsernameSuggestions() {
  populateDatalist('savedUsernames', allCredentials.map(c => (c.username || '').trim()));
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
  document.getElementById('addFolder').value = folderAssignments[cred.id] || '';
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

function isLoginUrlDowngrade(previousUrl, nextUrl) {
  const previous = canonicalLoginUrl(previousUrl);
  const next = canonicalLoginUrl(nextUrl);
  if (!previous || !next) return false;

  if (urlLooksLikeLoginPage(previous) && !urlLooksLikeLoginPage(next)) return true;

  try {
    const previousParsed = new URL(previous);
    const nextParsed = new URL(next);
    const sameHost = previousParsed.hostname === nextParsed.hostname;
    const previousHasPath = previousParsed.pathname && previousParsed.pathname !== '/';
    const nextIsRoot = (!nextParsed.pathname || nextParsed.pathname === '/') && !nextParsed.search;
    return sameHost && previousHasPath && nextIsRoot;
  } catch {
    return false;
  }
}

async function syncCredentialLoginUrl(cred, nextUrl) {
  const loginUrl = canonicalLoginUrl(nextUrl);
  if (!loginUrl || canonicalLoginUrl(cred.loginUrl) === loginUrl) return false;
  if (isLoginUrlDowngrade(cred.loginUrl, loginUrl)) return false;

  await saveCredentialRecord({ ...cred, loginUrl }, folderAssignments[cred.id] || cred.folder || '');

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
async function loadCredentials({
  preferCache = false,
  refreshAfterCache = false,
  showLoading = true,
  showErrors = true,
} = {}) {
  const list = document.getElementById('credList');
  if (showLoading) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div>Fetching from server…</div>';
  }

  try {
    const res = await chrome.runtime.sendMessage({ type: 'FETCH_CREDENTIALS', preferCache });
    if (res.error) throw new Error(res.error);
    const overrides = await getLoginUrlOverrides();
    const pendingFolderSyncs = await getPendingFolderSyncs();
    const { collapsedFolders: cf } = await chrome.storage.local.get(['collapsedFolders']);
    allCredentials = (res.credentials || []).map(cred => {
      const loginUrl = overrides[cred.id] || cred.loginUrl || '';
      const storedFolder = normalizeFolderPath(cred.folder || '');
      const hasPendingFolder = Object.prototype.hasOwnProperty.call(pendingFolderSyncs, cred.id);
      const pendingFolder = hasPendingFolder ? normalizeFolderPath(pendingFolderSyncs[cred.id]) : '';
      const folder = hasPendingFolder ? pendingFolder : storedFolder;
      if (hasPendingFolder && pendingFolder === storedFolder) {
        void clearPendingFolderSync(cred.id);
      }
      return { ...cred, loginUrl, folder };
    });
    folderAssignments = {};
    for (const cred of allCredentials) {
      if (cred.folder) folderAssignments[cred.id] = cred.folder;
    }
    collapsedFolders.clear();
    for (const p of (cf || [])) collapsedFolders.add(p);
    updateUsernameSuggestions();
    updateFolderSuggestions();
    renderCredentials();
    void retryPendingFolderSyncs();
    if (res.fromCache && refreshAfterCache) void refreshCredentialsFromServer();
  } catch (err) {
    if (showErrors) {
      list.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div>${err.message}</div>`;
    } else {
      console.warn('[SenKey] background credential refresh failed', err);
    }
    updateUsernameSuggestions();
  }
}

function refreshCredentialsFromServer() {
  if (credentialsRefreshInFlight) return credentialsRefreshInFlight;
  credentialsRefreshInFlight = loadCredentials({
    preferCache: false,
    showLoading: false,
    showErrors: false,
  }).finally(() => {
    credentialsRefreshInFlight = null;
  });
  return credentialsRefreshInFlight;
}

async function retryPendingFolderSyncs() {
  const pending = await getPendingFolderSyncs();
  for (const [id, folder] of Object.entries(pending)) {
    const cred = allCredentials.find(entry => entry.id === id);
    if (!cred) {
      await clearPendingFolderSync(id);
      continue;
    }
    try {
      await saveCredentialRecord(cred, folder);
    } catch {}
  }
}

function makeCard(cred) {
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
    </div>
    <div class="cred-actions">
      <button class="btn-icon fill" title="Autofill This Page">▶</button>
      <button class="btn-icon edit" title="Update Username/Password">✎</button>
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
  card.querySelector('.fill').addEventListener('click', e => { e.stopPropagation(); autofillPage(cred); });
  card.querySelector('.edit').addEventListener('click', e => { e.stopPropagation(); startEditingCredential(cred); });
  card.querySelector('.del').addEventListener('click',  e => { e.stopPropagation(); deleteCredential(cred.id); });
  card.addEventListener('click', () => autofillPage(cred));
  return card;
}

function getActiveLoginCredential(creds) {
  if (!currentPageUrl) return null;

  const exact = creds.find(cred => canonicalLoginUrl(cred.loginUrl || '') === currentPageUrl);
  if (exact) return exact;

  if (!urlLooksLikeLoginPage(currentPageUrl)) return null;
  return creds.find(cred => isCredentialMatch(currentDomain, cred.domain)) || null;
}

function makeActiveLoginButton(cred) {
  const button = document.createElement('button');
  button.className = 'active-login-fill';
  button.type = 'button';
  button.title = 'Fill Current Login Page';

  const icon = document.createElement('span');
  icon.className = 'active-login-icon';
  icon.textContent = '▶';

  const label = document.createElement('span');
  label.className = 'active-login-label';
  label.textContent = `Fill ${cred.domain || 'current login page'}`;

  const badge = document.createElement('span');
  badge.className = 'active-login-badge';
  badge.textContent = 'Active';

  button.append(icon, label, badge);
  button.addEventListener('click', () => autofillPage(cred));
  return button;
}

function scheduleActiveLoginActionHide() {
  if (activeLoginActionTimer || activeLoginActionHidden) return;
  activeLoginActionTimer = setTimeout(() => {
    activeLoginActionHidden = true;
    activeLoginActionTimer = null;
    renderCredentials();
  }, ACTIVE_LOGIN_ACTION_MS);
}

function buildTree(creds) {
  const root = { children: {}, creds: [] };
  for (const cred of creds) {
    const parts = folderPathParts(folderAssignments[cred.id]);
    if (!parts.length) { root.creds.push(cred); continue; }
    let node = root;
    for (const { part, fullPath } of parts) {
      if (!node.children[part]) node.children[part] = { children: {}, creds: [], fullPath };
      node = node.children[part];
    }
    node.creds.push(cred);
  }
  return root;
}

function countCreds(node) {
  let n = node.creds.length;
  for (const child of Object.values(node.children)) n += countCreds(child);
  return n;
}

function renderNode(name, node) {
  const section = document.createElement('div');
  section.className = 'folder-section';
  const { fullPath } = node;

  const tog = document.createElement('span');
  tog.className = 'folder-toggle' + (collapsedFolders.has(fullPath) ? ' collapsed' : '');
  tog.textContent = '▼';

  const label = document.createElement('span');
  label.className = 'folder-name';
  label.textContent = name;

  const count = document.createElement('span');
  count.className = 'folder-count';
  count.textContent = `(${countCreds(node)})`;

  const edit = document.createElement('button');
  edit.className = 'btn-icon folder-edit';
  edit.type = 'button';
  edit.title = 'Rename Folder';
  edit.textContent = '✎';

  const header = document.createElement('div');
  header.className = 'folder-header';
  header.append(tog, label, count, edit);

  const cards = document.createElement('div');
  cards.className = 'folder-cards' + (collapsedFolders.has(fullPath) ? ' hidden' : '');

  header.addEventListener('click', () => {
    const collapsed = tog.classList.toggle('collapsed');
    cards.classList.toggle('hidden', collapsed);
    if (collapsed) collapsedFolders.add(fullPath);
    else collapsedFolders.delete(fullPath);
    chrome.storage.local.set({ collapsedFolders: [...collapsedFolders] });
  });

  edit.addEventListener('click', async e => {
    e.stopPropagation();
    const nextPath = window.prompt('Rename Folder path. Existing folders are merged automatically.', fullPath);
    if (nextPath === null) return;
    try {
      const changed = await renameFolder(fullPath, nextPath);
      showToast(changed ? '✓ Folder renamed' : 'Folder name unchanged', changed ? 'ok' : 'err');
    } catch (err) {
      showToast(err.message || 'Could not rename folder', 'err');
    }
  });

  for (const childName of Object.keys(node.children).sort(byName)) {
    cards.appendChild(renderNode(childName, node.children[childName]));
  }
  for (const cred of node.creds) cards.appendChild(makeCard(cred));
  section.appendChild(header);
  section.appendChild(cards);
  return section;
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
  const activeCredential = activeLoginActionHidden ? null : getActiveLoginCredential(sorted);
  if (activeCredential) {
    list.appendChild(makeActiveLoginButton(activeCredential));
    scheduleActiveLoginActionHide();
  }

  const root = buildTree(sorted);
  for (const name of Object.keys(root.children).sort(byName)) list.appendChild(renderNode(name, root.children[name]));
  for (const cred of root.creds) list.appendChild(makeCard(cred));
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
    closeAfterLoginPlayback();
    return;
  }

  const onLoginPage = await pageLooksLikeLoginPage(tab.id);
  const loginLikeUrl = urlLooksLikeLoginPage(currentUrl);
  const savedUrl = getCredentialUrl(cred);
  const savedUrlLooksLikeLoginPage = urlLooksLikeLoginPage(savedUrl);
  if (!onLoginPage || (savedUrlLooksLikeLoginPage && !loginLikeUrl)) {
    const url = savedUrl;
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
      closeAfterLoginPlayback();
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
    closeAfterLoginPlayback();
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
  const folder   = document.getElementById('addFolder').value.trim();

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
    const res = await saveCredentialRecord({ domain, username, password, loginUrl }, folder);
    const savedId = getSavedCredentialId(res, domain, username);
    if (!savedId) throw new Error('Server did not return a credential id');
    if (loginUrl) await setLoginUrlOverride(savedId, canonicalLoginUrl(loginUrl));
    else await removeLoginUrlOverride(savedId);
    await setFolderAssignment(savedId, folder);
    await setPendingFolderSync(savedId, folder);
    const savedCredential = {
      id: savedId,
      domain,
      username,
      password,
      loginUrl: canonicalLoginUrl(loginUrl),
      folder: normalizeFolderPath(folder),
    };
    if (editingCredential && editingCredential.id && editingCredential.id !== savedId) {
      const delRes = await chrome.runtime.sendMessage({ type: 'DELETE_CREDENTIAL', id: editingCredential.id });
      if (delRes?.error) throw new Error(delRes.error);
      await removeLoginUrlOverride(editingCredential.id);
      await removeFolderAssignment(editingCredential.id);
      await clearPendingFolderSync(editingCredential.id);
    }
    allCredentials = allCredentials
      .filter(cred => cred.id !== savedCredential.id && cred.id !== editingCredential?.id)
      .concat(savedCredential);
    updateUsernameSuggestions();
    updateFolderSuggestions();
    renderCredentials();
    showToast(editingCredential ? '✓ Credential updated' : '✓ Saved to server', 'ok');
    resetCredentialForm();
    document.querySelector('[data-tab="autofill"]').click();
  } catch (err) {
    showToast(err.message, 'err');
  } finally {
    btn.disabled = false;
    cancelBtn.disabled = false;
    btn.textContent = editingCredential ? 'Update Credential' : 'Save To Server';
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
    await removeFolderAssignment(id);
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
    showAuthError();
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

async function clearCredentialCache() {
  const res = await chrome.runtime.sendMessage({ type: 'CLEAR_CREDENTIAL_CACHE' });
  if (res?.error) throw new Error(res.error);
}

document.getElementById('signInBtn').addEventListener('click', async () => {
  const btn = document.getElementById('signInBtn');
  btn.disabled = true;
  btn.querySelector('svg').nextSibling.textContent = ' Signing In…';
  showAuthError();
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GOOGLE_SIGN_IN' });
    if (res.error) throw new Error(res.error);
    showToast('✓ Signed in as ' + res.email, 'ok');
    await loadAuthState();
    await loadCredentials();
  } catch (err) {
    const message = err.message || 'Google sign-in failed';
    showAuthError(message);
    showToast('Google sign-in failed', 'err');
  } finally {
    btn.disabled = false;
    btn.querySelector('svg').nextSibling.textContent = ' Sign In With Google';
  }
});

document.getElementById('signOutBtn').addEventListener('click', async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GOOGLE_SIGN_OUT' });
    if (res.error) throw new Error(res.error);
    showToast('Signed out', 'ok');
    await loadAuthState();
    allCredentials = [];
    folderAssignments = {};
    updateUsernameSuggestions();
    updateFolderSuggestions();
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
    await clearCredentialCache();
    showToast('✓ Keys imported', 'ok');
    await loadCredentials();
  } catch (err) {
    showToast(err.message || 'Invalid key file', 'err');
  }
  e.target.value = '';
});

// ---- Login page import / export ----
const loginPageBrowserApi = chrome.bookmarks;
let loginPageDirty = false;
let loginPageAutosaveTimer = null;
let suppressLoginPageDirty = false;

function loginPageBrowserCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, result => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

function normalizeLoginPageNode(node) {
  const title = (node.title || node.name || '').trim();
  if (node.url) return { title: title || node.url, url: node.url };
  return {
    title: title || 'Untitled',
    children: (node.children || []).map(normalizeLoginPageNode),
  };
}

function normalizeLoginPageRoots(data) {
  if (data?.senkeyLoginPages && Array.isArray(data.roots)) return data.roots.map(normalizeLoginPageNode);
  if (Array.isArray(data?.roots)) return data.roots.map(normalizeLoginPageNode);
  if (Array.isArray(data) && data[0]?.children) return data[0].children.map(normalizeLoginPageNode);
  if (Array.isArray(data)) return data.map(normalizeLoginPageNode);
  if (data?.roots && typeof data.roots === 'object') {
    const roots = ['bookmark_bar', 'other', 'synced']
      .map(key => data.roots[key])
      .filter(node => node?.children);
    if (roots.length) return roots.map(normalizeLoginPageNode);
  }
  if (data && typeof data === 'object') {
    const sample = Object.values(data).find(value => value && typeof value === 'object');
    if (sample?.domain || sample?.username || sample?.password || sample?.loginUrl) {
      throw new Error('That is a credentials file, not a login pages backup');
    }
  }
  throw new Error('Invalid login pages file');
}

async function getCurrentLoginPageRoots() {
  const roots = await loginPageBrowserCall(loginPageBrowserApi.getTree.bind(loginPageBrowserApi));
  return (roots?.[0]?.children || roots || []).map(normalizeLoginPageNode);
}

async function saveLoginPagesToBucket(roots) {
  clearTimeout(loginPageAutosaveTimer);
  const res = await chrome.runtime.sendMessage({
    type: 'SAVE_LOGINPAGES',
    payload: { roots },
  });
  if (res?.error) throw new Error(res.error);
  await markLoginPagesCloudChecked();
  loginPageDirty = false;
  return res;
}

async function getLoginPageImportParentId() {
  const tree = await loginPageBrowserCall(loginPageBrowserApi.getTree.bind(loginPageBrowserApi));
  const rootChildren = tree?.[0]?.children || [];
  const bookmarksBar = rootChildren.find(node => /bookmarks bar/i.test(node.title || ''));
  return (bookmarksBar || rootChildren[0])?.id;
}

async function importLoginPageNode(node, parentId) {
  if (!node || !parentId) return;
  const title = (node.title || node.name || 'Untitled').trim() || 'Untitled';
  if (node.url) {
    await loginPageBrowserCall(loginPageBrowserApi.create.bind(loginPageBrowserApi), { parentId, title, url: node.url });
    return;
  }

  const folder = await loginPageBrowserCall(loginPageBrowserApi.create.bind(loginPageBrowserApi), { parentId, title });
  for (const child of node.children || []) {
    await importLoginPageNode(child, folder.id);
  }
}

function downloadLoginPageFile(roots) {
  const data = {
    senkeyLoginPages: true,
    exportedAt: new Date().toISOString(),
    roots,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `senkey-login-pages-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function restoreLoginPageRoots(roots) {
  const parentId = await getLoginPageImportParentId();
  if (!parentId) throw new Error('Could not find a browser folder for import');

  suppressLoginPageDirty = true;
  try {
    const importedFolder = await loginPageBrowserCall(loginPageBrowserApi.create.bind(loginPageBrowserApi), {
      parentId,
      title: `SenKey Import ${new Date().toLocaleString()}`,
    });
    for (const root of roots) {
      await importLoginPageNode(root, importedFolder.id);
    }
  } finally {
    setTimeout(() => { suppressLoginPageDirty = false; loginPageDirty = false; }, 0);
  }
}

document.getElementById('exportLoginPagesBtn').addEventListener('click', async () => {
  try {
    const roots = await getCurrentLoginPageRoots();
    downloadLoginPageFile(roots);
    try {
      await saveLoginPagesToBucket(roots);
      showToast('Login Pages exported', 'ok');
    } catch (err) {
      showToast(`Downloaded backup. Bucket save failed: ${err.message}`, 'err');
    }
  } catch (err) {
    showToast(err.message || 'Could not export login pages', 'err');
  }
});

document.getElementById('importLoginPagesFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const roots = normalizeLoginPageRoots(JSON.parse(await file.text()));
    await saveLoginPagesToBucket(roots);
    await restoreLoginPageRoots(roots);
    showToast('✓ Login Pages imported', 'ok');
  } catch (err) {
    showToast(err.message || 'Invalid login pages file', 'err');
  }
  e.target.value = '';
});

function markLoginPagesDirty() {
  if (suppressLoginPageDirty) return;
  loginPageDirty = true;
  clearTimeout(loginPageAutosaveTimer);
  loginPageAutosaveTimer = setTimeout(saveDirtyLoginPages, 2000);
}

function saveDirtyLoginPages() {
  clearTimeout(loginPageAutosaveTimer);
  if (!loginPageDirty) return;
  loginPageDirty = false;
  getCurrentLoginPageRoots()
    .then(saveLoginPagesToBucket)
    .catch(err => {
      loginPageDirty = true;
      console.warn('[SenKey] failed to autosave login pages', err);
    });
}

function registerLoginPageAutosave() {
  loginPageBrowserApi.onCreated?.addListener(markLoginPagesDirty);
  loginPageBrowserApi.onRemoved?.addListener(markLoginPagesDirty);
  loginPageBrowserApi.onChanged?.addListener(markLoginPagesDirty);
  loginPageBrowserApi.onMoved?.addListener(markLoginPagesDirty);
  loginPageBrowserApi.onChildrenReordered?.addListener(markLoginPagesDirty);
  loginPageBrowserApi.onImportEnded?.addListener(markLoginPagesDirty);

  window.addEventListener('pagehide', saveDirtyLoginPages);
  window.addEventListener('beforeunload', saveDirtyLoginPages);
}

if (loginPageBrowserApi) registerLoginPageAutosave();

async function markLoginPagesCloudChecked() {
  await chrome.storage.local.set({ [LOGIN_PAGES_CLOUD_CHECKED_AT_KEY]: Date.now() });
}

async function shouldSyncLoginPagesFromBucket(force = false) {
  if (force) return true;
  const data = await chrome.storage.local.get(LOGIN_PAGES_CLOUD_CHECKED_AT_KEY);
  const checkedAt = Number(data[LOGIN_PAGES_CLOUD_CHECKED_AT_KEY] || 0);
  return !checkedAt || Date.now() - checkedAt > LOGIN_PAGES_CLOUD_CHECK_INTERVAL_MS;
}

async function syncLoginPagesFromBucket({ force = false } = {}) {
  if (!(await shouldSyncLoginPagesFromBucket(force))) return;

  try {
    const res = await chrome.runtime.sendMessage({ type: 'FETCH_LOGINPAGES' });
    if (res?.error) {
      await markLoginPagesCloudChecked();
      return;
    }
    await markLoginPagesCloudChecked();
    const roots = res.loginpages?.roots || res.bookmarks?.roots || [];
    if (!roots.length) {
      const currentRoots = await getCurrentLoginPageRoots();
      await saveLoginPagesToBucket(currentRoots);
    }
  } catch (err) {
    console.warn('[SenKey] login pages cloud check failed', err);
    await markLoginPagesCloudChecked();
  }
}

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
  await clearCredentialCache();
  showToast('✓ Settings saved', 'ok');
  await loadCredentials();
  await syncLoginPagesFromBucket({ force: true });
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
  currentPageUrl = canonicalLoginUrl(await getCurrentPageUrl());
  document.getElementById('currentDomain').textContent = currentDomain || 'unknown site';
  await loadCredentials({ preferCache: true, refreshAfterCache: true });
  await syncLoginPagesFromBucket();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await syncMatchingCredentialsForPage(tab?.id);
})();
