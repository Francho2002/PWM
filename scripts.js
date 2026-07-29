'use strict';

const DB_NAME = 'pwm-local-vault';
const DB_VERSION = 1;
const STORE_NAME = 'vault';
const INDEX_KEY = 'vault-index';
const LEGACY_RECORD_KEY = 'current';
const VAULT_RECORD_PREFIX = 'vault:';
const PBKDF2_ITERATIONS = 600_000;
const AUTO_LOCK_MS = 5 * 60 * 1000;
const CLIPBOARD_CLEAR_MS = 20_000;
const THEME_STORAGE_KEY = 'pwm-theme';
const USB_KEY_FORMAT = 'pwm-usb-key';
const USB_KEY_VERSION = 1;
const USB_KEY_MAX_BYTES = 16 * 1024;
const DEK_BYTES = 32;
const GENERATED_PASSWORD_LENGTH = 20;
const PASSWORD_CHARACTER_GROUPS = Object.freeze({
  uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lowercase: 'abcdefghijkmnopqrstuvwxyz',
  numbers: '23456789',
  symbols: '!@#$%&*+-_=?.',
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VAULT_AS_KEY_MESSAGE = 'Ese archivo es una bóveda, no una llave USB. Usá “Importar bóveda”.';
const KEY_AS_VAULT_MESSAGE = 'Ese archivo es una llave USB, no una bóveda. Usá “Importar clave”.';

const state = {
  key: null,
  keyBytes: null,
  entries: [],
  record: null,
  vaultId: null,
  vaultName: '',
  index: {
    format: 'pwm-vault-index',
    version: 2,
    activeVaultId: null,
    vaults: [],
  },
  autoLockTimer: null,
  noticeTimer: null,
};

const $ = (id) => document.getElementById(id);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function showNotice(message, type = 'success') {
  const notice = $('notice');
  notice.textContent = message;
  notice.className = `notice ${type}`;
  window.clearTimeout(state.noticeTimer);
  state.noticeTimer = window.setTimeout(() => notice.classList.add('hidden'), 5000);
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  $('themeToggle').setAttribute('aria-pressed', String(isDark));
  $('themeToggle').setAttribute('aria-label', isDark ? 'Activar modo claro' : 'Activar modo oscuro');
  $('themeIcon').textContent = isDark ? '☀' : '☾';
  $('themeToggleLabel').textContent = isDark ? 'Modo claro' : 'Modo oscuro';
}

function loadTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === 'dark' || savedTheme === 'light') return savedTheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
}

function setScreen(name) {
  $('setupScreen').classList.toggle('hidden', name !== 'setup');
  $('unlockScreen').classList.toggle('hidden', name !== 'unlock');
  $('vaultScreen').classList.toggle('hidden', name !== 'vault');
  $('vaultStatus').classList.toggle('unlocked', name === 'vault');
  $('vaultStatus').lastElementChild.textContent = name === 'vault'
    ? `Abierta · ${state.vaultName}`
    : 'Bloqueada';
  if (name === 'vault') $('currentVaultName').textContent = state.vaultName;
  updateBackupReminder();
}

function showSetup(isAdditionalVault = false) {
  $('setupForm').reset();
  $('setupEyebrow').textContent = isAdditionalVault ? 'Nueva bóveda' : 'Empezar';
  $('setupTitle').textContent = isAdditionalVault ? 'Creá otra bóveda.' : 'Creá tu primera bóveda.';
  $('setupLead').textContent = isAdditionalVault
    ? 'Tendrá su propio nombre, clave maestra y contraseñas.'
    : 'Ponéle un nombre y protegela con una clave maestra que no uses en otro lugar.';
  $('cancelSetupButton').classList.toggle('hidden', !state.index.vaults.length);
  setScreen('setup');
  $('setupVaultName').focus();
}

function resetAutoLock() {
  window.clearTimeout(state.autoLockTimer);
  if (!state.key) return;
  state.autoLockTimer = window.setTimeout(() => lockVault(true), AUTO_LOCK_MS);
}

function base64FromBytes(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function bytesFromBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Base64 inválido');
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (base64FromBytes(bytes) !== value) throw new Error('Base64 inválido');
  return bytes;
}

function hasBase64Length(value, length) {
  try {
    return bytesFromBase64(value).byteLength === length;
  } catch (_) {
    return false;
  }
}

function hasBase64AtLeast(value, minimum) {
  try {
    return bytesFromBase64(value).byteLength >= minimum;
  } catch (_) {
    return false;
  }
}

function newSalt() {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

function newIv() {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  return iv;
}

async function deriveKey(masterPassword, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterPassword),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function aad(kind, keyId = '') {
  return encoder.encode(`pwm-local-vault|v2|${kind}${keyId ? `|${keyId}` : ''}`);
}

async function importAesKey(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== DEK_BYTES) {
    throw new Error('Clave de cifrado inválida');
  }
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function randomDek() {
  const bytes = new Uint8Array(DEK_BYTES);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function encryptPayloadV1(key, payload) {
  const iv = newIv();
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return {
    iv: base64FromBytes(iv),
    ciphertext: base64FromBytes(new Uint8Array(cipher)),
  };
}

async function decryptPayloadV1(key, record) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesFromBase64(record.iv) },
    key,
    bytesFromBase64(record.ciphertext),
  );
  const payload = JSON.parse(decoder.decode(plaintext));
  if (!Array.isArray(payload.entries)) throw new Error('Formato de bóveda inválido');
  return payload;
}

async function encryptPayloadV2(key, payload) {
  const iv = newIv();
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad('payload') },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return { iv: base64FromBytes(iv), ciphertext: base64FromBytes(new Uint8Array(cipher)) };
}

async function decryptPayloadV2(key, record) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesFromBase64(record.iv), additionalData: aad('payload') },
    key,
    bytesFromBase64(record.ciphertext),
  );
  const payload = JSON.parse(decoder.decode(plaintext));
  if (!Array.isArray(payload.entries)) throw new Error('Formato de bóveda inválido');
  return payload;
}

async function wrapDek(kek, dekBytes, context) {
  const iv = newIv();
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: context },
    kek,
    dekBytes,
  );
  return { iv: base64FromBytes(iv), wrappedKey: base64FromBytes(new Uint8Array(cipher)) };
}

