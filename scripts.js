(() => {
'use strict';

const DB_NAME = 'pwm-local-vault';
const DB_VERSION = 1;
const STORE_NAME = 'vault';
const INDEX_KEY = 'vault-index';
const LEGACY_RECORD_KEY = 'current';
const VAULT_RECORD_PREFIX = 'vault:';
const PBKDF2_ITERATIONS = 600_000;
const AUTO_LOCK_MS = 15 * 60 * 1000;
const CLIPBOARD_CLEAR_MS = 20_000;
const THEME_STORAGE_KEY = 'pwm-theme';
const USB_KEY_FORMAT = 'pwm-usb-key';
const USB_KEY_VERSION = 1;
const USB_KEY_MAX_BYTES = 16 * 1024;
const DEK_BYTES = 32;
const GENERATED_PASSWORD_LENGTH = 20;
const HISTORY_LIMIT = 200;
const HOME_BACKGROUND_INTERVAL_MS = 10_000;
const HOME_BACKGROUNDS = Object.freeze([
  'home-niebla',
  'home-papel',
  'home-salvia',
  'home-arena',
  'home-cielo',
  'home-pizarra',
]);
const APPEARANCE_PRESETS = Object.freeze([
  { id: 'default', name: 'Predeterminado', group: 'Colores' },
  { id: 'color-niebla', name: 'Niebla', group: 'Colores' },
  { id: 'color-cielo', name: 'Cielo', group: 'Colores' },
  { id: 'color-salvia', name: 'Salvia', group: 'Colores' },
  { id: 'color-lavanda', name: 'Lavanda', group: 'Colores' },
  { id: 'color-arena', name: 'Arena', group: 'Colores' },
  { id: 'color-rosa', name: 'Rosa tenue', group: 'Colores' },
  { id: 'color-pizarra', name: 'Pizarra', group: 'Colores' },
  { id: 'color-grafito', name: 'Grafito', group: 'Colores' },
  { id: 'gradient-aurora', name: 'Aurora', group: 'Gradientes' },
  { id: 'gradient-brisa', name: 'Brisa marina', group: 'Gradientes' },
  { id: 'gradient-crepusculo', name: 'Crepúsculo', group: 'Gradientes' },
  { id: 'gradient-bosque', name: 'Bosque suave', group: 'Gradientes' },
  { id: 'gradient-lila', name: 'Lila', group: 'Gradientes' },
  { id: 'gradient-coral', name: 'Coral', group: 'Gradientes' },
  { id: 'gradient-nocturno', name: 'Noche azul', group: 'Gradientes' },
  { id: 'gradient-amanecer', name: 'Amanecer', group: 'Gradientes' },
  { id: 'gradient-menta', name: 'Menta', group: 'Gradientes' },
  { id: 'gradient-tinta', name: 'Tinta', group: 'Gradientes' },
  { id: 'pattern-cuadricula', name: 'Cuadrícula', group: 'Patrones' },
  { id: 'pattern-puntos', name: 'Puntos', group: 'Patrones' },
  { id: 'pattern-lineas', name: 'Líneas', group: 'Patrones' },
  { id: 'pattern-ondas', name: 'Ondas', group: 'Patrones' },
  { id: 'pattern-papel', name: 'Papel', group: 'Patrones' },
  { id: 'pattern-trama', name: 'Trama', group: 'Patrones' },
  { id: 'pattern-confeti', name: 'Confeti', group: 'Patrones' },
  { id: 'pattern-mosaico', name: 'Mosaico', group: 'Patrones' },
  { id: 'pattern-topografia', name: 'Topografía', group: 'Patrones' },
  { id: 'pattern-lunares', name: 'Lunares', group: 'Patrones' },
  { id: 'photo-montanas', name: 'Montañas serenas', group: 'Fotos' },
  { id: 'photo-oceano', name: 'Océano profundo', group: 'Fotos' },
  { id: 'photo-dunas', name: 'Dunas doradas', group: 'Fotos' },
  { id: 'photo-botanicas', name: 'Sombras botánicas', group: 'Fotos' },
  { id: 'photo-bosque', name: 'Bosque en niebla', group: 'Fotos' },
  { id: 'photo-cielo', name: 'Cielo nocturno', group: 'Fotos' },
]);
const APPEARANCE_PRESET_IDS = new Set(APPEARANCE_PRESETS.map((preset) => preset.id));
const HISTORY_TYPES = new Set([
  'vault-created',
  'vault-migrated',
  'credential-created',
  'credential-updated',
  'credential-deleted',
  'master-password-changed',
  'usb-key-created',
  'usb-key-disabled',
]);
const PASSWORD_CHARACTER_GROUPS = Object.freeze({
  uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lowercase: 'abcdefghijkmnopqrstuvwxyz',
  numbers: '23456789',
  symbols: '!@#$%&*+-_=?.',
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VAULT_AS_KEY_MESSAGE = 'Ese archivo es una bóveda, no una llave USB. Usá “Importar bóveda”.';
const KEY_AS_VAULT_MESSAGE = 'Ese archivo es una llave USB, no una bóveda. Usá “Importar llave”.';
const BACKUP_REMINDERS = Object.freeze({
  credentials: {
    title: 'Copia urgente requerida',
    text: 'Cambiaste contraseñas. Exportá la bóveda y guardá la copia nueva en tu USB ahora. Si perdés este navegador antes, podrías perder credenciales recientes.',
  },
  master: {
    title: 'Actualizá tu respaldo antes de continuar',
    text: 'Cambiaste la clave maestra. Es necesario exportar la bóveda a tu USB ahora: las copias previas sólo abrirán con la clave anterior.',
  },
  usb: {
    title: 'Es necesario exportar la bóveda ahora',
    text: 'Cambiaste la llave USB. Guardá una copia nueva en tu USB.',
    criticalText: 'Sin una copia nueva, tu llave actual no abrirá tus respaldos.',
  },
  migration: {
    title: 'Copia urgente requerida',
    text: 'La bóveda se actualizó. Exportá una copia nueva a tu USB para conservar un respaldo compatible.',
  },
});

const state = {
  key: null,
  keyBytes: null,
  entries: [],
  history: [],
  appearance: { version: 1, background: 'default' },
  appearanceDraft: null,
  homeBackground: null,
  homeBackgroundTimer: null,
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
  pendingBackupAction: null,
  leaveBackupReminderTimer: null,
  beforeUnloadWarningActive: false,
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

function normalizeAppearance(appearance) {
  const background = appearance && typeof appearance === 'object' && APPEARANCE_PRESET_IDS.has(appearance.background)
    ? appearance.background
    : 'default';
  return { version: 1, background };
}

function applyVaultBackground(appearance = state.appearance) {
  const background = normalizeAppearance(appearance).background;
  if (background === 'default') {
    delete document.documentElement.dataset.vaultBackground;
    return;
  }
  document.documentElement.dataset.vaultBackground = background;
}

function clearVaultBackground() {
  delete document.documentElement.dataset.vaultBackground;
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function nextHomeBackground() {
  const choices = HOME_BACKGROUNDS.filter((background) => background !== state.homeBackground);
  return choices[Math.floor(Math.random() * choices.length)] || HOME_BACKGROUNDS[0];
}

function applyHomeBackground(background) {
  if (!HOME_BACKGROUNDS.includes(background)) return;
  state.homeBackground = background;
  document.documentElement.dataset.homeBackground = background;
}

function startHomeBackgroundRotation() {
  if (state.homeBackgroundTimer) return;
  applyHomeBackground(nextHomeBackground());
  if (prefersReducedMotion()) return;
  state.homeBackgroundTimer = window.setInterval(() => {
    applyHomeBackground(nextHomeBackground());
  }, HOME_BACKGROUND_INTERVAL_MS);
}

function stopHomeBackgroundRotation() {
  window.clearInterval(state.homeBackgroundTimer);
  state.homeBackgroundTimer = null;
  delete document.documentElement.dataset.homeBackground;
}

function renderAppearanceOptions() {
  const container = $('appearanceOptions');
  emptyElement(container);
  const groups = [...new Set(APPEARANCE_PRESETS.map((preset) => preset.group))];
  groups.forEach((group) => {
    const section = document.createElement('section');
    section.className = 'appearance-group';
    const title = document.createElement('h3');
    title.textContent = group;
    const choices = document.createElement('div');
    choices.className = 'appearance-choice-grid';
    APPEARANCE_PRESETS.filter((preset) => preset.group === group).forEach((preset) => {
      const button = document.createElement('button');
      button.className = 'appearance-option';
      button.type = 'button';
      button.dataset.background = preset.id;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', 'false');
      button.innerHTML = `<span class="appearance-swatch" data-background="${preset.id}" aria-hidden="true"></span><span>${preset.name}</span>`;
      choices.append(button);
    });
    section.append(title, choices);
    container.append(section);
  });
}

function setAppearanceSelection(background) {
  const safeBackground = APPEARANCE_PRESET_IDS.has(background) ? background : 'default';
  state.appearanceDraft = { version: 1, background: safeBackground };
  $('appearanceOptions').querySelectorAll('.appearance-option').forEach((button) => {
    const selected = button.dataset.background === safeBackground;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
  applyVaultBackground(state.appearanceDraft);
}

function openAppearanceDialog() {
  if (!state.key || !state.vaultId) return;
  state.appearanceDraft = normalizeAppearance(state.appearance);
  renderAppearanceOptions();
  setAppearanceSelection(state.appearanceDraft.background);
  $('appearanceDialog').showModal();
  $('appearanceOptions').querySelector('.appearance-option.selected')?.focus();
  resetAutoLock();
}

function closeAppearanceDialog(restore = true) {
  if (restore) applyVaultBackground(state.appearance);
  state.appearanceDraft = null;
  if ($('appearanceDialog').open) $('appearanceDialog').close();
}

async function saveAppearance() {
  if (!state.key || !state.record || state.record.version !== 2 || !state.vaultId) {
    throw new Error('Bóveda bloqueada');
  }
  const encrypted = await encryptPayloadV2(state.key, {
    entries: state.entries,
    history: state.history,
    appearance: state.appearance,
  });
  const record = { ...state.record, ...encrypted, updatedAt: new Date().toISOString() };
  await writeValues([[vaultRecordKey(state.vaultId), record]]);
  state.record = record;
}

async function applyAppearance() {
  const previous = state.appearance;
  const next = normalizeAppearance(state.appearanceDraft);
  state.appearance = next;
  applyVaultBackground(next);
  $('applyAppearanceButton').disabled = true;
  try {
    await saveAppearance();
    closeAppearanceDialog(false);
    showNotice('Apariencia guardada para esta bóveda.');
  } catch (_) {
    state.appearance = previous;
    applyVaultBackground(previous);
    showNotice('No se pudo guardar la apariencia.', 'error');
  } finally {
    $('applyAppearanceButton').disabled = false;
  }
}

function setScreen(name) {
  $('setupScreen').classList.toggle('hidden', name !== 'setup');
  $('unlockScreen').classList.toggle('hidden', name !== 'unlock');
  $('vaultScreen').classList.toggle('hidden', name !== 'vault');
  $('appearanceButton').classList.toggle('hidden', name !== 'vault' || !state.key);
  if (name === 'vault') stopHomeBackgroundRotation();
  else {
    clearVaultBackground();
    startHomeBackgroundRotation();
  }
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
    const backupReason = needsBackup
      ? (BACKUP_REMINDERS[vault.backupReason] ? vault.backupReason : 'credentials')
      : null;
    if (
      backupVersion !== vault.backupVersion
      || usbKeyVersion !== vault.usbKeyVersion
      || backupReason !== vault.backupReason
      || needsBackup !== vault.needsBackup
    ) changed = true;
    return {
      ...vault,
      uid,
      backupVersion,
      usbKeyVersion,
      backupReason,
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
      backupReason: null,
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

function sortedVaults() {
  return state.index.vaults
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function closeVaultPicker() {
  $('vaultSelectList').classList.add('hidden');
  $('vaultSelectButton').setAttribute('aria-expanded', 'false');
}

function renderVaultPicker(selectedId) {
  const button = $('vaultSelectButton');
  const buttonText = $('vaultSelectButtonText');
  const list = $('vaultSelectList');
  const vaults = sortedVaults();
  const selectedVault = vaults.find((vault) => vault.id === selectedId);
  list.replaceChildren();
  button.disabled = !selectedVault;
  buttonText.textContent = selectedVault?.name || 'Elegí una bóveda';
  closeVaultPicker();

  vaults.forEach((vault) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'vault-select-option';
    option.dataset.vaultId = vault.id;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(vault.id === selectedId));
    option.textContent = vault.name;
    list.append(option);
  });
}

function openVaultPicker(focus = 'selected') {
  const list = $('vaultSelectList');
  if (!$('vaultSelect').value) return;
  list.classList.remove('hidden');
  $('vaultSelectButton').setAttribute('aria-expanded', 'true');
  const options = [...list.querySelectorAll('.vault-select-option')];
  const target = focus === 'first'
    ? options[0]
    : focus === 'last'
      ? options[options.length - 1]
      : list.querySelector('[aria-selected="true"]');
  target?.focus();
}

function selectVault(vaultId) {
  const vault = state.index.vaults.find((item) => item.id === vaultId);
  if (!vault) return;
  $('vaultSelect').value = vaultId;
  state.index.activeVaultId = vaultId;
  setMasterUnlockExpanded(false);
  renderVaultPicker(vaultId);
  refreshUsbUnlockAvailability();
  resetAutoLock();
}

function moveVaultPickerFocus(event) {
  const options = [...$('vaultSelectList').querySelectorAll('.vault-select-option')];
  const currentIndex = options.indexOf(document.activeElement);
  let nextIndex = currentIndex;
  if (event.key === 'ArrowDown') nextIndex = Math.min(currentIndex + 1, options.length - 1);
  if (event.key === 'ArrowUp') nextIndex = Math.max(currentIndex - 1, 0);
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = options.length - 1;
  if (nextIndex !== currentIndex) {
    event.preventDefault();
    options[nextIndex]?.focus();
  }
}

function renderVaultSelect(preferredVaultId = state.index.activeVaultId) {
  const select = $('vaultSelect');
  const selectedId = state.index.vaults.some((vault) => vault.id === preferredVaultId)
    ? preferredVaultId
    : state.index.vaults[0]?.id;
  select.value = selectedId || '';
  renderVaultPicker(selectedId);
  refreshUsbUnlockAvailability();
  updateBackupReminder();
}

function refreshUsbUnlockAvailability() {
  const button = $('unlockUsbKeyButton');
  const available = state.index.vaults.length > 0;
  button.classList.toggle('hidden', !available);
}

function setMasterUnlockExpanded(expanded, focus = false) {
  $('masterUnlockFields').classList.toggle('hidden', !expanded);
  $('toggleMasterUnlock').setAttribute('aria-expanded', String(expanded));
  $('masterUnlockToggleText').textContent = expanded
    ? 'Ocultar clave maestra'
    : 'Usar clave maestra';
  if (!expanded) $('unlockMaster').value = '';
  if (expanded && focus) $('unlockMaster').focus();
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
  const reminder = BACKUP_REMINDERS[metadata?.backupReason] || BACKUP_REMINDERS.credentials;
  $('backupReminder').classList.toggle('hidden', !needsBackup);
  $('exportButton').classList.toggle('backup-due', needsBackup);
  if (needsBackup) {
    $('backupReminderTitle').textContent = reminder.title;
    const text = $('backupReminderText');
    text.replaceChildren();
    const lead = document.createElement('span');
    lead.textContent = reminder.text;
    text.append(lead);
    if (reminder.criticalText) {
      const critical = document.createElement('strong');
      critical.className = 'backup-reminder-critical';
      critical.textContent = reminder.criticalText;
      text.append(critical);
    }
    $('exportButton').setAttribute('aria-describedby', 'backupReminder');
  } else {
    $('exportButton').removeAttribute('aria-describedby');
  }
  syncBeforeUnloadWarning();
}

function hasPendingBackups() {
  return state.index.vaults.some((vault) => vault.needsBackup);
}

function activeVaultNeedsBackup() {
  const metadata = state.index.vaults.find((vault) => vault.id === state.vaultId);
  return Boolean(state.vaultId && metadata?.needsBackup);
}

function clearLeaveBackupReminder() {
  window.clearTimeout(state.leaveBackupReminderTimer);
  state.leaveBackupReminderTimer = null;
}

function warnBeforeLeavingWithPendingBackup(event) {
  if (!hasPendingBackups()) return;
  clearLeaveBackupReminder();
  state.leaveBackupReminderTimer = window.setTimeout(() => {
    state.leaveBackupReminderTimer = null;
    if (!document.hidden && hasPendingBackups()) {
      window.alert('Por favor, respaldá tu bóveda en el USB antes de irte. Esto evita que puedas perder el acceso por accidente.');
    }
  }, 0);
  event.preventDefault();
  event.returnValue = '';
}

function syncBeforeUnloadWarning() {
  const shouldWarn = hasPendingBackups();
  if (shouldWarn && !state.beforeUnloadWarningActive) {
    window.addEventListener('beforeunload', warnBeforeLeavingWithPendingBackup);
    state.beforeUnloadWarningActive = true;
  }
  if (!shouldWarn && state.beforeUnloadWarningActive) {
    window.removeEventListener('beforeunload', warnBeforeLeavingWithPendingBackup);
    state.beforeUnloadWarningActive = false;
    clearLeaveBackupReminder();
  }
}

function closePendingBackupDialog() {
  state.pendingBackupAction = null;
  if ($('pendingBackupDialog').open) $('pendingBackupDialog').close();
}

function requestBackupBefore(action) {
  if (!activeVaultNeedsBackup()) return action();
  state.pendingBackupAction = action;
  $('pendingBackupDialog').showModal();
  $('exportThenContinueButton').focus();
}

function continueWithoutBackup() {
  const action = state.pendingBackupAction;
  closePendingBackupDialog();
  action?.();
}

async function exportThenContinue() {
  const button = $('exportThenContinueButton');
  button.disabled = true;
  try {
    await downloadBackup();
    if (!activeVaultNeedsBackup()) {
      const action = state.pendingBackupAction;
      closePendingBackupDialog();
      action?.();
    }
  } finally {
    button.disabled = false;
  }
}

async function saveVault(backupReason = 'credentials', historyEvent = null) {
  if (!state.key || !state.keyBytes || !state.record || state.record.version !== 2 || !state.vaultId) {
    throw new Error('Bóveda bloqueada');
  }
  const nextHistory = historyEvent
    ? historyWithEvent(state.history, historyEvent)
    : state.history;
  const encrypted = await encryptPayloadV2(state.key, {
    entries: state.entries,
    history: nextHistory,
    appearance: state.appearance,
  });
  const updatedAt = new Date().toISOString();
  const nextRecord = { ...state.record, ...encrypted, updatedAt };
  const nextIndex = updateVaultMetadata(
    state.index,
    state.vaultId,
    state.vaultName,
    updatedAt,
    { needsBackup: true, backupReason },
  );
  await writeValues([
    [vaultRecordKey(state.vaultId), nextRecord],
    [INDEX_KEY, nextIndex],
  ]);
  state.record = nextRecord;
  state.history = nextHistory;
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

function normalizeHistoryEvent(event) {
  if (!event || typeof event !== 'object' || !HISTORY_TYPES.has(event.type)) return null;
  const date = new Date(event.createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return {
    id: typeof event.id === 'string' && event.id ? event.id : crypto.randomUUID(),
    type: event.type,
    detail: String(event.detail ?? '').trim().slice(0, 120),
    createdAt: date.toISOString(),
  };
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map(normalizeHistoryEvent)
    .filter(Boolean)
    .slice(-HISTORY_LIMIT);
}

function createHistoryEvent(type, detail = '') {
  return normalizeHistoryEvent({
    id: crypto.randomUUID(),
    type,
    detail,
    createdAt: new Date().toISOString(),
  });
}

function historyWithEvent(history, event) {
  const normalizedEvent = normalizeHistoryEvent(event);
  if (!normalizedEvent) return normalizeHistory(history);
  return [...normalizeHistory(history), normalizedEvent].slice(-HISTORY_LIMIT);
}

function historyEventLabel(event) {
  const detail = event.detail ? ` — ${event.detail}` : '';
  switch (event.type) {
    case 'vault-created': return 'Bóveda creada';
    case 'vault-migrated': return 'Bóveda actualizada al formato actual';
    case 'credential-created': return `Contraseña agregada${detail}`;
    case 'credential-updated': return `Contraseña actualizada${detail}`;
    case 'credential-deleted': return `Contraseña eliminada${detail}`;
    case 'master-password-changed': return 'Clave maestra actualizada';
    case 'usb-key-created': return event.detail ? `Llave USB ${event.detail} creada` : 'Llave USB creada';
    case 'usb-key-disabled': return 'Llave USB desactivada';
    default: return 'Cambio en la bóveda';
  }
}

function renderHistory() {
  const list = $('historyList');
  list.replaceChildren();
  if (!state.history.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'Esta bóveda todavía no tiene movimientos registrados. Los próximos cambios aparecerán acá.';
    list.append(empty);
    return;
  }

  const formatter = new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  [...state.history].reverse().forEach((event) => {
    const item = document.createElement('article');
    item.className = 'history-item';
    const marker = document.createElement('span');
    marker.className = 'history-marker';
    marker.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    copy.className = 'history-copy';
    const title = document.createElement('strong');
    title.textContent = historyEventLabel(event);
    const time = document.createElement('time');
    time.dateTime = event.createdAt;
    time.textContent = formatter.format(new Date(event.createdAt));
    copy.append(title, time);
    item.append(marker, copy);
    list.append(item);
  });
}

function openHistoryDialog() {
  if (!state.vaultId) return;
  renderHistory();
  $('historyDialog').showModal();
  $('closeHistoryButton').focus();
  resetAutoLock();
}

function closeHistoryDialog() {
  if ($('historyDialog').open) $('historyDialog').close();
  resetAutoLock();
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

function clearEntryElements() {
  $('entries').querySelectorAll('.masked-password').forEach((password) => {
    password.textContent = '';
    password.removeAttribute('data-value');
    password.removeAttribute('data-revealed');
  });
  emptyElement($('entries'));
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
  clearEntryElements();
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

function clearVaultDom() {
  clearEntryElements();
  emptyElement($('historyList'));
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
    const initialHistory = [
      createHistoryEvent('vault-created'),
    ];
    const created = await createV2Record(master, {
      entries: [],
      history: initialHistory,
      appearance: { version: 1, background: 'default' },
    }, createdAt);
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
          backupReason: null,
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
    state.history = initialHistory;
    state.appearance = { version: 1, background: 'default' };
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
      payload = {
        entries: payload.entries,
        history: historyWithEvent(
          payload.history,
          createHistoryEvent('vault-migrated'),
        ),
        appearance: normalizeAppearance(payload.appearance),
      };
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
      migrated ? { needsBackup: true, backupReason: 'migration' } : {},
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
  state.history = normalizeHistory(payload.history);
  state.appearance = normalizeAppearance(payload.appearance);
  state.record = record;
  state.vaultId = vaultId;
  state.vaultName = vaultName;
  state.index = index;
  $('unlockForm').reset();
  setMasterUnlockExpanded(false);
  clearEditor();
  setScreen('vault');
  applyVaultBackground(state.appearance);
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
  if ($('pendingBackupDialog').open) closePendingBackupDialog();
  if ($('appearanceDialog').open) closeAppearanceDialog(false);
  if ($('historyDialog').open) $('historyDialog').close();
  clearVaultDom();
  state.key = null;
  if (state.keyBytes) state.keyBytes.fill(0);
  state.keyBytes = null;
  state.entries = [];
  state.history = [];
  state.appearance = { version: 1, background: 'default' };
  state.appearanceDraft = null;
  clearVaultBackground();
  state.record = null;
  state.vaultId = null;
  state.vaultName = '';
  clearEditor();
  $('search').value = '';
  $('unlockForm').reset();
  setMasterUnlockExpanded(false);
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

  const previousEntries = state.entries;
  try {
    state.entries = previous
      ? state.entries.map((item) => (item.id === id ? entry : item))
      : [...state.entries, entry];
    await saveVault(
      'credentials',
      createHistoryEvent(
        previous ? 'credential-updated' : 'credential-created',
        service,
      ),
    );
    clearEditor();
    renderEntries();
    showNotice(previous
      ? 'Cambios guardados. Hacé una copia urgente en tu USB: si perdés este navegador, podrías recuperar una versión anterior.'
      : 'Contraseña guardada. Hacé una copia urgente en tu USB: si perdés este navegador, podrías perder esta credencial.');
  } catch (_) {
    state.entries = previousEntries;
    showNotice('No se pudo guardar el cambio.', 'error');
  }
}

async function deleteEntry(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry || !window.confirm(`¿Eliminar la contraseña de ${entry.service}?`)) return;
  const previousEntries = state.entries;
  try {
    state.entries = state.entries.filter((item) => item.id !== id);
    await saveVault(
      'credentials',
      createHistoryEvent('credential-deleted', entry.service),
    );
    if ($('entryId').value === id) clearEditor();
    renderEntries();
    showNotice('Contraseña eliminada. Actualizá la copia en tu USB ahora; si perdés este navegador, un respaldo anterior todavía podría contenerla.');
  } catch (_) {
    state.entries = previousEntries;
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
      { backupVersion, backupReason: null, needsBackup: false },
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
      backupReason: null,
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

async function persistCurrentRecord(nextRecord, metadataUpdates = {}, historyEvent = null) {
  const nextHistory = historyEvent
    ? historyWithEvent(state.history, historyEvent)
    : state.history;
  const encrypted = await encryptPayloadV2(state.key, {
    entries: state.entries,
    history: nextHistory,
    appearance: state.appearance,
  });
  const updatedAt = new Date().toISOString();
  const record = { ...nextRecord, ...encrypted, updatedAt };
  const nextIndex = updateVaultMetadata(
    state.index,
    state.vaultId,
    state.vaultName,
    updatedAt,
    {
      ...metadataUpdates,
      backupReason: metadataUpdates.backupReason || 'usb',
      needsBackup: true,
    },
  );
  await writeValues([
    [vaultRecordKey(state.vaultId), record],
    [INDEX_KEY, nextIndex],
  ]);
  state.record = record;
  state.history = nextHistory;
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
    await persistCurrentRecord(
      { ...state.record, usbUnlock },
      { usbKeyVersion, backupReason: 'usb' },
      createHistoryEvent('usb-key-created', `v${usbKeyVersion}`),
    );
    downloadJson(
      { format: USB_KEY_FORMAT, version: USB_KEY_VERSION, keyId, secret: base64FromBytes(secret) },
      `${safeFileName(state.vaultName)}-llave-v${usbKeyVersion}.json`,
    );
    closeUsbKeyDialog();
    showNotice(`Llave v${usbKeyVersion} creada. Es necesario exportar la bóveda a tu USB ahora: sin una copia nueva, esta llave no abrirá tus respaldos.`);
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
    await persistCurrentRecord(
      { ...state.record, usbUnlock: null },
      {},
      createHistoryEvent('usb-key-disabled'),
    );
    closeUsbKeyDialog();
    showNotice('Llave USB desactivada. Exportá la bóveda a tu USB ahora para que el respaldo refleje este cambio.');
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
    const nextHistory = historyWithEvent(
      state.history,
      createHistoryEvent('master-password-changed'),
    );
    const encrypted = await encryptPayloadV2(state.key, {
      entries: state.entries,
      history: nextHistory,
      appearance: state.appearance,
    });
    const updatedAt = new Date().toISOString();
    const nextRecord = {
      ...state.record,
      salt: base64FromBytes(salt),
      iterations: PBKDF2_ITERATIONS,
      passwordWrap,
      ...encrypted,
      updatedAt,
    };
    const nextIndex = updateVaultMetadata(
      state.index,
      state.vaultId,
      state.vaultName,
      updatedAt,
      { needsBackup: true, backupReason: 'master' },
    );
    await writeValues([
      [vaultRecordKey(state.vaultId), nextRecord],
      [INDEX_KEY, nextIndex],
    ]);
    state.record = nextRecord;
    state.history = nextHistory;
    state.index = nextIndex;
    updateBackupReminder();
    closeMasterChange();
    showNotice('Clave maestra actualizada. Es necesario exportar la bóveda a tu USB ahora: las copias previas sólo abrirán con la clave anterior.');
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
  $('appearanceButton').addEventListener('click', openAppearanceDialog);
  $('appearanceOptions').addEventListener('click', (event) => {
    const option = event.target.closest('.appearance-option');
    if (option) setAppearanceSelection(option.dataset.background);
  });
  $('appearanceOptions').addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = [...$('appearanceOptions').querySelectorAll('.appearance-option')];
    const currentIndex = options.indexOf(event.target.closest('.appearance-option'));
    if (currentIndex < 0) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (currentIndex + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + options.length) % options.length;
    const next = options[nextIndex];
    setAppearanceSelection(next.dataset.background);
    next.focus();
  });
  $('cancelAppearanceButton').addEventListener('click', () => closeAppearanceDialog());
  $('applyAppearanceButton').addEventListener('click', applyAppearance);
  $('appearanceDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeAppearanceDialog();
  });

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

  $('lockButton').addEventListener('click', () => requestBackupBefore(() => lockVault()));
  $('homeLink').addEventListener('click', (event) => {
    if (!activeVaultNeedsBackup()) return;
    event.preventDefault();
    requestBackupBefore(() => window.location.assign($('homeLink').href));
  });
  $('historyButton').addEventListener('click', openHistoryDialog);
  $('closeHistoryButton').addEventListener('click', closeHistoryDialog);
  $('historyDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeHistoryDialog();
  });
  $('newVaultButton').addEventListener('click', () => showSetup(true));
  $('cancelSetupButton').addEventListener('click', () => {
    renderVaultSelect();
    setScreen('unlock');
  });
  $('vaultSelect').addEventListener('change', () => {
    selectVault($('vaultSelect').value);
  });
  $('vaultSelectButton').addEventListener('click', () => {
    const expanded = $('vaultSelectButton').getAttribute('aria-expanded') === 'true';
    if (expanded) {
      closeVaultPicker();
      $('vaultSelectButton').focus();
    } else {
      openVaultPicker();
    }
    resetAutoLock();
  });
  $('vaultSelectButton').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openVaultPicker('first');
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      openVaultPicker('last');
    }
  });
  $('vaultSelectList').addEventListener('click', (event) => {
    const option = event.target.closest('.vault-select-option');
    if (option) selectVault(option.dataset.vaultId);
  });
  $('vaultSelectList').addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) moveVaultPickerFocus(event);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeVaultPicker();
      $('vaultSelectButton').focus();
    }
  });
  $('vaultSelectList').addEventListener('focusout', (event) => {
    if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== $('vaultSelectButton')) {
      closeVaultPicker();
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.vault-picker')) closeVaultPicker();
  });

  $('toggleMasterUnlock').addEventListener('click', () => {
    const expanded = $('toggleMasterUnlock').getAttribute('aria-expanded') === 'true';
    setMasterUnlockExpanded(!expanded, !expanded);
    resetAutoLock();
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

  $('deleteVaultButton').addEventListener('click', () => requestBackupBefore(openDeleteVaultDialog));
  $('deleteVaultForm').addEventListener('submit', deleteCurrentVault);
  $('deleteVaultConfirmation').addEventListener('input', syncDeleteVaultConfirmation);
  $('cancelDeleteVault').addEventListener('click', closeDeleteVaultDialog);
  $('deleteVaultDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDeleteVaultDialog();
  });

  $('continueWithoutBackupButton').addEventListener('click', continueWithoutBackup);
  $('exportThenContinueButton').addEventListener('click', exportThenContinue);
  $('pendingBackupDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closePendingBackupDialog();
  });

  $('exportButton').addEventListener('click', downloadBackup);
  $('importButton').addEventListener('click', () => $('importInput').click());
  $('showImportFromLock').addEventListener('click', () => $('importInput').click());
  $('showImportFromSetup').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', importBackup);
  window.addEventListener('pagehide', clearLeaveBackupReminder);
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
})();
