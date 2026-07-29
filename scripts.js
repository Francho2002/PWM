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

const state = {
  key: null,
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
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
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

async function encryptPayload(key, payload) {
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

async function decryptPayload(key, record) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesFromBase64(record.iv) },
    key,
    bytesFromBase64(record.ciphertext),
  );
  const payload = JSON.parse(decoder.decode(plaintext));
  if (!Array.isArray(payload.entries)) throw new Error('Formato de bóveda inválido');
  return payload;
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
  const required = ['format', 'version', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext'];
  if (!record || typeof record !== 'object' || record.format !== 'pwm-local-vault' || record.version !== 1) return false;
  if (!required.every((field) => Object.hasOwn(record, field))) return false;
  return record.kdf === 'PBKDF2-SHA-256'
    && record.iterations === PBKDF2_ITERATIONS
    && ['salt', 'iv', 'ciphertext'].every(
      (field) => typeof record[field] === 'string' && record[field].length > 0,
    );
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

async function loadVaultIndex() {
  const storedIndex = await readValue(INDEX_KEY);
  if (validateVaultIndex(storedIndex)) {
    state.index = storedIndex;
    if (!state.index.vaults.some((vault) => vault.id === state.index.activeVaultId)) {
      state.index.activeVaultId = state.index.vaults[0]?.id ?? null;
      await writeValues([[INDEX_KEY, state.index]]);
    }
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
      name: 'Mi bóveda',
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

function uniqueVaultName(preferredName) {
  const base = String(preferredName || 'Bóveda importada').trim().slice(0, 60) || 'Bóveda importada';
  if (!vaultNameExists(base)) return base;
  let counter = 2;
  while (vaultNameExists(`${base} (${counter})`)) counter += 1;
  return `${base} (${counter})`;
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
}

function updateVaultMetadata(index, vaultId, name, updatedAt) {
  return {
    ...index,
    activeVaultId: vaultId,
    vaults: index.vaults.map((vault) => (
      vault.id === vaultId ? { ...vault, name, updatedAt } : vault
    )),
  };
}

async function saveVault() {
  if (!state.key || !state.record || !state.vaultId) throw new Error('Bóveda bloqueada');
  const encrypted = await encryptPayload(state.key, { entries: state.entries });
  const updatedAt = new Date().toISOString();
  const nextRecord = { ...state.record, ...encrypted, updatedAt };
  const nextIndex = updateVaultMetadata(
    state.index,
    state.vaultId,
    state.vaultName,
    updatedAt,
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

function randomPassword(length) {
  const groups = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%&*+-_=?.',
  ];
  const characters = groups.join('');
  const result = groups.map((group) => secureCharacter(group));
  while (result.length < length) result.push(secureCharacter(characters));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = secureIndex(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result.join('');
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

function createAction(label, action, id, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = danger ? 'card-button danger' : 'card-button';
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
    createAction('Copiar', 'copy', entry.id),
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

function clearEditor() {
  $('entryForm').reset();
  $('entryId').value = '';
  $('passwordLength').value = '20';
  $('editorTitle').textContent = 'Agregar contraseña';
  $('saveButtonText').textContent = 'Guardar en la bóveda';
  $('cancelEditButton').classList.add('hidden');
  $('password').type = 'password';
  $('toggleEditorPassword').setAttribute('aria-label', 'Mostrar contraseña');
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
  $('editorTitle').textContent = 'Editar contraseña';
  $('saveButtonText').textContent = 'Guardar cambios';
  $('cancelEditButton').classList.remove('hidden');
  $('service').focus();
  resetAutoLock();
}

async function copyPassword(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  try {
    await navigator.clipboard.writeText(entry.password);
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

  try {
    const vaultId = crypto.randomUUID();
    const salt = newSalt();
    const key = await deriveKey(master, salt, PBKDF2_ITERATIONS);
    const createdAt = new Date().toISOString();
    const recordBase = {
      format: 'pwm-local-vault',
      version: 1,
      kdf: 'PBKDF2-SHA-256',
      iterations: PBKDF2_ITERATIONS,
      salt: base64FromBytes(salt),
      createdAt,
    };
    const encrypted = await encryptPayload(key, { entries: [] });
    const record = { ...recordBase, ...encrypted, updatedAt: createdAt };
    const nextIndex = {
      ...state.index,
      activeVaultId: vaultId,
      vaults: [
        ...state.index.vaults,
        { id: vaultId, name: vaultName, createdAt, updatedAt: createdAt },
      ],
    };
    await writeValues([
      [vaultRecordKey(vaultId), record],
      [INDEX_KEY, nextIndex],
    ]);

    state.key = key;
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
    showNotice('No pude crear la bóveda en este navegador.', 'error');
  }
}

async function unlockVault(event) {
  event.preventDefault();
  const vaultId = $('vaultSelect').value;
  const master = $('unlockMaster').value;
  const metadata = state.index.vaults.find((vault) => vault.id === vaultId);
  if (!vaultId || !metadata || !master) return;

  try {
    const record = await readValue(vaultRecordKey(vaultId));
    if (!validateVaultRecord(record)) throw new Error('No existe una bóveda válida');
    const key = await deriveKey(master, bytesFromBase64(record.salt), record.iterations);
    const payload = await decryptPayload(key, record);
    const nextIndex = { ...state.index, activeVaultId: vaultId };
    await writeValues([[INDEX_KEY, nextIndex]]);

    state.key = key;
    state.entries = payload.entries.map(normalizeEntry);
    state.record = record;
    state.vaultId = vaultId;
    state.vaultName = metadata.name;
    state.index = nextIndex;
    $('unlockForm').reset();
    clearEditor();
    setScreen('vault');
    renderEntries();
    resetAutoLock();
    showNotice(`Bóveda “${metadata.name}” desbloqueada.`);
  } catch (_) {
    showNotice('La clave maestra no es correcta o la bóveda está dañada.', 'error');
  }
}

function lockVault(expired = false) {
  window.clearTimeout(state.autoLockTimer);
  if ($('changeMasterDialog').open) {
    $('changeMasterForm').reset();
    $('changeMasterDialog').close();
  }
  state.key = null;
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
    showNotice(previous ? 'Cambios guardados.' : 'Contraseña guardada en la bóveda.');
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
    showNotice('Contraseña eliminada.');
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

function downloadBackup() {
  if (!state.record || !state.vaultId) return;
  const backup = {
    format: 'pwm-vault-backup',
    version: 2,
    name: state.vaultName,
    exportedAt: new Date().toISOString(),
    vault: state.record,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(state.vaultName)}-${new Date().toISOString().slice(0, 10)}.pwm.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  showNotice(`Copia cifrada de “${state.vaultName}” descargada.`);
  resetAutoLock();
}

function extractBackup(value, fileName) {
  if (validateVaultRecord(value)) {
    return {
      name: fileName.replace(/(\.pwm)?\.json$/i, '') || 'Bóveda importada',
      record: value,
    };
  }
  if (
    value
    && value.format === 'pwm-vault-backup'
    && value.version === 2
    && validateVaultRecord(value.vault)
  ) {
    return {
      name: typeof value.name === 'string' ? value.name : 'Bóveda importada',
      record: value.vault,
    };
  }
  throw new Error('Formato no válido');
}

async function importBackup(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    const backup = extractBackup(parsed, file.name);
    const vaultId = crypto.randomUUID();
    const vaultName = uniqueVaultName(backup.name);
    const createdAt = backup.record.createdAt || new Date().toISOString();
    const metadata = {
      id: vaultId,
      name: vaultName,
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
    showNotice(`“${vaultName}” se importó como una bóveda nueva. No se reemplazó ninguna.`);
  } catch (_) {
    showNotice('No pude leer esa copia cifrada.', 'error');
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
    const verificationKey = await deriveKey(
      currentMaster,
      bytesFromBase64(state.record.salt),
      state.record.iterations,
    );
    await decryptPayload(verificationKey, state.record);

    const salt = newSalt();
    const nextKey = await deriveKey(newMaster, salt, PBKDF2_ITERATIONS);
    const encrypted = await encryptPayload(nextKey, { entries: state.entries });
    const updatedAt = new Date().toISOString();
    const nextRecord = {
      ...state.record,
      ...encrypted,
      salt: base64FromBytes(salt),
      iterations: PBKDF2_ITERATIONS,
      updatedAt,
    };
    const nextIndex = updateVaultMetadata(
      state.index,
      state.vaultId,
      state.vaultName,
      updatedAt,
    );
    await writeValues([
      [vaultRecordKey(state.vaultId), nextRecord],
      [INDEX_KEY, nextIndex],
    ]);
    state.key = nextKey;
    state.record = nextRecord;
    state.index = nextIndex;
    closeMasterChange();
    showNotice('Clave maestra actualizada. Las copias anteriores siguen usando la clave anterior.');
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
  $('themeToggle').addEventListener('click', toggleTheme);

  $('generateButton').addEventListener('click', () => {
    const length = Math.max(16, Math.min(64, Number($('passwordLength').value) || 20));
    $('passwordLength').value = String(length);
    $('password').value = randomPassword(length);
    $('password').type = 'text';
    $('toggleEditorPassword').setAttribute('aria-label', 'Ocultar contraseña');
    resetAutoLock();
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
  $('search').addEventListener('input', () => {
    renderEntries();
    resetAutoLock();
  });
  $('entries').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'copy') copyPassword(id);
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
  });

  $('changeMasterButton').addEventListener('click', openMasterChange);
  $('cancelMasterChange').addEventListener('click', closeMasterChange);
  $('changeMasterDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeMasterChange();
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