async function unwrapDek(kek, wrap, context) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesFromBase64(wrap.iv), additionalData: context },
    kek,
    bytesFromBase64(wrap.wrappedKey),
  );
  const bytes = new Uint8Array(plain);
  if (bytes.byteLength !== DEK_BYTES) throw new Error('Clave envuelta inválida');
  return bytes;
}

function equalBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.byteLength !== right.byteLength) return false;
  let result = 0;
  for (let index = 0; index < left.byteLength; index += 1) result |= left[index] ^ right[index];
  return result === 0;
}

async function createV2Record(masterPassword, payload, createdAt = new Date().toISOString()) {
  const salt = newSalt();
  const passwordKey = await deriveKey(masterPassword, salt, PBKDF2_ITERATIONS);
  const keyBytes = randomDek();
  const key = await importAesKey(keyBytes);
  const encrypted = await encryptPayloadV2(key, payload);
  const passwordWrap = await wrapDek(passwordKey, keyBytes, aad('password-wrap'));
  const updatedAt = new Date().toISOString();
  return {
    record: {
      format: 'pwm-local-vault',
      version: 2,
      kdf: 'PBKDF2-SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt: base64FromBytes(salt),
      passwordWrap,
      ...encrypted,
      createdAt,
      updatedAt,
    },
    key,
    keyBytes,
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readValue(key) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

async function writeValues(entries) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    entries.forEach(([key, value]) => store.put(value, key));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

async function writeAndDeleteValues(entries, keys) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    entries.forEach(([key, value]) => store.put(value, key));
    keys.forEach((key) => store.delete(key));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

function vaultRecordKey(vaultId) {
  return `${VAULT_RECORD_PREFIX}${vaultId}`;
}

function emptyIndex() {
  return {
    format: 'pwm-vault-index',
    version: 2,
    activeVaultId: null,
    vaults: [],
  };
}

function validateVaultRecord(record) {
  if (!record || typeof record !== 'object' || record.format !== 'pwm-local-vault') return false;
  const common = record.kdf === 'PBKDF2-SHA-256'
    && record.iterations === PBKDF2_ITERATIONS
    && hasBase64Length(record.salt, 16)
    && hasBase64Length(record.iv, 12)
    && hasBase64AtLeast(record.ciphertext, 16);
  if (!common) return false;
  if (record.version === 1) return true;
  if (record.version !== 2 || !validWrap(record.passwordWrap)) return false;
  if (!Object.hasOwn(record, 'usbUnlock')) return true;
  return record.usbUnlock === null || validUsbUnlock(record.usbUnlock);
}

function validWrap(wrap, exact = true) {
  return Boolean(
    wrap
    && typeof wrap === 'object'
    && (!exact || Object.keys(wrap).length === 2)
    && hasBase64Length(wrap.iv, 12)
    && hasBase64Length(wrap.wrappedKey, DEK_BYTES + 16),
  );
}

function validUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validUsbUnlock(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && Object.keys(value).length === 3
    && validUuid(value.keyId)
    && validWrap(value, false),
  );
}

function validateUsbKeyFile(value) {
  const required = ['format', 'version', 'keyId', 'secret'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== required.length) {
    throw new Error('Archivo llave inválido');
  }
  if (!required.every((field) => Object.hasOwn(value, field))) throw new Error('Archivo llave inválido');
  if (
    value.format !== USB_KEY_FORMAT
    || value.version !== USB_KEY_VERSION
    || !validUuid(value.keyId)
    || !hasBase64Length(value.secret, DEK_BYTES)
  ) {
    throw new Error('Archivo llave inválido');
  }
  return { keyId: value.keyId, secret: bytesFromBase64(value.secret) };
}

function validateVaultIndex(index) {
  return Boolean(
    index
    && index.format === 'pwm-vault-index'
    && index.version === 2
    && Array.isArray(index.vaults)
    && index.vaults.every(
      (vault) => vault
        && typeof vault.id === 'string'
        && typeof vault.name === 'string'
        && vault.name.trim(),
    ),
  );
}

function ensureVaultMetadata(index) {
  const usedUids = new Set();
  let changed = false;
  const vaults = index.vaults.map((vault) => {
    let uid = vault.uid;
    if (!validUuid(uid) || usedUids.has(uid)) {
      uid = crypto.randomUUID();
      changed = true;
    }
    usedUids.add(uid);
    const backupVersion = Number.isSafeInteger(vault.backupVersion)
      && vault.backupVersion >= 0
      && vault.backupVersion < Number.MAX_SAFE_INTEGER
      ? vault.backupVersion
      : 0;
    const needsBackup = typeof vault.needsBackup === 'boolean' ? vault.needsBackup : false;
    const usbKeyVersion = Number.isSafeInteger(vault.usbKeyVersion)
      && vault.usbKeyVersion >= 0
      && vault.usbKeyVersion < Number.MAX_SAFE_INTEGER
      ? vault.usbKeyVersion
      : 0;
    if (
      backupVersion !== vault.backupVersion
      || usbKeyVersion !== vault.usbKeyVersion
      || needsBackup !== vault.needsBackup
    ) changed = true;
    return {
      ...vault,
      uid,
      backupVersion,
      usbKeyVersion,
      needsBackup,
    };
  });
  return {
    index: changed ? { ...index, vaults } : index,
    changed,
  };
}

async function loadVaultIndex() {
  const storedIndex = await readValue(INDEX_KEY);
  if (validateVaultIndex(storedIndex)) {
    const normalized = ensureVaultMetadata(storedIndex);
    state.index = normalized.index;
    let changed = normalized.changed;
    if (!state.index.vaults.some((vault) => vault.id === state.index.activeVaultId)) {
      state.index.activeVaultId = state.index.vaults[0]?.id ?? null;
      changed = true;
    }
    if (changed) await writeValues([[INDEX_KEY, state.index]]);
    return;
  }

  const legacyRecord = await readValue(LEGACY_RECORD_KEY);
  if (!validateVaultRecord(legacyRecord)) {
    state.index = emptyIndex();
    return;
  }

  const vaultId = crypto.randomUUID();
  const createdAt = legacyRecord.createdAt || new Date().toISOString();
  state.index = {
    ...emptyIndex(),
    activeVaultId: vaultId,
    vaults: [{
      id: vaultId,
      uid: crypto.randomUUID(),
      name: 'Mi bóveda',
      backupVersion: 0,
      usbKeyVersion: 0,
      needsBackup: false,
      createdAt,
      updatedAt: legacyRecord.updatedAt || createdAt,
    }],
  };
  await writeValues([
    [vaultRecordKey(vaultId), legacyRecord],
    [INDEX_KEY, state.index],
  ]);
}

function vaultNameExists(name) {
  const normalized = name.trim().toLocaleLowerCase('es');
  return state.index.vaults.some(
    (vault) => vault.name.trim().toLocaleLowerCase('es') === normalized,
  );
}

function cleanImportedVaultName(preferredName) {
  return String(preferredName || 'Bóveda importada').trim().slice(0, 60) || 'Bóveda importada';
}

function renderVaultSelect(preferredVaultId = state.index.activeVaultId) {
  const select = $('vaultSelect');
  while (select.firstChild) select.removeChild(select.firstChild);
  state.index.vaults
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .forEach((vault) => {
      const option = document.createElement('option');
      option.value = vault.id;
      option.textContent = vault.name;
      select.append(option);
    });
  const selectedId = state.index.vaults.some((vault) => vault.id === preferredVaultId)
    ? preferredVaultId
    : state.index.vaults[0]?.id;
  if (selectedId) select.value = selectedId;
  refreshUsbUnlockAvailability();
  updateBackupReminder();
}

function refreshUsbUnlockAvailability() {
  const button = $('unlockUsbKeyButton');
  const helper = $('unlockUsbKeyHelper');
  const available = state.index.vaults.length > 0;
  button.classList.toggle('hidden', !available);
  helper.classList.toggle('hidden', !available);
}

function updateVaultMetadata(index, vaultId, name, updatedAt, updates = {}) {
  return {
    ...index,
    activeVaultId: vaultId,
    vaults: index.vaults.map((vault) => (
      vault.id === vaultId ? {
        ...vault,
        ...updates,
        name,
        updatedAt,
      } : vault
    )),
  };
}

function updateBackupReminder() {
  const metadata = state.index.vaults.find((vault) => vault.id === state.vaultId);
  const needsBackup = Boolean(state.vaultId && metadata?.needsBackup);
  $('backupReminder').classList.toggle('hidden', !needsBackup);
  $('exportButton').classList.toggle('backup-due', needsBackup);
  if (needsBackup) {
    $('exportButton').setAttribute('aria-describedby', 'backupReminder');
  } else {
    $('exportButton').removeAttribute('aria-describedby');
  }
}

async function saveVault() {
  if (!state.key || !state.keyBytes || !state.record || state.record.version !== 2 || !state.vaultId) {
    throw new Error('Bóveda bloqueada');
  }
  const encrypted = await encryptPayloadV2(state.key, { entries: state.entries });
  const updatedAt = new Date().toISOString();
  const nextRecord = { ...state.record, ...encrypted, updatedAt };
  const nextIndex = updateVaultMetadata(
    state.index,
    state.vaultId,
    state.vaultName,
    updatedAt,
    { needsBackup: true },
  );
  await writeValues([
    [vaultRecordKey(state.vaultId), nextRecord],
    [INDEX_KEY, nextIndex],
  ]);
  state.record = nextRecord;
  state.index = nextIndex;
  renderVaultSelect(state.vaultId);
  resetAutoLock();
}

function normalizeEntry(entry) {
  return {
    id: typeof entry.id === 'string' ? entry.id : crypto.randomUUID(),
    service: String(entry.service ?? '').trim(),
    username: String(entry.username ?? '').trim(),
    password: String(entry.password ?? ''),
    website: String(entry.website ?? '').trim(),
    notes: String(entry.notes ?? '').trim(),
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || new Date().toISOString(),
  };
}

function randomPassword(groups) {
  const characters = groups.join('');
  const result = groups.map((group) => secureCharacter(group));
  while (result.length < GENERATED_PASSWORD_LENGTH) result.push(secureCharacter(characters));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = secureIndex(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result.join('');
}

function selectedPasswordGroups() {
  return [...document.querySelectorAll('.character-toggle[aria-pressed="true"]')]
    .map((button) => PASSWORD_CHARACTER_GROUPS[button.dataset.characterSet])
    .filter(Boolean);
}

function secureCharacter(characters) {
  return characters[secureIndex(characters.length)];
}

function secureIndex(max) {
  const limit = Math.floor(256 / max) * max;
  const random = new Uint8Array(1);
  do { crypto.getRandomValues(random); } while (random[0] >= limit);
  return random[0] % max;
}

function emptyElement(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function createAction(label, action, id, danger = false, primary = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = [
    'card-button',
    danger ? 'danger' : '',
    primary ? 'copy-button' : '',
  ].filter(Boolean).join(' ');
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function entryCard(entry) {
  const card = document.createElement('article');
  card.className = 'entry-card';

  const heading = document.createElement('div');
  heading.className = 'entry-summary';
  const service = document.createElement('h3');
  service.textContent = entry.service;
  const username = document.createElement('p');
  username.textContent = entry.username;
  heading.append(service, username);

  const details = document.createElement('div');
  details.className = 'entry-details';
  const password = document.createElement('code');
  password.className = 'masked-password';
  password.textContent = '••••••••••••••••';
  password.dataset.value = entry.password;
  password.dataset.revealed = 'false';
  details.append(password);

  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  actions.append(
    createAction('Copiar contraseña', 'copy', entry.id, false, true),
    createAction('Ver', 'reveal', entry.id),
    createAction('Editar', 'edit', entry.id),
    createAction('Eliminar', 'delete', entry.id, true),
  );
  card.append(heading, details, actions);
  return card;
}

function renderEntries() {
  const query = $('search').value.trim().toLocaleLowerCase('es');
  const matching = state.entries
    .filter((entry) => [entry.service, entry.username, entry.website, entry.notes]
      .join(' ').toLocaleLowerCase('es').includes(query))
    .sort((a, b) => a.service.localeCompare(b.service, 'es'));
  const container = $('entries');
  emptyElement(container);
  if (!matching.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = state.entries.length
      ? 'No hay resultados para esa búsqueda.'
      : 'Todavía no guardaste ninguna contraseña.';
    container.append(empty);
    return;
  }
  matching.forEach((entry) => container.append(entryCard(entry)));
}

function setOptionalFieldsExpanded(expanded) {
  $('optionalEntryFields').classList.toggle('hidden', !expanded);
  $('toggleOptionalFields').setAttribute('aria-expanded', String(expanded));
  $('optionalFieldsLabel').textContent = expanded ? 'Menos opciones' : 'Más opciones';
}

function clearEditor() {
  $('entryForm').reset();
  $('entryId').value = '';
  $('editorTitle').textContent = 'Agregar contraseña';
  $('saveButtonText').textContent = 'Guardar en la bóveda';
  $('cancelEditButton').classList.add('hidden');
  $('password').type = 'password';
  $('toggleEditorPassword').setAttribute('aria-label', 'Mostrar contraseña');
  setOptionalFieldsExpanded(false);
}

function editEntry(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  $('entryId').value = entry.id;
  $('service').value = entry.service;
  $('username').value = entry.username;
  $('password').value = entry.password;
  $('website').value = entry.website;
  $('notes').value = entry.notes;
  setOptionalFieldsExpanded(Boolean(entry.website || entry.notes));
  $('editorTitle').textContent = 'Editar contraseña';
  $('saveButtonText').textContent = 'Guardar cambios';
  $('cancelEditButton').classList.remove('hidden');
  $('service').focus();
  resetAutoLock();
}

async function copyPassword(id, button) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  try {
    await navigator.clipboard.writeText(entry.password);
    if (button) {
      const originalLabel = button.dataset.defaultLabel || button.textContent;
      button.dataset.defaultLabel = originalLabel;
      button.textContent = '✓ Copiada';
      button.classList.add('copied');
      window.setTimeout(() => {
        button.textContent = originalLabel;
        button.classList.remove('copied');
      }, 2000);
    }
    showNotice('Contraseña copiada. Intentaré limpiar el portapapeles en 20 segundos.');
    window.setTimeout(async () => {
      try {
        if ((await navigator.clipboard.readText()) === entry.password) {
          await navigator.clipboard.writeText('');
        }
      } catch (_) {
        // El navegador puede impedir leer el portapapeles.
      }
    }, CLIPBOARD_CLEAR_MS);
  } catch (_) {
    showNotice('No se pudo copiar. Usá el botón Ver y copiala manualmente.', 'error');
  }
  resetAutoLock();
}

function toggleEntryPassword(id, button) {
  const entry = state.entries.find((item) => item.id === id);
  const card = button.closest('.entry-card');
  const display = card?.querySelector('.masked-password');
  if (!entry || !display) return;
  const revealed = display.dataset.revealed === 'true';
  display.textContent = revealed ? '••••••••••••••••' : entry.password;
  display.dataset.revealed = String(!revealed);
  button.textContent = revealed ? 'Ver' : 'Ocultar';
  resetAutoLock();
}

async function createVault(event) {
  event.preventDefault();
  const vaultName = $('setupVaultName').value.trim();
  const master = $('setupMaster').value;
  const confirmMaster = $('setupConfirm').value;
  if (!vaultName) return showNotice('Ponéle un nombre a la bóveda.', 'error');
  if (vaultNameExists(vaultName)) return showNotice('Ya existe una bóveda con ese nombre.', 'error');
  if (master.length < 12) return showNotice('Usá una clave maestra de al menos 12 caracteres.', 'error');
  if (master !== confirmMaster) return showNotice('Las dos claves maestras no coinciden.', 'error');

  let pendingKeyBytes;
  try {
    const vaultId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const created = await createV2Record(master, { entries: [] }, createdAt);
    const { record, key, keyBytes } = created;
    pendingKeyBytes = keyBytes;
    const nextIndex = {
      ...state.index,
      activeVaultId: vaultId,
      vaults: [
        ...state.index.vaults,
        {
          id: vaultId,
          uid: crypto.randomUUID(),
          name: vaultName,
          backupVersion: 0,
          usbKeyVersion: 0,
          needsBackup: false,
          createdAt,
          updatedAt: createdAt,
        },
      ],
    };
    await writeValues([
      [vaultRecordKey(vaultId), record],
      [INDEX_KEY, nextIndex],
    ]);

    state.key = key;
    state.keyBytes = keyBytes;
    pendingKeyBytes = null;
    state.entries = [];
    state.record = record;
    state.vaultId = vaultId;
    state.vaultName = vaultName;
    state.index = nextIndex;
    $('setupForm').reset();
    clearEditor();
    renderVaultSelect(vaultId);
    setScreen('vault');
    renderEntries();
    resetAutoLock();
    showNotice(`Bóveda “${vaultName}” creada.`);
  } catch (_) {
    state.key = null;
    pendingKeyBytes?.fill(0);
    showNotice('No pude crear la bóveda en este navegador.', 'error');
  }
}

async function unlockVault(event) {
  event.preventDefault();
  const vaultId = $('vaultSelect').value;
  const master = $('unlockMaster').value;
  const metadata = state.index.vaults.find((vault) => vault.id === vaultId);
  if (!vaultId || !metadata || !master) return;

  let pendingKeyBytes;
  try {
    let record = await readValue(vaultRecordKey(vaultId));
    if (!validateVaultRecord(record)) throw new Error('No existe una bóveda válida');
    let key;
    let keyBytes;
    let payload;
    let migrated = false;
    if (record.version === 1) {
      const legacyKey = await deriveKey(master, bytesFromBase64(record.salt), record.iterations);
      payload = await decryptPayloadV1(legacyKey, record);
      const next = await createV2Record(master, payload, record.createdAt || new Date().toISOString());
      record = next.record;
      key = next.key;
      keyBytes = next.keyBytes;
      pendingKeyBytes = keyBytes;
      migrated = true;
    } else {
      const passwordKey = await deriveKey(master, bytesFromBase64(record.salt), record.iterations);
      keyBytes = await unwrapDek(passwordKey, record.passwordWrap, aad('password-wrap'));
      pendingKeyBytes = keyBytes;
      key = await importAesKey(keyBytes);
      payload = await decryptPayloadV2(key, record);
    }
    const nextIndex = updateVaultMetadata(
      state.index,
      vaultId,
      metadata.name,
      record.updatedAt,
      migrated ? { needsBackup: true } : {},
    );
    const writes = [[INDEX_KEY, nextIndex]];
    if (migrated) writes.unshift([vaultRecordKey(vaultId), record]);
    await writeValues(writes);
    activateUnlockedVault(vaultId, metadata.name, record, key, keyBytes, payload, nextIndex);
    pendingKeyBytes = null;
    showNotice(`Bóveda “${metadata.name}” desbloqueada.`);
  } catch (_) {
    pendingKeyBytes?.fill(0);
    showNotice('La clave maestra no es correcta o la bóveda está dañada.', 'error');
  }
}

function activateUnlockedVault(vaultId, vaultName, record, key, keyBytes, payload, index) {
  state.key = key;
  state.keyBytes = keyBytes;
  state.entries = payload.entries.map(normalizeEntry);
  state.record = record;
  state.vaultId = vaultId;
  state.vaultName = vaultName;
  state.index = index;
  $('unlockForm').reset();
  clearEditor();
  setScreen('vault');
  renderEntries();
  resetAutoLock();
}

async function readUsbKeyFile(file) {
  if (!file || file.size <= 0) throw new Error('Archivo llave inválido');
  if (file.size > USB_KEY_MAX_BYTES) {
    const prefix = await file.slice(0, 2048).text();
    if (/"format"\s*:\s*"(?:pwm-vault-backup|pwm-local-vault)"/.test(prefix)) {
      throw new Error(VAULT_AS_KEY_MESSAGE);
    }
    throw new Error('Archivo llave inválido');
  }
  const text = await file.text();
  if (encoder.encode(text).byteLength > USB_KEY_MAX_BYTES) throw new Error('Archivo llave inválido');
  const parsed = JSON.parse(text);
  if (parsed?.format === 'pwm-vault-backup' || parsed?.format === 'pwm-local-vault') {
    throw new Error(VAULT_AS_KEY_MESSAGE);
  }
  return validateUsbKeyFile(parsed);
}

async function unlockWithUsbKey(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;

  let usbKey;
  let pendingKeyBytes;
  try {
    usbKey = await readUsbKeyFile(file);
    const matches = [];
    for (const metadata of state.index.vaults) {
      const record = await readValue(vaultRecordKey(metadata.id));
      if (
        validateVaultRecord(record)
        && record.version === 2
        && validUsbUnlock(record.usbUnlock)
        && record.usbUnlock.keyId === usbKey.keyId
      ) {
        matches.push({ metadata, record });
      }
    }

    if (!matches.length) throw new Error('El archivo llave no corresponde a ninguna bóveda de este navegador.');
    if (matches.length > 1) throw new Error('El archivo llave coincide con varias bóvedas duplicadas.');

    const [{ metadata, record }] = matches;
    const vaultId = metadata.id;
    const key = await importAesKey(usbKey.secret);
    const keyBytes = await unwrapDek(key, record.usbUnlock, aad('usb-wrap', usbKey.keyId));
    pendingKeyBytes = keyBytes;
    const payloadKey = await importAesKey(keyBytes);
    const payload = await decryptPayloadV2(payloadKey, record);
    const nextIndex = { ...state.index, activeVaultId: vaultId };
    await writeValues([[INDEX_KEY, nextIndex]]);
    activateUnlockedVault(vaultId, metadata.name, record, payloadKey, keyBytes, payload, nextIndex);
    pendingKeyBytes = null;
    showNotice(`Bóveda “${metadata.name}” desbloqueada con el archivo llave.`);
  } catch (error) {
    pendingKeyBytes?.fill(0);
    const knownMessages = [
      'El archivo llave no corresponde a ninguna bóveda de este navegador.',
      'El archivo llave coincide con varias bóvedas duplicadas.',
      VAULT_AS_KEY_MESSAGE,
    ];
    showNotice(
      knownMessages.includes(error.message)
        ? error.message
        : 'El archivo llave no corresponde o la bóveda está dañada.',
      'error',
    );
  } finally {
    usbKey?.secret.fill(0);
  }
}

function lockVault(expired = false) {
  window.clearTimeout(state.autoLockTimer);
  if ($('changeMasterDialog').open) {
    $('changeMasterForm').reset();
    $('changeMasterDialog').close();
  }
  if ($('usbKeyDialog').open) {
    $('usbKeyForm').reset();
    $('usbKeyDialog').close();
  }
  if ($('deleteVaultDialog').open) {
    $('deleteVaultForm').reset();
    $('deleteVaultDialog').close();
  }
  state.key = null;
  if (state.keyBytes) state.keyBytes.fill(0);
  state.keyBytes = null;
  state.entries = [];
  state.record = null;
  state.vaultId = null;
  state.vaultName = '';
  clearEditor();
  $('search').value = '';
  $('unlockForm').reset();
  renderVaultSelect();
  if (state.index.vaults.length) {
    setScreen('unlock');
  } else {
    showSetup(false);
  }
  if (expired) showNotice('La bóveda se bloqueó por inactividad.');
}

async function saveEntry(event) {
  event.preventDefault();
  const service = $('service').value.trim();
  const username = $('username').value.trim();
  const password = $('password').value;
  if (!service || !username || !password) {
    return showNotice('Servicio, usuario y contraseña son obligatorios.', 'error');
  }

  const id = $('entryId').value;
  const previous = state.entries.find((entry) => entry.id === id);
  const entry = normalizeEntry({
    id: id || crypto.randomUUID(),
    service,
    username,
    password,
    website: $('website').value,
    notes: $('notes').value,
    createdAt: previous?.createdAt,
  });

  try {
    state.entries = previous
      ? state.entries.map((item) => (item.id === id ? entry : item))
      : [...state.entries, entry];
    await saveVault();
    clearEditor();
    renderEntries();
    showNotice(previous
      ? 'Cambios guardados. Exportá una nueva copia para actualizar tu respaldo.'
      : 'Contraseña guardada. Exportá una copia actualizada para tu USB.');
  } catch (_) {
    showNotice('No se pudo guardar el cambio.', 'error');
  }
}

async function deleteEntry(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry || !window.confirm(`¿Eliminar la contraseña de ${entry.service}?`)) return;
  try {
    state.entries = state.entries.filter((item) => item.id !== id);
    await saveVault();
    if ($('entryId').value === id) clearEditor();
    renderEntries();
    showNotice('Contraseña eliminada. Exportá una nueva copia para actualizar tu respaldo.');
  } catch (_) {
    showNotice('No se pudo eliminar la contraseña.', 'error');
  }
}

function safeFileName(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    || 'boveda';
}

async function downloadBackup() {
  if (!state.record || !state.vaultId) return;
  const metadata = state.index.vaults.find((vault) => vault.id === state.vaultId);
  if (!metadata || !validUuid(metadata.uid)) {
    showNotice('No pude identificar esta bóveda para exportarla.', 'error');
    return;
  }
  const button = $('exportButton');
  if (button.disabled) return;
  button.disabled = true;
  try {
    const backupVersion = metadata.backupVersion + 1;
    const nextIndex = updateVaultMetadata(
      state.index,
      state.vaultId,
      state.vaultName,
      state.record.updatedAt,
      { backupVersion, needsBackup: false },
    );
    const backup = {
      format: 'pwm-vault-backup',
      version: 3,
      vaultUid: metadata.uid,
      backupVersion,
      usbKeyVersion: metadata.usbKeyVersion,
      name: state.vaultName,
      exportedAt: new Date().toISOString(),
      vault: state.record,
    };
    await writeValues([[INDEX_KEY, nextIndex]]);
    state.index = nextIndex;
    updateBackupReminder();

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName(state.vaultName)}-boveda-v${backupVersion}.pwm.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showNotice(`Copia cifrada v${backupVersion} de “${state.vaultName}” descargada.`);
    resetAutoLock();
  } catch (_) {
    showNotice('No pude preparar la copia cifrada.', 'error');
  } finally {
    button.disabled = false;
  }
}

function extractBackup(value, fileName) {
  if (validateVaultRecord(value)) {
    return {
      uid: null,
      backupVersion: 0,
      usbKeyVersion: 0,
      name: fileName.replace(/(\.pwm)?\.json$/i, '') || 'Bóveda importada',
      record: value,
    };
  }
  if (
    value
    && value.format === 'pwm-vault-backup'
    && (value.version === 2 || value.version === 3)
    && (value.version !== 3 || validUuid(value.vaultUid))
    && validateVaultRecord(value.vault)
  ) {
    return {
      uid: validUuid(value.vaultUid) ? value.vaultUid : null,
      backupVersion: Number.isSafeInteger(value.backupVersion)
        && value.backupVersion >= 1
        && value.backupVersion < Number.MAX_SAFE_INTEGER
        ? value.backupVersion
        : 0,
      usbKeyVersion: Number.isSafeInteger(value.usbKeyVersion)
        && value.usbKeyVersion >= 0
        && value.usbKeyVersion < Number.MAX_SAFE_INTEGER
        ? value.usbKeyVersion
        : 0,
      name: typeof value.name === 'string' ? value.name : 'Bóveda importada',
      record: value.vault,
    };
  }
  throw new Error('Formato no válido');
}

async function vaultIdentityFingerprint(record) {
  const stableRecord = {
    version: record.version,
    salt: record.salt,
    passwordWrap: record.passwordWrap
      ? { iv: record.passwordWrap.iv, wrappedKey: record.passwordWrap.wrappedKey }
      : null,
  };
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(JSON.stringify(stableRecord)),
  );
  return base64FromBytes(new Uint8Array(digest));
}

async function duplicateVaultReason(backup, vaultName) {
  if (vaultNameExists(vaultName)) {
    return `Ya existe una bóveda llamada “${vaultName}”.`;
  }
  if (backup.uid && state.index.vaults.some((vault) => vault.uid === backup.uid)) {
    return 'Esa bóveda ya está guardada en este navegador.';
  }

  const importedFingerprint = await vaultIdentityFingerprint(backup.record);
  for (const metadata of state.index.vaults) {
    const record = await readValue(vaultRecordKey(metadata.id));
    if (
      validateVaultRecord(record)
      && await vaultIdentityFingerprint(record) === importedFingerprint
    ) {
      return 'Esa copia cifrada ya fue importada.';
    }
  }
  return '';
}

async function importBackup(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    if (parsed?.format === USB_KEY_FORMAT) {
      showNotice(KEY_AS_VAULT_MESSAGE, 'error');
      return;
    }
    const backup = extractBackup(parsed, file.name);
    const vaultName = cleanImportedVaultName(backup.name);
    const duplicateReason = await duplicateVaultReason(backup, vaultName);
    if (duplicateReason) {
      showNotice(duplicateReason, 'error');
      return;
    }

    const vaultId = crypto.randomUUID();
    const createdAt = backup.record.createdAt || new Date().toISOString();
    const metadata = {
      id: vaultId,
      uid: backup.uid || crypto.randomUUID(),
      name: vaultName,
      backupVersion: backup.backupVersion,
      usbKeyVersion: backup.usbKeyVersion,
      needsBackup: false,
      createdAt,
      updatedAt: backup.record.updatedAt || createdAt,
    };
    const keepCurrentVault = Boolean(state.key && state.vaultId);
    const nextIndex = {
      ...state.index,
      activeVaultId: keepCurrentVault ? state.index.activeVaultId : vaultId,
      vaults: [...state.index.vaults, metadata],
    };
    await writeValues([
      [vaultRecordKey(vaultId), backup.record],
      [INDEX_KEY, nextIndex],
    ]);
    state.index = nextIndex;
    renderVaultSelect(vaultId);
    if (!keepCurrentVault) {
      state.index.activeVaultId = vaultId;
      setScreen('unlock');
    }
    showNotice(`“${vaultName}” se importó como una bóveda nueva.`);
  } catch (_) {
    showNotice('No pude leer esa copia cifrada.', 'error');
  }
}

function downloadJson(value, fileName) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function verifyCurrentMaster(masterPassword) {
  if (!state.record || state.record.version !== 2 || !state.keyBytes) throw new Error('Bóveda bloqueada');
  const passwordKey = await deriveKey(masterPassword, bytesFromBase64(state.record.salt), state.record.iterations);
  const verifiedBytes = await unwrapDek(passwordKey, state.record.passwordWrap, aad('password-wrap'));
  const matches = equalBytes(verifiedBytes, state.keyBytes);
  verifiedBytes.fill(0);
  if (!matches) throw new Error('Clave maestra incorrecta');
}

async function persistCurrentRecord(nextRecord, metadataUpdates = {}) {
  const updatedAt = new Date().toISOString();
  const record = { ...nextRecord, updatedAt };
  const nextIndex = updateVaultMetadata(
    state.index,
    state.vaultId,
    state.vaultName,
    updatedAt,
    { ...metadataUpdates, needsBackup: true },
  );
  await writeValues([
    [vaultRecordKey(state.vaultId), record],
    [INDEX_KEY, nextIndex],
  ]);
  state.record = record;
  state.index = nextIndex;
  renderVaultSelect(state.vaultId);
}

function openUsbKeyDialog() {
  if (!state.record || state.record.version !== 2) return;
  $('usbKeyForm').reset();
  const configured = validUsbUnlock(state.record.usbUnlock);
  $('usbKeyStatus').textContent = configured
    ? 'Hay un archivo llave activo. Crear otro dejará de aceptar el anterior.'
    : 'No hay ningún archivo llave activo para esta bóveda.';
  $('disableUsbKeyButton').classList.toggle('hidden', !configured);
  $('usbKeyDialog').showModal();
  $('usbMaster').focus();
  resetAutoLock();
}

function closeUsbKeyDialog() {
  $('usbKeyForm').reset();
  if ($('usbKeyDialog').open) $('usbKeyDialog').close();
  resetAutoLock();
}

async function createOrReplaceUsbKey(event) {
  event.preventDefault();
  const master = $('usbMaster').value;
  if (!master) return showNotice('Ingresá tu clave maestra para crear el archivo llave.', 'error');
  let secret;
  try {
    await verifyCurrentMaster(master);
    const metadata = state.index.vaults.find((vault) => vault.id === state.vaultId);
    if (!metadata) throw new Error('Bóveda no encontrada');
    const usbKeyVersion = metadata.usbKeyVersion + 1;
    const keyId = crypto.randomUUID();
    secret = randomDek();
    const secretKey = await importAesKey(secret);
    const usbUnlock = {
      keyId,
      ...(await wrapDek(secretKey, state.keyBytes, aad('usb-wrap', keyId))),
    };
    await persistCurrentRecord({ ...state.record, usbUnlock }, { usbKeyVersion });
    downloadJson(
      { format: USB_KEY_FORMAT, version: USB_KEY_VERSION, keyId, secret: base64FromBytes(secret) },
      `${safeFileName(state.vaultName)}-llave-v${usbKeyVersion}.json`,
    );
    closeUsbKeyDialog();
    showNotice(`Llave v${usbKeyVersion} creada. Ya funciona aquí; exportá la bóveda para que la nueva copia también la acepte.`);
  } catch (_) {
    showNotice('La clave maestra no es correcta o no pude crear el archivo llave.', 'error');
  } finally {
    secret?.fill(0);
  }
}

async function disableUsbKey() {
  const master = $('usbMaster').value;
  if (!master) return showNotice('Ingresá tu clave maestra para desactivar el archivo llave.', 'error');
  try {
    await verifyCurrentMaster(master);
    await persistCurrentRecord({ ...state.record, usbUnlock: null });
    closeUsbKeyDialog();
    showNotice('Archivo llave desactivado. Exportá una nueva copia para actualizar tu respaldo.');
  } catch (_) {
    showNotice('La clave maestra no es correcta o no pude desactivar el archivo llave.', 'error');
  }
}

function syncDeleteVaultConfirmation() {
  $('confirmDeleteVaultButton').disabled = $('deleteVaultConfirmation').value.trim() !== state.vaultName;
}

function openDeleteVaultDialog() {
  if (!state.vaultId || !state.vaultName) return;
  $('deleteVaultForm').reset();
  $('deleteVaultName').textContent = state.vaultName;
  syncDeleteVaultConfirmation();
  $('deleteVaultDialog').showModal();
  $('deleteVaultConfirmation').focus();
  resetAutoLock();
}

function closeDeleteVaultDialog() {
  $('deleteVaultForm').reset();
  if ($('deleteVaultDialog').open) $('deleteVaultDialog').close();
  resetAutoLock();
}

async function deleteCurrentVault(event) {
  event.preventDefault();
  if (!state.vaultId || $('deleteVaultConfirmation').value.trim() !== state.vaultName) {
    syncDeleteVaultConfirmation();
    return;
  }

  const deletedVaultId = state.vaultId;
  const deletedVaultName = state.vaultName;
  const remainingVaults = state.index.vaults.filter((vault) => vault.id !== deletedVaultId);
  const nextIndex = {
    ...state.index,
    activeVaultId: remainingVaults[0]?.id ?? null,
    vaults: remainingVaults,
  };

  try {
    await writeAndDeleteValues(
      [[INDEX_KEY, nextIndex]],
      [vaultRecordKey(deletedVaultId)],
    );
    state.index = nextIndex;
    closeDeleteVaultDialog();
    lockVault();
    showNotice(
      `Bóveda “${deletedVaultName}” borrada de este navegador. Las copias exportadas no se borraron.`,
    );
  } catch (_) {
    showNotice('No pude borrar la bóveda de este navegador.', 'error');
  }
}

function openMasterChange() {
  $('changeMasterForm').reset();
  $('changeMasterDialog').showModal();
  $('currentMaster').focus();
  resetAutoLock();
}

function closeMasterChange() {
  $('changeMasterForm').reset();
  $('changeMasterDialog').close();
  resetAutoLock();
}

async function changeMasterPassword(event) {
  event.preventDefault();
  if (!state.record || !state.vaultId || !state.key) return;

  const currentMaster = $('currentMaster').value;
  const newMaster = $('newMaster').value;
  const confirmNewMaster = $('confirmNewMaster').value;
  if (newMaster.length < 12) {
    return showNotice('La nueva clave debe tener al menos 12 caracteres.', 'error');
  }
  if (newMaster !== confirmNewMaster) {
    return showNotice('Las dos claves nuevas no coinciden.', 'error');
  }
  if (currentMaster === newMaster) {
    return showNotice('La nueva clave debe ser diferente de la actual.', 'error');
  }

  try {
    await verifyCurrentMaster(currentMaster);
    const salt = newSalt();
    const newPasswordKey = await deriveKey(newMaster, salt, PBKDF2_ITERATIONS);
    const passwordWrap = await wrapDek(newPasswordKey, state.keyBytes, aad('password-wrap'));
    const updatedAt = new Date().toISOString();
    const nextRecord = {
      ...state.record,
      salt: base64FromBytes(salt),
      iterations: PBKDF2_ITERATIONS,
      passwordWrap,
      updatedAt,
    };
    const nextIndex = updateVaultMetadata(
      state.index,
      state.vaultId,
      state.vaultName,
      updatedAt,
      { needsBackup: true },
    );
    await writeValues([
      [vaultRecordKey(state.vaultId), nextRecord],
      [INDEX_KEY, nextIndex],
    ]);
    state.record = nextRecord;
    state.index = nextIndex;
    updateBackupReminder();
    closeMasterChange();
    showNotice('Clave maestra actualizada. Exportá una nueva copia; las anteriores siguen usando la clave anterior.');
  } catch (_) {
    showNotice('La clave maestra actual no es correcta.', 'error');
  }
}

async function start() {
  applyTheme(loadTheme());
  $('setupForm').addEventListener('submit', createVault);
  $('unlockForm').addEventListener('submit', unlockVault);
  $('entryForm').addEventListener('submit', saveEntry);
  $('changeMasterForm').addEventListener('submit', changeMasterPassword);
  $('usbKeyForm').addEventListener('submit', createOrReplaceUsbKey);
  $('themeToggle').addEventListener('click', toggleTheme);

  $('generateButton').addEventListener('click', () => {
    const groups = selectedPasswordGroups();
    if (!groups.length) return showNotice('Elegí al menos un tipo de carácter.', 'error');
    $('password').value = randomPassword(groups);
    $('password').type = 'text';
    $('toggleEditorPassword').setAttribute('aria-label', 'Ocultar contraseña');
    resetAutoLock();
  });

  document.querySelectorAll('.character-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const isActive = button.getAttribute('aria-pressed') === 'true';
      if (isActive && selectedPasswordGroups().length === 1) {
        showNotice('La contraseña necesita al menos un tipo de carácter.', 'error');
        return;
      }
      button.setAttribute('aria-pressed', String(!isActive));
      resetAutoLock();
    });
  });

  $('toggleEditorPassword').addEventListener('click', () => {
    const input = $('password');
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    $('toggleEditorPassword').setAttribute(
      'aria-label',
      hidden ? 'Ocultar contraseña' : 'Mostrar contraseña',
    );
    resetAutoLock();
  });

  $('cancelEditButton').addEventListener('click', clearEditor);
  $('toggleOptionalFields').addEventListener('click', () => {
    const expanded = $('toggleOptionalFields').getAttribute('aria-expanded') === 'true';
    setOptionalFieldsExpanded(!expanded);
    resetAutoLock();
  });
  $('search').addEventListener('input', () => {
    renderEntries();
    resetAutoLock();
  });
  $('entries').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'copy') copyPassword(id, button);
    if (action === 'reveal') toggleEntryPassword(id, button);
    if (action === 'edit') editEntry(id);
    if (action === 'delete') deleteEntry(id);
  });

  $('lockButton').addEventListener('click', () => lockVault());
  $('switchVaultButton').addEventListener('click', () => lockVault());
  $('newVaultButton').addEventListener('click', () => showSetup(true));
  $('cancelSetupButton').addEventListener('click', () => {
    renderVaultSelect();
    setScreen('unlock');
  });
  $('vaultSelect').addEventListener('change', () => {
    state.index.activeVaultId = $('vaultSelect').value;
    $('unlockMaster').value = '';
    refreshUsbUnlockAvailability();
  });

  $('unlockUsbKeyButton').addEventListener('click', () => $('usbKeyInput').click());
  $('usbKeyInput').addEventListener('change', unlockWithUsbKey);

  $('changeMasterButton').addEventListener('click', openMasterChange);
  $('cancelMasterChange').addEventListener('click', closeMasterChange);
  $('changeMasterDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeMasterChange();
  });

  $('usbKeyButton').addEventListener('click', openUsbKeyDialog);
  $('cancelUsbKey').addEventListener('click', closeUsbKeyDialog);
  $('disableUsbKeyButton').addEventListener('click', disableUsbKey);
  $('usbKeyDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeUsbKeyDialog();
  });

  $('deleteVaultButton').addEventListener('click', openDeleteVaultDialog);
  $('deleteVaultForm').addEventListener('submit', deleteCurrentVault);
  $('deleteVaultConfirmation').addEventListener('input', syncDeleteVaultConfirmation);
  $('cancelDeleteVault').addEventListener('click', closeDeleteVaultDialog);
  $('deleteVaultDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDeleteVaultDialog();
  });

  $('exportButton').addEventListener('click', downloadBackup);
  $('importButton').addEventListener('click', () => $('importInput').click());
  $('showImportFromLock').addEventListener('click', () => $('importInput').click());
  $('showImportFromSetup').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', importBackup);
  ['click', 'keydown', 'touchstart'].forEach(
    (eventName) => document.addEventListener(eventName, resetAutoLock),
  );

  try {
    await loadVaultIndex();
    renderVaultSelect();
    if (state.index.vaults.length) {
      setScreen('unlock');
    } else {
      showSetup(false);
    }
  } catch (_) {
    state.index = emptyIndex();
    showSetup(false);
    showNotice('Este navegador no permite el almacenamiento local necesario.', 'error');
  }
}

start();
