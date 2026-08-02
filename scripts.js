(() => {
'use strict';

const DB_NAME = 'pwm-local-vault';
const DB_VERSION = 1;
const STORE_NAME = 'vault';
const INDEX_KEY = 'vault-index';
const LEGACY_RECORD_KEY = 'current';
const VAULT_RECORD_PREFIX = 'vault:';
const SYNC_CHECKPOINT_PREFIX = '__pwm_internal:sync-checkpoint:';
const PBKDF2_ITERATIONS = 600_000;
const AUTO_LOCK_MS = 15 * 60 * 1000;
const CLIPBOARD_CLEAR_MS = 20_000;
const THEME_STORAGE_KEY = 'pwm-theme';
const USB_KEY_FORMAT = 'pwm-usb-key';
const USB_KEY_VERSION = 1;
const USB_KEY_MAX_BYTES = 16 * 1024;
const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
const DEK_BYTES = 32;
const GENERATED_PASSWORD_LENGTH = 20;
const HISTORY_LIMIT = 200;
const SYNC_PAYLOAD_VERSION = 1;
const HOME_BACKGROUND_INTERVAL_MS = 10_000;
// El índice de bóvedas también es compartido: una única exclusión para todo el
// origen evita que dos pestañas escriban índices desde snapshots viejos.
const VAULT_ACCESS_LOCK_NAME = 'pwm-vault-open';
// Registro interno: nunca forma parte del índice ni de una bóveda exportada.
// IndexedDB serializa las transacciones readwrite de este store, por lo que es
// la autoridad atómica cuando Web Locks no está disponible.
const VAULT_ACCESS_LEASE_RECORD_KEY = '__pwm_internal:access-lease';
// Compatibilidad temporal con pestañas que todavía ejecutan una versión que
// usaba localStorage. No autoriza escrituras: IndexedDB sigue siendo la fuente
// de verdad y el cercado se verifica allí dentro de cada transacción.
const LEGACY_VAULT_ACCESS_LEASE_KEY = 'pwm-vault-lease';
const VAULT_ACCESS_LEASE_MS = 15_000;
const VAULT_ACCESS_REFRESH_MS = 5_000;
const TAB_INSTANCE_ID = crypto.randomUUID();
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
  'credential-favorited',
  'credential-unfavorited',
  'master-password-changed',
  'usb-key-created',
  'usb-key-disabled',
  'sync-merged',
  'sync-undone',
]);
const LOCAL_ONLY_SYNC_HISTORY_TYPES = new Set(['sync-merged', 'sync-undone']);
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
  favorites: {
    title: 'Copia urgente requerida',
    text: 'Actualizaste tus favoritos. Exportá la bóveda y guardá la copia nueva en tu USB para conservar este orden.',
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
  sync: {
    title: 'Exportá la bóveda sincronizada ahora',
    text: 'Combinaste cambios de otro dispositivo. Guardá una copia nueva. Después, en el otro dispositivo usá Sincronizar → Fusionar copia para que ambos queden iguales.',
  },
});

const state = {
  key: null,
  keyBytes: null,
  entries: [],
  tombstones: [],
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
    deviceId: TAB_INSTANCE_ID,
    activeVaultId: null,
    vaults: [],
  },
  autoLockTimer: null,
  noticeTimer: null,
  pendingBackupAction: null,
  pendingBackupExport: null,
  pendingUsbKey: null,
  leaveBackupReminderTimer: null,
  beforeUnloadWarningActive: false,
  dismissedBackupReminderRecord: null,
  vaultAccess: null,
  pendingVaultAccessRelease: null,
  pageSession: 0,
  usbKeyBusy: false,
  pendingSync: null,
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

function vaultAccessName() {
  return VAULT_ACCESS_LOCK_NAME;
}

function validVaultLease(lease) {
  return Boolean(
    lease
    && typeof lease === 'object'
    && lease.format === 'pwm-access-lease'
    && typeof lease.owner === 'string'
    && typeof lease.token === 'string'
    && Number.isFinite(lease.expiresAt),
  );
}

function accessOwnsLease(access, lease, now = Date.now()) {
  return Boolean(
    validVaultLease(lease)
    && lease.owner === TAB_INSTANCE_ID
    && lease.token === access.token
    && lease.expiresAt > now,
  );
}

function readLegacyVaultLease() {
  try {
    const lease = JSON.parse(localStorage.getItem(LEGACY_VAULT_ACCESS_LEASE_KEY));
    if (
      lease
      && typeof lease.owner === 'string'
      && typeof lease.token === 'string'
      && Number.isFinite(lease.expiresAt)
    ) return lease;
  } catch (_) {
    // El espejo opcional puede no estar disponible.
  }
  return null;
}

function liveLegacyVaultLease(lease, now = Date.now()) {
  return Boolean(lease && lease.expiresAt > now);
}

function legacyLeaseConflicts() {
  const lease = readLegacyVaultLease();
  // Una lease viva de la versión anterior se trata como ajena, aun si el
  // identificador de pestaña coincidiera por casualidad.
  return liveLegacyVaultLease(lease);
}

function publishLegacyVaultLease(access) {
  try {
    const existing = readLegacyVaultLease();
    if (
      liveLegacyVaultLease(existing)
      && (existing.owner !== TAB_INSTANCE_ID || existing.token !== access.token)
    ) {
      return false;
    }
    localStorage.setItem(LEGACY_VAULT_ACCESS_LEASE_KEY, JSON.stringify({
      owner: TAB_INSTANCE_ID,
      token: access.token,
      expiresAt: access.leaseExpiresAt,
    }));
    const confirmed = readLegacyVaultLease();
    return Boolean(
      confirmed
      && confirmed.owner === TAB_INSTANCE_ID
      && confirmed.token === access.token
      && confirmed.expiresAt >= access.leaseExpiresAt,
    );
  } catch (_) {
    // El espejo no es necesario para la seguridad de esta versión.
    return true;
  }
}

function removeLegacyVaultLease(access) {
  try {
    const lease = readLegacyVaultLease();
    if (lease?.owner === TAB_INSTANCE_ID && lease.token === access.token) {
      localStorage.removeItem(LEGACY_VAULT_ACCESS_LEASE_KEY);
    }
  } catch (_) {
    // La lease de IndexedDB expira aunque el espejo no pueda limpiarse.
  }
}

function ownsVaultAccess(vaultId = state.vaultId) {
  const access = state.vaultAccess;
  if (!access || access.invalidated || (!access.temporary && (!vaultId || access.vaultId !== vaultId))) return false;
  // La comprobación autoritativa del token ocurre dentro de cada transacción
  // readwrite. Esta guarda rápida evita operar tras una concesión ya vencida.
  return access.leaseExpiresAt > Date.now();
}

function waitForPendingVaultAccessRelease() {
  const pending = state.pendingVaultAccessRelease;
  return pending || Promise.resolve();
}

function releaseVaultAccess() {
  const access = state.vaultAccess;
  state.vaultAccess = null;
  if (!access) return waitForPendingVaultAccessRelease();

  const release = Promise.resolve(disposeVaultAccess(access)).catch(() => undefined);
  const previous = state.pendingVaultAccessRelease;
  const pending = previous
    ? Promise.allSettled([previous, release]).then(() => undefined)
    : release;
  state.pendingVaultAccessRelease = pending;
  void pending.then(() => {
    if (state.pendingVaultAccessRelease === pending) {
      state.pendingVaultAccessRelease = null;
    }
  });
  return pending;
}

function disposeVaultAccess(access) {
  if (!access) return Promise.resolve();
  if (access.releasePromise) return access.releasePromise;
  access.invalidated = true;

  // Una escritura que ya estaba en curso no debe poder terminar después de
  // bloquear la bóveda o abandonar la página.
  access.transactions?.forEach((transaction) => {
    try { transaction.abort(); } catch (_) { /* ya terminó */ }
  });
  access.transactions?.clear();

  window.clearInterval(access.refreshTimer);
  access.releasePromise = Promise.resolve(releaseVaultLease(access))
    .catch(() => undefined)
    .then(() => {
      // El Web Lock se conserva hasta terminar de liberar la lease
      // transaccional, para no abrir una ventana de doble adquisicion.
      if (access.kind === 'web-lock') {
        try { access.release(); } catch (_) { /* ya fue liberado */ }
      }
    });
  return access.releasePromise;
}

function handleLostVaultAccess() {
  // También puede ocurrir durante una operación temporal (crear, importar o
  // desbloquear), antes de que state.key exista. En ese caso se invalida la
  // sesión y se limpian formularios igual que al abandonar la página.
  if (state.key) lockVault();
  else lockVaultOnPageExit();
  showNotice(
    'Esta bóveda se abrió en otra pestaña. Se bloqueó aquí para evitar cambios en conflicto.',
    'error',
  );
}

async function acquireIndexedDbLease(vaultId, temporary = false, kind = 'lease', release = null) {
  if (legacyLeaseConflicts()) return { status: 'busy', access: null };
  const token = crypto.randomUUID();
  let expiresAt = 0;
  let database;
  try {
    database = await openDatabase();
  } catch (_) {
    return { status: 'unavailable', access: null };
  }

  return new Promise((resolve) => {
    let transaction;
    let store;
    let request;
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite');
      store = transaction.objectStore(STORE_NAME);
      request = store.get(VAULT_ACCESS_LEASE_RECORD_KEY);
    } catch (_) {
      database.close();
      resolve({ status: 'unavailable', access: null });
      return;
    }
    let granted = false;
    let outcome = 'unavailable';

    const stop = (status = 'unavailable') => {
      outcome = status;
      try { transaction.abort(); } catch (_) { /* ya terminó */ }
    };

    request.onsuccess = () => {
      try {
        const existing = request.result;
        // Una concesión viva, incluso de esta misma pestaña, se respeta. Así
        // dos solicitudes concurrentes no pueden reemplazarse entre sí.
        if (validVaultLease(existing) && existing.expiresAt > Date.now()) {
          stop('busy');
          return;
        }
        // La apertura de IndexedDB puede haber esperado detrás de otra
        // transacción: el vencimiento se calcula recién al reclamarla.
        expiresAt = Date.now() + VAULT_ACCESS_LEASE_MS;
        store.put({
          format: 'pwm-access-lease',
          owner: TAB_INSTANCE_ID,
          token,
          expiresAt,
        }, VAULT_ACCESS_LEASE_RECORD_KEY);
        granted = true;
      } catch (_) {
        stop('unavailable');
      }
    };
    request.onerror = () => stop('unavailable');
    transaction.oncomplete = () => {
      database.close();
      if (!granted) {
        resolve({ status: outcome, access: null });
        return;
      }
      const access = {
        kind,
        vaultId,
        temporary,
        token,
        leaseExpiresAt: expiresAt,
        refreshTimer: null,
        refreshInFlight: false,
        transactions: new Set(),
        session: state.pageSession,
        release,
      };
      if (!publishLegacyVaultLease(access)) {
        access.invalidated = true;
        void releaseVaultLease(access).finally(() => {
          resolve({ status: 'busy', access: null });
        });
        return;
      }
      access.refreshTimer = window.setInterval(
        () => { void refreshVaultLease(access); },
        VAULT_ACCESS_REFRESH_MS,
      );
      resolve({ status: 'acquired', access });
    };
    transaction.onerror = () => {
      database.close();
      resolve({ status: 'unavailable', access: null });
    };
    transaction.onabort = () => {
      database.close();
      resolve({ status: granted ? 'unavailable' : outcome, access: null });
    };
  });
}

async function renewVaultLease(access) {
  let database;
  try {
    database = await openDatabase();
  } catch (_) {
    return false;
  }
  return new Promise((resolve) => {
    let transaction;
    let store;
    let request;
    try {
      transaction = database.transaction(STORE_NAME, 'readwrite');
      store = transaction.objectStore(STORE_NAME);
      request = store.get(VAULT_ACCESS_LEASE_RECORD_KEY);
    } catch (_) {
      database.close();
      resolve(false);
      return;
    }
    let nextExpiresAt = 0;
    let renewed = false;
    const stop = () => {
      try { transaction.abort(); } catch (_) { /* ya terminó */ }
    };
    request.onsuccess = () => {
      try {
        if (!accessOwnsLease(access, request.result)) {
          stop();
          return;
        }
        nextExpiresAt = Date.now() + VAULT_ACCESS_LEASE_MS;
        store.put({ ...request.result, expiresAt: nextExpiresAt }, VAULT_ACCESS_LEASE_RECORD_KEY);
        renewed = true;
      } catch (_) {
        stop();
      }
    };
    request.onerror = stop;
    transaction.oncomplete = () => {
      database.close();
      if (renewed) {
        access.leaseExpiresAt = nextExpiresAt;
        renewed = publishLegacyVaultLease(access);
      }
      resolve(renewed);
    };
    transaction.onerror = () => {
      database.close();
      resolve(false);
    };
    transaction.onabort = () => {
      database.close();
      resolve(false);
    };
  });
}

async function releaseVaultLease(access) {
  let database;
  try {
    database = await openDatabase();
    return await new Promise((resolve) => {
      let completed = false;
      const finish = (released) => {
        if (completed) return;
        completed = true;
        database.close();
        if (released) removeLegacyVaultLease(access);
        resolve(released);
      };
      let transaction;
      try {
        transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(VAULT_ACCESS_LEASE_RECORD_KEY);
        let deleted = false;
        request.onsuccess = () => {
          try {
            if (accessOwnsLease(access, request.result)) {
              store.delete(VAULT_ACCESS_LEASE_RECORD_KEY);
              deleted = true;
            }
          } catch (_) {
            try { transaction.abort(); } catch (_) { /* ya terminó */ }
          }
        };
        request.onerror = () => {
          try { transaction.abort(); } catch (_) { /* ya terminó */ }
        };
        transaction.oncomplete = () => finish(deleted);
        transaction.onerror = () => finish(false);
        transaction.onabort = () => finish(false);
      } catch (_) {
        finish(false);
      }
    });
  } catch (_) {
    try { database?.close(); } catch (_) { /* ya cerrada */ }
    return false;
  }
}

async function refreshVaultLease(access) {
  if (
    access.refreshInFlight
    || state.vaultAccess !== access
    || access.invalidated
    || !ownsVaultAccess(access.vaultId)
  ) {
    if (state.vaultAccess === access && !access.refreshInFlight) handleLostVaultAccess();
    return;
  }
  access.refreshInFlight = true;
  let renewed = false;
  try {
    renewed = await renewVaultLease(access);
  } catch (_) {
    renewed = false;
  } finally {
    access.refreshInFlight = false;
  }
  if (!renewed && state.vaultAccess === access) handleLostVaultAccess();
}

function handleLegacyVaultLeaseStorage(event) {
  if (event.key !== LEGACY_VAULT_ACCESS_LEASE_KEY) return;
  const access = state.vaultAccess;
  const lease = readLegacyVaultLease();
  if (
    !access
    || access.invalidated
    || !lease
    || lease.expiresAt <= Date.now()
    || (lease.owner === TAB_INSTANCE_ID && lease.token === access.token)
  ) return;
  // Una pestaña antigua no conoce el cercado IndexedDB; se bloquea esta
  // pestaña inmediatamente para mantener la compatibilidad durante el cambio.
  handleLostVaultAccess();
}

async function acquireFallbackVaultAccess(vaultId, temporary = false) {
  const result = await acquireIndexedDbLease(vaultId, temporary);
  return result.access;
}

async function acquireWebVaultAccess(vaultId, temporary = false) {
  return new Promise((resolve) => {
    let release;
    const hold = new Promise((releaseLock) => {
      release = releaseLock;
    });
    try {
      navigator.locks.request(
        vaultAccessName(),
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) {
            // Otra pestaña ya tiene el bloqueo fuerte. No se inicia una
            // segunda vía de adquisición mientras siga ocupado.
            resolve({ status: 'busy', access: null });
            return;
          }
          // Incluso Web Locks mantiene una lease en IndexedDB. Así distintas
          // capacidades del navegador no pueden eludir el mismo cercado.
          const lease = await acquireIndexedDbLease(vaultId, temporary, 'web-lock', release);
          resolve(lease);
          if (!lease.access) return;
          await hold;
        },
      ).catch(() => resolve({ status: 'unavailable', access: null }));
    } catch (_) {
      resolve({ status: 'unavailable', access: null });
    }
  });
}

async function acquireVaultAccess(vaultId, temporary = false) {
  if (ownsVaultAccess(vaultId)) return true;
  // Se captura antes de esperar una liberación: pagehide puede ocurrir durante
  // esa espera y no debe permitir instalar un acceso después de abandonar.
  const session = state.pageSession;
  if (state.vaultAccess) await releaseVaultAccess();
  await waitForPendingVaultAccessRelease();
  if (session !== state.pageSession) return false;

  let access = null;
  const webLocksAvailable = typeof navigator.locks?.request === 'function';
  if (webLocksAvailable) {
    const webLock = await acquireWebVaultAccess(vaultId, temporary);
    access = webLock.access;
    // Si Web Locks está disponible pero no funciona, mantenemos la aplicación
    // utilizable con la lease transaccional. Si está ocupado, no hacemos fallback.
    if (!access && webLock.status === 'unavailable') {
      access = await acquireFallbackVaultAccess(vaultId, temporary);
    }
  } else {
    access = await acquireFallbackVaultAccess(vaultId, temporary);
  }
  if (!access || session !== state.pageSession) {
    await disposeVaultAccess(access);
    return false;
  }

  access.session = session;
  state.vaultAccess = access;
  return true;
}

async function withTemporaryVaultAccess(callback) {
  if (state.vaultAccess) return callback(captureVaultAccess());
  const acquired = await acquireVaultAccess('temporary', true);
  if (!acquired) throw new Error('Otra pestaña está actualizando las bóvedas. Intentá de nuevo.');
  const access = captureVaultAccess();
  try {
    return await callback(access);
  } finally {
    if (state.vaultAccess === access) await releaseVaultAccess();
  }
}

function captureVaultAccess() {
  const access = state.vaultAccess;
  if (!access || access.invalidated || !ownsVaultAccess(access.vaultId)) {
    throw new Error('La bóveda está abierta en otra pestaña o la sesión terminó.');
  }
  return access;
}

function assertVaultAccess(access, requireUnlocked = false) {
  if (
    !access
    || state.vaultAccess !== access
    || access.invalidated
    || access.session !== state.pageSession
    || !ownsVaultAccess(access.vaultId)
    || (requireUnlocked && (!state.key || !state.vaultId || state.vaultId !== access.vaultId))
  ) {
    throw new Error('La sesión de la bóveda terminó antes de completar la operación.');
  }
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
      const swatch = document.createElement('span');
      swatch.className = 'appearance-swatch';
      swatch.dataset.background = preset.id;
      swatch.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = preset.name;
      button.append(swatch, label);
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
  const access = captureVaultAccess();
  assertVaultAccess(access, true);
  const expectedSnapshot = vaultRecordSnapshot(state.record);
  const encrypted = await encryptPayloadV2(state.key, {
    syncVersion: SYNC_PAYLOAD_VERSION,
    entries: state.entries,
    tombstones: state.tombstones,
    history: state.history,
    appearance: state.appearance,
  });
  const record = { ...state.record, ...encrypted, updatedAt: new Date().toISOString() };
  const committed = await commitVaultSnapshot(
    access,
    state.vaultId,
    expectedSnapshot,
    () => true,
    (index) => ({
      record,
      index: updateVaultMetadata(index, state.vaultId, state.vaultName, record.updatedAt),
      deleteKeys: [syncCheckpointKey(state.vaultId)],
    }),
  );
  assertVaultAccess(access, true);
  state.record = record;
  state.index = committed.index;
}

async function applyAppearance() {
  const previous = state.appearance;
  const next = normalizeAppearance(state.appearanceDraft);
  const access = state.vaultAccess;
  const session = state.pageSession;
  state.appearance = next;
  applyVaultBackground(next);
  $('applyAppearanceButton').disabled = true;
  try {
    await saveAppearance();
    closeAppearanceDialog(false);
    showNotice('Apariencia guardada para esta bóveda.');
  } catch (_) {
    if (state.pageSession === session && state.vaultAccess === access && state.key) {
      state.appearance = previous;
      applyVaultBackground(previous);
    }
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

function trackWriteTransaction(access, database, transaction) {
  if (!access.transactions) access.transactions = new Set();
  access.transactions.add(transaction);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    access.transactions?.delete(transaction);
    database.close();
  };
}

function assertLeaseFence(access, lease) {
  if (!accessOwnsLease(access, lease)) {
    throw new Error('La concesión de esta bóveda venció o fue reemplazada por otra pestaña.');
  }
}

function queueFencedWrite(store, access, write, fail) {
  const leaseRequest = store.get(VAULT_ACCESS_LEASE_RECORD_KEY);
  leaseRequest.onsuccess = () => {
    try {
      assertVaultAccess(access);
      assertLeaseFence(access, leaseRequest.result);
      write();
    } catch (error) {
      fail(error);
    }
  };
  leaseRequest.onerror = () => fail(new Error('No pude comprobar la concesión de esta bóveda.'));
}

async function writeValues(entries, access) {
  assertVaultAccess(access);
  const database = await openDatabase();
  assertVaultAccess(access);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const close = trackWriteTransaction(access, database, transaction);
    try {
      queueFencedWrite(store, access, () => {
        entries.forEach(([key, value]) => store.put(value, key));
      }, (error) => {
        close();
        try { transaction.abort(); } catch (_) { /* transaction already ended */ }
        reject(error);
      });
    } catch (error) {
      close();
      try { transaction.abort(); } catch (_) { /* ya terminó */ }
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      close();
      try {
        assertVaultAccess(access);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    transaction.onerror = () => {
      close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      close();
      reject(transaction.error || new Error('La escritura se canceló al bloquear la bóveda.'));
    };
  });
}

async function writeAndDeleteValues(entries, keys, access) {
  assertVaultAccess(access);
  const database = await openDatabase();
  assertVaultAccess(access);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const close = trackWriteTransaction(access, database, transaction);
    try {
      queueFencedWrite(store, access, () => {
        entries.forEach(([key, value]) => store.put(value, key));
        keys.forEach((key) => store.delete(key));
      }, (error) => {
        close();
        try { transaction.abort(); } catch (_) { /* transaction already ended */ }
        reject(error);
      });
    } catch (error) {
      close();
      try { transaction.abort(); } catch (_) { /* ya terminó */ }
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      close();
      try {
        assertVaultAccess(access);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    transaction.onerror = () => {
      close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      close();
      reject(transaction.error || new Error('La escritura se canceló al bloquear la bóveda.'));
    };
  });
}

// Lee y escribe el registro y su índice en una sola transacción. Así una
// exportación o activación no puede confirmar un snapshot que otra pestaña
// haya reemplazado entre sus lecturas y la escritura.
async function commitVaultSnapshot(access, vaultId, expectedRecordSnapshot, expectedMetadata, build) {
  assertVaultAccess(access, true);
  const database = await openDatabase();
  assertVaultAccess(access, true);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const close = trackWriteTransaction(access, database, transaction);
    const leaseRequest = store.get(VAULT_ACCESS_LEASE_RECORD_KEY);
    const indexRequest = store.get(INDEX_KEY);
    const recordRequest = store.get(vaultRecordKey(vaultId));
    let result = null;

    const fail = (message) => {
      try { transaction.abort(); } catch (_) { /* ya terminó */ }
      reject(new Error(message));
    };

    const tryCommit = () => {
      if (
        leaseRequest.readyState !== 'done'
        || indexRequest.readyState !== 'done'
        || recordRequest.readyState !== 'done'
      ) return;
      try {
        assertVaultAccess(access, true);
        assertLeaseFence(access, leaseRequest.result);
        const storedIndex = indexRequest.result;
        const storedRecord = recordRequest.result;
        if (!validateVaultIndex(storedIndex) || !validateVaultRecord(storedRecord)) {
          fail('No pude comprobar el estado de la bóveda.');
          return;
        }
        const normalized = ensureVaultMetadata(storedIndex).index;
        const metadata = normalized.vaults.find((vault) => vault.id === vaultId);
        if (
          !metadata
          || vaultRecordSnapshot(storedRecord) !== expectedRecordSnapshot
          || !expectedMetadata(metadata)
        ) {
          fail('La bóveda cambió antes de completar la operación.');
          return;
        }
        result = build(normalized, metadata, storedRecord);
        if (!result || !result.index) {
          fail('No pude preparar la actualización de la bóveda.');
          return;
        }
        if (result.record) store.put(result.record, vaultRecordKey(vaultId));
        store.put(result.index, INDEX_KEY);
        if (Array.isArray(result.additionalValues)) {
          result.additionalValues.forEach(([key, value]) => store.put(value, key));
        }
        if (Array.isArray(result.deleteKeys)) {
          result.deleteKeys.forEach((key) => store.delete(key));
        }
      } catch (error) {
        fail(error.message || 'No pude completar la operación.');
      }
    };
    indexRequest.onsuccess = tryCommit;
    recordRequest.onsuccess = tryCommit;
    leaseRequest.onsuccess = tryCommit;
    indexRequest.onerror = () => fail('No pude comprobar el estado de la bóveda.');
    recordRequest.onerror = () => fail('No pude comprobar el estado de la bóveda.');
    leaseRequest.onerror = () => fail('No pude comprobar la concesión de esta bóveda.');
    transaction.oncomplete = () => {
      close();
      try {
        assertVaultAccess(access, true);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    transaction.onerror = () => {
      close();
      reject(transaction.error || new Error('No pude completar la operación.'));
    };
    transaction.onabort = () => {
      close();
      reject(transaction.error || new Error('La escritura se canceló al bloquear la bóveda.'));
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
    deviceId: crypto.randomUUID(),
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
  const deviceId = validUuid(index.deviceId) ? index.deviceId : crypto.randomUUID();
  let changed = deviceId !== index.deviceId;
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
    index: changed ? { ...index, deviceId, vaults } : index,
    changed,
  };
}

async function readVaultIndexWithAccess(access, allowEmpty = false) {
  assertVaultAccess(access);
  const index = await readValue(INDEX_KEY);
  assertVaultAccess(access);
  if (!validateVaultIndex(index)) {
    if (allowEmpty && index === null) return emptyIndex();
    throw new Error('No pude leer el índice de bóvedas.');
  }
  return ensureVaultMetadata(index).index;
}

async function loadVaultIndex() {
  const storedIndex = await readValue(INDEX_KEY);
  if (validateVaultIndex(storedIndex)) {
    const normalized = ensureVaultMetadata(storedIndex);
    const nextIndex = { ...normalized.index };
    let changed = normalized.changed;
    if (!nextIndex.vaults.some((vault) => vault.id === nextIndex.activeVaultId)) {
      nextIndex.activeVaultId = nextIndex.vaults[0]?.id ?? null;
      changed = true;
    }
    state.index = nextIndex;

    // Una migración anterior pudo dejar la copia `current` junto al nuevo
    // registro. Se elimina en una transacción cuando aún exista.
    const legacyRecord = await readValue(LEGACY_RECORD_KEY);
    if (!changed && !validateVaultRecord(legacyRecord)) return;
    try {
      await withTemporaryVaultAccess(async (access) => {
        const freshIndex = await readValue(INDEX_KEY);
        const freshLegacyRecord = await readValue(LEGACY_RECORD_KEY);
        assertVaultAccess(access);
        if (!validateVaultIndex(freshIndex)) throw new Error('No pude leer el índice de bóvedas.');
        const freshNormalized = ensureVaultMetadata(freshIndex);
        const repairedIndex = { ...freshNormalized.index };
        let needsWrite = freshNormalized.changed;
        if (!repairedIndex.vaults.some((vault) => vault.id === repairedIndex.activeVaultId)) {
          repairedIndex.activeVaultId = repairedIndex.vaults[0]?.id ?? null;
          needsWrite = true;
        }
        if (!needsWrite && !validateVaultRecord(freshLegacyRecord)) {
          state.index = repairedIndex;
          return;
        }
        await writeAndDeleteValues(
          [[INDEX_KEY, repairedIndex]],
          validateVaultRecord(freshLegacyRecord) ? [LEGACY_RECORD_KEY] : [],
          access,
        );
        assertVaultAccess(access);
        state.index = repairedIndex;
      });
    } catch (_) {
      // La pestaña sigue pudiendo mostrar el índice normalizado en memoria si
      // otra tiene el lock. La reparación se reintentará cuando quede libre,
      // sin fingir que el almacenamiento local dejó de existir.
    }
    return;
  }

  const legacyRecord = await readValue(LEGACY_RECORD_KEY);
  if (!validateVaultRecord(legacyRecord)) {
    state.index = emptyIndex();
    return;
  }

  await withTemporaryVaultAccess(async (access) => {
    // Otra pestaña puede haber terminado la migración mientras ésta esperaba
    // el lock global. Nunca sobrescribimos ese índice con un snapshot viejo.
    const currentIndex = await readValue(INDEX_KEY);
    assertVaultAccess(access);
    if (validateVaultIndex(currentIndex)) {
      const normalized = ensureVaultMetadata(currentIndex).index;
      const currentLegacy = await readValue(LEGACY_RECORD_KEY);
      assertVaultAccess(access);
      if (validateVaultRecord(currentLegacy)) {
        await writeAndDeleteValues([[INDEX_KEY, normalized]], [LEGACY_RECORD_KEY], access);
      }
      state.index = normalized;
      return;
    }

    const currentLegacy = await readValue(LEGACY_RECORD_KEY);
    assertVaultAccess(access);
    if (!validateVaultRecord(currentLegacy)) {
      state.index = emptyIndex();
      return;
    }
    const vaultId = crypto.randomUUID();
    const createdAt = currentLegacy.createdAt || new Date().toISOString();
    const nextIndex = {
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
        updatedAt: currentLegacy.updatedAt || createdAt,
      }],
    };
    await writeAndDeleteValues(
      [
        [vaultRecordKey(vaultId), currentLegacy],
        [INDEX_KEY, nextIndex],
      ],
      [LEGACY_RECORD_KEY],
      access,
    );
    assertVaultAccess(access);
    state.index = nextIndex;
  });
}

function vaultNameExistsInIndex(index, name) {
  const normalized = name.trim().toLocaleLowerCase('es');
  return index.vaults.some(
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
  if (!needsBackup) state.dismissedBackupReminderRecord = null;
  const reminderDismissed = needsBackup && state.dismissedBackupReminderRecord === state.record;
  $('backupReminder').classList.toggle('hidden', !needsBackup || reminderDismissed);
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

function dismissBackupReminder() {
  if (!activeVaultNeedsBackup() || !state.record) return;
  state.dismissedBackupReminderRecord = state.record;
  updateBackupReminder();
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
    const completed = await downloadBackup();
    if (completed && !activeVaultNeedsBackup()) {
      const action = state.pendingBackupAction;
      closePendingBackupDialog();
      action?.();
    }
  } finally {
    button.disabled = false;
  }
}

async function saveVault(backupReason = 'credentials', historyEvent = null, options = {}) {
  if (!state.key || !state.keyBytes || !state.record || state.record.version !== 2 || !state.vaultId) {
    throw new Error('Bóveda bloqueada');
  }
  const access = captureVaultAccess();
  assertVaultAccess(access, true);
  const expectedSnapshot = vaultRecordSnapshot(state.record);
  const nextHistory = historyEvent
    ? historyWithEvent(state.history, historyEvent)
    : state.history;
  const encrypted = await encryptPayloadV2(state.key, {
    syncVersion: SYNC_PAYLOAD_VERSION,
    entries: state.entries,
    tombstones: state.tombstones,
    history: nextHistory,
    appearance: state.appearance,
  });
  const updatedAt = new Date().toISOString();
  const nextRecord = { ...state.record, ...encrypted, updatedAt };
  const syncCheckpoint = options.syncCheckpointBeforeRecord
    ? {
      format: 'pwm-sync-checkpoint',
      version: 1,
      vaultUid: options.syncVaultUid,
      createdAt: updatedAt,
      beforeRecord: options.syncCheckpointBeforeRecord,
      afterSnapshot: vaultRecordSnapshot(nextRecord),
    }
    : null;
  const committed = await commitVaultSnapshot(
    access,
    state.vaultId,
    expectedSnapshot,
    () => true,
    (index) => ({
      record: nextRecord,
      index: updateVaultMetadata(
        index,
        state.vaultId,
        state.vaultName,
        updatedAt,
        { needsBackup: true, backupReason },
      ),
      additionalValues: syncCheckpoint
        ? [[syncCheckpointKey(state.vaultId), syncCheckpoint]]
        : [],
      deleteKeys: syncCheckpoint ? [] : [syncCheckpointKey(state.vaultId)],
    }),
  );
  assertVaultAccess(access, true);
  state.record = nextRecord;
  state.history = nextHistory;
  state.index = committed.index;
  renderVaultSelect(state.vaultId);
  resetAutoLock();
}

function normalizeSyncClock(clock) {
  if (!clock || typeof clock !== 'object' || Array.isArray(clock)) return {};
  const normalized = {};
  Object.entries(clock).forEach(([deviceId, counter]) => {
    if (validUuid(deviceId) && Number.isSafeInteger(counter) && counter > 0) {
      normalized[deviceId] = counter;
    }
  });
  return normalized;
}

function mergeSyncClocks(...clocks) {
  const merged = {};
  clocks.forEach((clock) => {
    Object.entries(normalizeSyncClock(clock)).forEach(([deviceId, counter]) => {
      merged[deviceId] = Math.max(merged[deviceId] || 0, counter);
    });
  });
  return merged;
}

function compareSyncClocks(leftClock, rightClock) {
  const left = normalizeSyncClock(leftClock);
  const right = normalizeSyncClock(rightClock);
  const deviceIds = new Set([...Object.keys(left), ...Object.keys(right)]);
  let leftAhead = false;
  let rightAhead = false;
  deviceIds.forEach((deviceId) => {
    const leftValue = left[deviceId] || 0;
    const rightValue = right[deviceId] || 0;
    if (leftValue > rightValue) leftAhead = true;
    if (rightValue > leftValue) rightAhead = true;
  });
  if (!leftAhead && !rightAhead) return 'equal';
  if (leftAhead && !rightAhead) return 'left';
  if (rightAhead && !leftAhead) return 'right';
  return 'concurrent';
}

function nextSyncClock(clock = {}) {
  const next = mergeSyncClocks(clock);
  const deviceId = validUuid(state.index.deviceId) ? state.index.deviceId : TAB_INSTANCE_ID;
  next[deviceId] = (next[deviceId] || 0) + 1;
  return next;
}

function resolvedSyncClock(...clocks) {
  return nextSyncClock(mergeSyncClocks(...clocks));
}

function syncClockHasChanges(clock) {
  return Object.keys(normalizeSyncClock(clock)).length > 0;
}

function normalizeEntry(entry) {
  return {
    id: typeof entry.id === 'string' ? entry.id : crypto.randomUUID(),
    service: String(entry.service ?? '').trim(),
    username: String(entry.username ?? '').trim(),
    password: String(entry.password ?? ''),
    website: String(entry.website ?? '').trim(),
    notes: String(entry.notes ?? '').trim(),
    favorite: entry.favorite === true,
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || new Date().toISOString(),
    syncClock: normalizeSyncClock(entry.syncClock),
  };
}

function normalizeTombstone(tombstone) {
  if (!tombstone || typeof tombstone !== 'object' || typeof tombstone.id !== 'string' || !tombstone.id) {
    return null;
  }
  const deletedAt = new Date(tombstone.deletedAt);
  if (Number.isNaN(deletedAt.getTime())) return null;
  return {
    id: tombstone.id,
    deletedAt: deletedAt.toISOString(),
    syncClock: normalizeSyncClock(tombstone.syncClock),
  };
}

function normalizeTombstones(tombstones) {
  if (!Array.isArray(tombstones)) return [];
  const byId = new Map();
  tombstones.forEach((value) => {
    const tombstone = normalizeTombstone(value);
    if (!tombstone) return;
    const previous = byId.get(tombstone.id);
    if (!previous) {
      byId.set(tombstone.id, tombstone);
      return;
    }
    byId.set(tombstone.id, {
      id: tombstone.id,
      deletedAt: previous.deletedAt > tombstone.deletedAt ? previous.deletedAt : tombstone.deletedAt,
      syncClock: mergeSyncClocks(previous.syncClock, tombstone.syncClock),
    });
  });
  return [...byId.values()];
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
    case 'credential-favorited': return `Contraseña agregada a favoritos${detail}`;
    case 'credential-unfavorited': return `Contraseña quitada de favoritos${detail}`;
    case 'master-password-changed': return 'Clave maestra actualizada';
    case 'usb-key-created': return event.detail ? `Llave USB ${event.detail} creada` : 'Llave USB creada';
    case 'usb-key-disabled': return 'Llave USB desactivada';
    case 'sync-merged': return event.detail ? `Sincronización aplicada${detail}` : 'Sincronización aplicada';
    case 'sync-undone': return 'Última sincronización deshecha';
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
  const summary = document.createElement('div');
  summary.className = 'entry-summary-copy';
  const service = document.createElement('h3');
  service.textContent = entry.service;
  const username = document.createElement('p');
  username.textContent = entry.username;
  summary.append(service, username);

  const favorite = document.createElement('button');
  favorite.type = 'button';
  favorite.className = `favorite-button${entry.favorite ? ' is-favorite' : ''}`;
  favorite.dataset.action = 'favorite';
  favorite.dataset.id = entry.id;
  favorite.setAttribute('aria-pressed', String(Boolean(entry.favorite)));
  favorite.setAttribute('aria-label', entry.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos');
  favorite.title = entry.favorite ? 'Quitar de favoritos' : 'Agregar a favoritos';
  const favoriteIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  favoriteIcon.classList.add('button-icon');
  favoriteIcon.setAttribute('aria-hidden', 'true');
  const favoriteUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  favoriteUse.setAttribute('href', '#icon-star');
  favoriteIcon.append(favoriteUse);
  favorite.append(favoriteIcon);
  heading.append(summary, favorite);

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
    .sort((a, b) => {
      const favoriteOrder = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
      if (favoriteOrder) return favoriteOrder;
      return a.service.localeCompare(b.service, 'es')
        || a.username.localeCompare(b.username, 'es');
    });
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

async function toggleFavorite(id, button) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;

  const nextFavorite = !entry.favorite;
  const previousEntries = state.entries;
  let access;
  let session;
  if (button) button.disabled = true;
  try {
    access = captureVaultAccess();
    session = state.pageSession;
    state.entries = state.entries.map((item) => (item.id === id
      ? {
        ...item,
        favorite: nextFavorite,
        updatedAt: new Date().toISOString(),
        syncClock: nextSyncClock(item.syncClock),
      }
      : item));
    await saveVault(
      'favorites',
      createHistoryEvent(nextFavorite ? 'credential-favorited' : 'credential-unfavorited', entry.service),
    );
    renderEntries();
    [...$('entries').querySelectorAll('button[data-action="favorite"]')]
      .find((item) => item.dataset.id === id)
      ?.focus();
    showNotice(nextFavorite
      ? 'Agregada a favoritos. Quedará primero en la lista.'
      : 'Quitada de favoritos.');
  } catch (_) {
    if (state.pageSession === session && state.vaultAccess === access && state.key) {
      state.entries = previousEntries;
    }
    if (button?.isConnected) button.disabled = false;
    showNotice('No se pudo actualizar el favorito.', 'error');
  }
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
  if (master.length < 12) return showNotice('Usá una clave maestra de al menos 12 caracteres.', 'error');
  if (master !== confirmMaster) return showNotice('Las dos claves maestras no coinciden.', 'error');

  let pendingKeyBytes;
  let access;
  try {
    const vaultId = crypto.randomUUID();
    if (!await acquireVaultAccess(vaultId)) {
      showNotice('No se pudo reservar esta bóveda para esta pestaña.', 'error');
      return;
    }
    access = captureVaultAccess();
    const currentIndex = await readVaultIndexWithAccess(access, true);
    if (vaultNameExistsInIndex(currentIndex, vaultName)) {
      throw new Error(`Ya existe una bóveda llamada “${vaultName}”.`);
    }
    const createdAt = new Date().toISOString();
    const initialHistory = [
      createHistoryEvent('vault-created'),
    ];
    const created = await createV2Record(master, {
      syncVersion: SYNC_PAYLOAD_VERSION,
      entries: [],
      tombstones: [],
      history: initialHistory,
      appearance: { version: 1, background: 'default' },
    }, createdAt);
    const { record, key, keyBytes } = created;
    pendingKeyBytes = keyBytes;
    const nextIndex = {
      ...currentIndex,
      activeVaultId: vaultId,
      vaults: [
        ...currentIndex.vaults,
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
    assertVaultAccess(access);
    await writeValues([
      [vaultRecordKey(vaultId), record],
      [INDEX_KEY, nextIndex],
    ], access);
    assertVaultAccess(access);

    state.key = key;
    state.keyBytes = keyBytes;
    pendingKeyBytes = null;
    state.entries = [];
    state.tombstones = [];
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
  } catch (error) {
    if (state.vaultAccess === access) await releaseVaultAccess();
    pendingKeyBytes?.fill(0);
    showNotice(
      error.message?.startsWith('Ya existe una bóveda')
        ? error.message
        : 'No pude crear la bóveda en este navegador.',
      'error',
    );
  }
}

async function unlockVault(event) {
  event.preventDefault();
  const vaultId = $('vaultSelect').value;
  const master = $('unlockMaster').value;
  if (!vaultId || !master) return;

  let pendingKeyBytes;
  let access;
  try {
    if (!await acquireVaultAccess(vaultId)) {
      showNotice(
        'Esta bóveda ya está abierta en otra pestaña. Bloqueala allí antes de continuar.',
        'error',
      );
      return;
    }
    access = captureVaultAccess();
    const currentIndex = await readVaultIndexWithAccess(access);
    const metadata = currentIndex.vaults.find((vault) => vault.id === vaultId);
    if (!metadata) throw new Error('La bóveda ya no existe en este navegador.');
    let record = await readValue(vaultRecordKey(vaultId));
    assertVaultAccess(access);
    if (!validateVaultRecord(record)) throw new Error('No existe una bóveda válida');
    let key;
    let keyBytes;
    let payload;
    let migrated = false;
    if (record.version === 1) {
      const legacyKey = await deriveKey(master, bytesFromBase64(record.salt), record.iterations);
      payload = await decryptPayloadV1(legacyKey, record);
      payload = {
        syncVersion: SYNC_PAYLOAD_VERSION,
        entries: payload.entries,
        tombstones: [],
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
      currentIndex,
      vaultId,
      metadata.name,
      record.updatedAt,
      migrated ? { needsBackup: true, backupReason: 'migration' } : {},
    );
    const writes = [[INDEX_KEY, nextIndex]];
    if (migrated) writes.unshift([vaultRecordKey(vaultId), record]);
    assertVaultAccess(access);
    await writeValues(writes, access);
    assertVaultAccess(access);
    activateUnlockedVault(vaultId, metadata.name, record, key, keyBytes, payload, nextIndex);
    pendingKeyBytes = null;
    showNotice(`Bóveda “${metadata.name}” desbloqueada.`);
  } catch (error) {
    if (state.vaultAccess === access) await releaseVaultAccess();
    pendingKeyBytes?.fill(0);
    showNotice(
      error.message === 'La bóveda ya no existe en este navegador.'
        ? error.message
        : 'La clave maestra no es correcta o la bóveda está dañada.',
      'error',
    );
  }
}

function activateUnlockedVault(vaultId, vaultName, record, key, keyBytes, payload, index) {
  if (!ownsVaultAccess(vaultId)) throw new Error('No se pudo reservar la bóveda');
  state.key = key;
  state.keyBytes = keyBytes;
  state.entries = payload.entries.map(normalizeEntry);
  state.tombstones = normalizeTombstones(payload.tombstones);
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

function usbKeyVaultMismatchError(selectedVaultName, actualVaultName = '') {
  const detail = actualVaultName
    ? ` Esa llave pertenece a “${actualVaultName}”.`
    : ' Ese archivo no corresponde a ninguna bóveda guardada en este navegador.';
  const error = new Error(
    `Esa no es la llave de la bóveda “${selectedVaultName}”.${detail} Elegí la llave correcta antes de desbloquear.`,
  );
  error.name = 'UsbKeyVaultMismatchError';
  return error;
}

async function unlockWithUsbKey(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;

  const selectedVaultId = $('vaultSelect').value;
  const selectedVault = state.index.vaults.find((vault) => vault.id === selectedVaultId);
  if (!selectedVault) {
    showNotice('Elegí una bóveda antes de importar su llave.', 'error');
    return;
  }

  let usbKey;
  let pendingKeyBytes;
  let access;
  try {
    usbKey = await readUsbKeyFile(file);
    if (!await acquireVaultAccess('temporary', true)) {
      throw new Error('Esta bóveda ya está abierta en otra pestaña. Bloqueala allí antes de continuar.');
    }
    access = captureVaultAccess();
    const currentIndex = await readVaultIndexWithAccess(access);
    const matches = [];
    for (const metadata of currentIndex.vaults) {
      const record = await readValue(vaultRecordKey(metadata.id));
      assertVaultAccess(access);
      if (
        validateVaultRecord(record)
        && record.version === 2
        && validUsbUnlock(record.usbUnlock)
        && record.usbUnlock.keyId === usbKey.keyId
      ) {
        matches.push({ metadata, record });
      }
    }

    if (!matches.length) throw usbKeyVaultMismatchError(selectedVault.name);
    if (matches.length > 1) throw new Error('El archivo llave coincide con varias bóvedas duplicadas.');

    const [{ metadata, record }] = matches;
    if (metadata.id !== selectedVaultId) {
      throw usbKeyVaultMismatchError(selectedVault.name, metadata.name);
    }
    const vaultId = metadata.id;
    access.vaultId = vaultId;
    access.temporary = false;
    assertVaultAccess(access);
    const key = await importAesKey(usbKey.secret);
    const keyBytes = await unwrapDek(key, record.usbUnlock, aad('usb-wrap', usbKey.keyId));
    pendingKeyBytes = keyBytes;
    const payloadKey = await importAesKey(keyBytes);
    const payload = await decryptPayloadV2(payloadKey, record);
    const nextIndex = { ...currentIndex, activeVaultId: vaultId };
    assertVaultAccess(access);
    await writeValues([[INDEX_KEY, nextIndex]], access);
    assertVaultAccess(access);
    activateUnlockedVault(vaultId, metadata.name, record, payloadKey, keyBytes, payload, nextIndex);
    pendingKeyBytes = null;
    showNotice(`Bóveda “${metadata.name}” desbloqueada con el archivo llave.`);
  } catch (error) {
    if (state.vaultAccess === access) await releaseVaultAccess();
    pendingKeyBytes?.fill(0);
    const knownMessages = [
      'El archivo llave coincide con varias bóvedas duplicadas.',
      'Esta bóveda ya está abierta en otra pestaña. Bloqueala allí antes de continuar.',
      VAULT_AS_KEY_MESSAGE,
    ];
    showNotice(
      error.name === 'UsbKeyVaultMismatchError' || knownMessages.includes(error.message)
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
  state.pageSession += 1;
  void releaseVaultAccess();
  if ($('changeMasterDialog').open) {
    $('changeMasterForm').reset();
    $('changeMasterDialog').close();
  }
  if ($('usbKeyDialog').open) {
    $('usbKeyForm').reset();
    $('usbKeyDialog').close();
  }
  $('usbKeyVerificationInput').value = '';
  clearPendingUsbKey();
  if ($('deleteVaultDialog').open) {
    $('deleteVaultForm').reset();
    $('deleteVaultDialog').close();
  }
  closePendingBackupDialog();
  $('backupVerificationInput').value = '';
  clearPendingBackupExport();
  if ($('backupVerificationDialog').open) $('backupVerificationDialog').close();
  if ($('appearanceDialog').open) closeAppearanceDialog(false);
  if ($('historyDialog').open) $('historyDialog').close();
  clearPendingSync();
  if ($('syncDialog').open) $('syncDialog').close();
  clearVaultDom();
  state.key = null;
  if (state.keyBytes) state.keyBytes.fill(0);
  state.keyBytes = null;
  state.entries = [];
  state.tombstones = [];
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

function lockVaultOnPageExit() {
  clearLeaveBackupReminder();
  if (state.key) {
    lockVault();
    return;
  }
  // Pagehide también puede ocurrir durante crear/desbloquear, cuando todavía
  // no existe state.key pero sí hay un lock o claves escritas en formularios.
  state.pageSession += 1;
  void releaseVaultAccess();
  $('setupForm').reset();
  $('setupMaster').value = '';
  $('setupConfirm').value = '';
  $('unlockForm').reset();
  setMasterUnlockExpanded(false);
  $('usbKeyForm').reset();
  clearPendingUsbKey();
}

async function lockRestoredVault(event) {
  if (!event.persisted) return;
  lockVaultOnPageExit();
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
    showNotice('No pude restaurar las bóvedas de este navegador.', 'error');
  }
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
    favorite: previous?.favorite ?? false,
    createdAt: previous?.createdAt,
    syncClock: nextSyncClock(previous?.syncClock),
  });

  const previousEntries = state.entries;
  const previousTombstones = state.tombstones;
  let access;
  let session;
  try {
    access = captureVaultAccess();
    session = state.pageSession;
    state.entries = previous
      ? state.entries.map((item) => (item.id === id ? entry : item))
      : [...state.entries, entry];
    state.tombstones = state.tombstones.filter((tombstone) => tombstone.id !== entry.id);
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
    if (state.pageSession === session && state.vaultAccess === access && state.key) {
      state.entries = previousEntries;
      state.tombstones = previousTombstones;
    }
    showNotice('No se pudo guardar el cambio.', 'error');
  }
}

async function deleteEntry(id) {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry || !window.confirm(`¿Eliminar la contraseña de ${entry.service}?`)) return;
  const previousEntries = state.entries;
  const previousTombstones = state.tombstones;
  let access;
  let session;
  try {
    access = captureVaultAccess();
    session = state.pageSession;
    state.entries = state.entries.filter((item) => item.id !== id);
    state.tombstones = [
      ...state.tombstones.filter((tombstone) => tombstone.id !== id),
      {
        id,
        deletedAt: new Date().toISOString(),
        syncClock: nextSyncClock(entry.syncClock),
      },
    ];
    await saveVault(
      'credentials',
      createHistoryEvent('credential-deleted', entry.service),
    );
    if ($('entryId').value === id) clearEditor();
    renderEntries();
    showNotice('Contraseña eliminada. Actualizá la copia en tu USB ahora; si perdés este navegador, un respaldo anterior todavía podría contenerla.');
  } catch (_) {
    if (state.pageSession === session && state.vaultAccess === access && state.key) {
      state.entries = previousEntries;
      state.tombstones = previousTombstones;
    }
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

function isCancelledFileOperation(error) {
  return error?.name === 'AbortError';
}

function isExistingFileError(error) {
  return error?.name === 'ExistingFileError';
}

function canUseDirectoryPicker() {
  return window.isSecureContext && typeof window.showDirectoryPicker === 'function';
}

function existingFileError(fileName, existingFileDescription) {
  const error = new Error(`“${fileName}” ya existe. NO se reemplazó ${existingFileDescription}. Revisá ese archivo y volvé a intentarlo.`);
  error.name = 'ExistingFileError';
  return error;
}

async function fileMatchesExpectedText(file, expectedText) {
  if (file.size !== new Blob([expectedText]).size) return false;
  return (await file.text()) === expectedText;
}

async function newFileHandleInDirectory(
  directoryHandle,
  fileName,
  existingFileDescription,
  {
    allowEmptyExisting = false,
    validateExisting = null,
  } = {},
) {
  try {
    const fileHandle = await directoryHandle.getFileHandle(fileName, { create: false });
    const existingFile = await fileHandle.getFile();
    if (allowEmptyExisting && existingFile.size === 0) {
      return { fileHandle, alreadySaved: false };
    }
    if (validateExisting && await validateExisting(existingFile)) {
      return { fileHandle, alreadySaved: true };
    }
  } catch (error) {
    if (error?.name === 'NotFoundError') {
      const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
      const existingFile = await fileHandle.getFile();
      if (existingFile.size > 0) {
        if (validateExisting && await validateExisting(existingFile)) {
          return { fileHandle, alreadySaved: true };
        }
        throw existingFileError(fileName, existingFileDescription);
      }
      return { fileHandle, alreadySaved: false };
    }
    throw error;
  }

  throw existingFileError(fileName, existingFileDescription);
}

function triggerTextDownload(text, fileName) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function saveNewTextInDirectory(text, fileName, {
  pickerId,
  existingFileDescription,
  prepareDirectory = null,
  allowEmptyExisting = false,
  validateExisting = null,
}) {
  let writable = null;
  try {
    const directoryHandle = await window.showDirectoryPicker({
      id: pickerId,
      mode: 'readwrite',
    });
    const prepared = prepareDirectory ? await prepareDirectory(directoryHandle) : null;
    const { fileHandle, alreadySaved } = await newFileHandleInDirectory(
      directoryHandle,
      fileName,
      existingFileDescription,
      { allowEmptyExisting, validateExisting },
    );
    if (!alreadySaved) {
      writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      writable = null;
    }
    const savedFile = await fileHandle.getFile();
    const verified = alreadySaved && validateExisting
      ? await validateExisting(savedFile)
      : await fileMatchesExpectedText(savedFile, text);
    if (!verified) {
      throw new Error('El archivo guardado no pudo comprobarse.');
    }
    return { saved: true, alreadySaved, directoryHandle, prepared };
  } catch (error) {
    if (writable) {
      try {
        await writable.abort();
      } catch (_) {
        // El guardado sigue pendiente aunque el navegador no pueda abortar el archivo parcial.
      }
    }
    return {
      saved: false,
      cancelled: isCancelledFileOperation(error),
      existingFile: isExistingFileError(error),
      error,
    };
  }
}

function saveNewUsbKeyInDirectory(text, fileName) {
  return saveNewTextInDirectory(text, fileName, {
    pickerId: 'pwm-usb-keys',
    existingFileDescription: 'una llave anterior',
  });
}

async function validatePreviousBackupFile(file, pending) {
  if (file.size <= 0 || file.size > BACKUP_MAX_BYTES) {
    throw new Error(`La copia anterior “${file.name}” no tiene un tamaño válido.`);
  }

  const text = await file.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch (_) {
    throw new Error(`La copia anterior “${file.name}” no es un JSON válido.`);
  }

  const hasValidRecord = validateVaultRecord(value?.vault);
  const currentRecord = JSON.parse(pending.recordSnapshot);
  const validIdentity = hasValidRecord && (
    value.version === 3
      ? value.vaultUid === pending.vaultUid
      : value.version === 2
        && await vaultIdentityFingerprint(value.vault) === await vaultIdentityFingerprint(currentRecord)
  );

  if (
    !value
    || value.format !== 'pwm-vault-backup'
    || (value.version !== 2 && value.version !== 3)
    || !validIdentity
    || value.backupVersion !== pending.previousBackupVersion
    || !hasValidRecord
  ) {
    throw new Error(`La copia anterior “${file.name}” no es el respaldo PWM v${pending.previousBackupVersion} válido de esta bóveda.`);
  }

  return { text };
}

async function isPreparedBackupFile(file, pending) {
  if (file.size <= 0 || file.size > BACKUP_MAX_BYTES) return false;

  let value;
  let expected;
  try {
    value = JSON.parse(await file.text());
    expected = JSON.parse(pending.text);
  } catch (_) {
    return false;
  }

  return Boolean(
    value
    && value.format === 'pwm-vault-backup'
    && value.version === 3
    && value.vaultUid === pending.vaultUid
    && value.backupVersion === pending.backupVersion
    && value.usbKeyVersion === expected.usbKeyVersion
    && value.name === expected.name
    && validateVaultRecord(value.vault)
    && JSON.stringify(value.vault) === pending.recordSnapshot
  );
}

async function findValidatedPreviousBackup(directoryHandle, pending) {
  if (!pending.previousFileName) return null;

  try {
    const fileHandle = await directoryHandle.getFileHandle(pending.previousFileName, { create: false });
    const validated = await validatePreviousBackupFile(await fileHandle.getFile(), pending);
    return { fileName: pending.previousFileName, ...validated };
  } catch (error) {
    if (error?.name === 'NotFoundError') {
      throw new Error(`No encontré “${pending.previousFileName}” en esta carpeta. Elegí la carpeta donde está la copia v${pending.previousBackupVersion}.`);
    }
    throw error;
  }
}

async function removeValidatedPreviousBackup(directoryHandle, pending, previousBackup) {
  if (!previousBackup?.fileName) return { removed: false, status: 'none' };

  try {
    // Revalidamos justo antes de borrar para no eliminar un archivo que haya cambiado durante la exportación.
    const fileHandle = await directoryHandle.getFileHandle(previousBackup.fileName, { create: false });
    const currentFile = await fileHandle.getFile();
    const currentBackup = await validatePreviousBackupFile(currentFile, pending);
    if (currentBackup.text !== previousBackup.text) {
      throw new Error('La copia anterior cambió durante la exportación.');
    }
    await directoryHandle.removeEntry(previousBackup.fileName);
    return { removed: true, status: 'removed' };
  } catch (error) {
    if (error?.name === 'NotFoundError') return { removed: false, status: 'missing' };
    return { removed: false, status: 'error', error };
  }
}

function saveNewBackupInDirectory(text, fileName, pending) {
  return saveNewTextInDirectory(text, fileName, {
    pickerId: 'pwm-vault-backups',
    existingFileDescription: 'una copia cifrada anterior',
    prepareDirectory: (directoryHandle) => findValidatedPreviousBackup(directoryHandle, pending),
    allowEmptyExisting: true,
    validateExisting: (file) => isPreparedBackupFile(file, pending),
  });
}

function vaultRecordSnapshot(record) {
  return JSON.stringify(record);
}

function clearPendingBackupExport() {
  if (state.pendingBackupExport) state.pendingBackupExport.text = '';
  state.pendingBackupExport = null;
}

function prepareBackupExport() {
  if (!state.record || !state.vaultId) return null;
  const metadata = state.index.vaults.find((vault) => vault.id === state.vaultId);
  if (!metadata || !validUuid(metadata.uid)) {
    showNotice('No pude identificar esta b\u00f3veda para exportarla.', 'error');
    return null;
  }
  const backupVersion = metadata.backupVersion + 1;
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
  return {
    vaultId: state.vaultId,
    vaultUid: metadata.uid,
    previousBackupVersion: metadata.backupVersion,
    backupVersion,
    recordSnapshot: vaultRecordSnapshot(state.record),
    text: JSON.stringify(backup, null, 2),
    fileName: `${safeFileName(state.vaultName)}-boveda-v${backupVersion}.pwm.json`,
    previousFileName: metadata.backupVersion > 0
      ? `${safeFileName(state.vaultName)}-boveda-v${metadata.backupVersion}.pwm.json`
      : null,
  };
}

async function completeBackupExport(pending) {
  const access = captureVaultAccess();
  if (
    !pending
    || !state.key
    || state.vaultId !== pending.vaultId
    || !state.record
    || vaultRecordSnapshot(state.record) !== pending.recordSnapshot
  ) {
    throw new Error('La b\u00f3veda cambi\u00f3 mientras se guardaba la copia. Exportala otra vez.');
  }

  const committed = await commitVaultSnapshot(
    access,
    pending.vaultId,
    pending.recordSnapshot,
    (metadata) => metadata.uid === pending.vaultUid
      && metadata.backupVersion === pending.previousBackupVersion,
    (index) => ({
      index: updateVaultMetadata(
        index,
        pending.vaultId,
        state.vaultName,
        state.record.updatedAt,
        { backupVersion: pending.backupVersion, backupReason: null, needsBackup: false },
      ),
    }),
  );
  assertVaultAccess(access, true);
  state.index = committed.index;
  clearPendingBackupExport();
  updateBackupReminder();
  showNotice(`Copia cifrada v${pending.backupVersion} de \u201c${state.vaultName}\u201d guardada y comprobada.`);
  resetAutoLock();
}

function openBackupVerificationDialog() {
  const pending = state.pendingBackupExport;
  if (!pending) return;
  $('backupVerificationName').textContent = pending.fileName;
  $('backupVerificationStatus').textContent = 'Hasta comprobarla, la b\u00f3veda seguir\u00e1 indicando que necesita una copia.';
  if (!$('backupVerificationDialog').open) $('backupVerificationDialog').showModal();
  $('selectBackupVerificationButton').focus();
}

function closeBackupVerificationDialog(discard = true) {
  if (discard) clearPendingBackupExport();
  $('backupVerificationInput').value = '';
  if ($('backupVerificationDialog').open) $('backupVerificationDialog').close();
}

function cancelBackupVerification() {
  closeBackupVerificationDialog();
  if (state.pendingBackupAction) closePendingBackupDialog();
  showNotice('El respaldo sigue pendiente: no se comprob\u00f3 una copia nueva.', 'error');
}

function continueAfterVerifiedBackup() {
  const action = state.pendingBackupAction;
  if (!action) return;
  closePendingBackupDialog();
  action();
}

async function verifyPendingBackupFile(event) {
  const [file] = event.target.files;
  event.target.value = '';
  const pending = state.pendingBackupExport;
  if (!file || !pending) return;
  $('selectBackupVerificationButton').disabled = true;
  try {
    if (file.size <= 0 || file.size > BACKUP_MAX_BYTES) {
      throw new Error('Ese archivo no puede ser la copia cifrada reci\u00e9n creada.');
    }
    if (await file.text() !== pending.text) {
      throw new Error('Ese archivo no es la copia cifrada que acab\u00e1s de exportar.');
    }
    await completeBackupExport(pending);
    closeBackupVerificationDialog(false);
    continueAfterVerifiedBackup();
  } catch (error) {
    $('backupVerificationStatus').textContent = error.message || 'No pude comprobar esa copia.';
    showNotice(error.message || 'No pude comprobar esa copia.', 'error');
  } finally {
    $('selectBackupVerificationButton').disabled = false;
  }
}

async function downloadBackup() {
  if (state.pendingBackupExport) {
    openBackupVerificationDialog();
    return false;
  }
  const pending = prepareBackupExport();
  if (!pending) return false;
  const button = $('exportButton');
  if (button.disabled) return false;
  button.disabled = true;
  try {
    if (canUseDirectoryPicker()) {
      const result = await saveNewBackupInDirectory(pending.text, pending.fileName, pending);
      if (result.saved) {
        await completeBackupExport(pending);
        const removedPrevious = await removeValidatedPreviousBackup(
          result.directoryHandle,
          pending,
          result.prepared,
        );
        if (removedPrevious.removed) {
          showNotice(
            `Copia cifrada v${pending.backupVersion} guardada y comprobada. Se retiró la copia anterior v${pending.previousBackupVersion}.`,
          );
        } else if (removedPrevious.status === 'missing') {
          showNotice(
            `La copia v${pending.backupVersion} fue guardada y comprobada. No encontré la copia anterior v${pending.previousBackupVersion}, así que no se eliminó nada.`,
          );
        } else if (removedPrevious.error) {
          showNotice(
            `La copia v${pending.backupVersion} fue guardada y comprobada. Conservé la copia anterior porque no pude borrarla automáticamente: ${removedPrevious.error.message || 'error desconocido'}.`,
            'error',
          );
        }
        return true;
      }
      if (result.existingFile) {
        showNotice(`${result.error.message} El respaldo sigue pendiente.`, 'error');
        return false;
      }
      if (result.cancelled) {
        showNotice('No se guard\u00f3 la copia. El respaldo sigue pendiente.', 'error');
        return false;
      }
      showNotice(
        `${result.error?.message || 'No se pudo guardar la copia en esa carpeta.'} El respaldo sigue pendiente.`,
        'error',
      );
      return false;
    }

    triggerTextDownload(pending.text, pending.fileName);
    state.pendingBackupExport = pending;
    openBackupVerificationDialog();
    showNotice('Eleg\u00ed la copia descargada para comprobarla antes de marcar el respaldo como realizado.');
    return false;
  } catch (error) {
    showNotice(error.message || 'No pude preparar la copia cifrada.', 'error');
    return false;
  } finally {
    button.disabled = false;
  }
}

function syncCheckpointKey(vaultId) {
  return `${SYNC_CHECKPOINT_PREFIX}${vaultId}`;
}

function syncError(message) {
  const error = new Error(message);
  error.name = 'SyncError';
  return error;
}

function entrySyncContent(entry) {
  return JSON.stringify({
    service: entry.service,
    username: entry.username,
    password: entry.password,
    website: entry.website,
    notes: entry.notes,
    favorite: entry.favorite === true,
  });
}

function syncVersion(kind, value) {
  return {
    kind,
    value,
    clock: normalizeSyncClock(value?.syncClock),
  };
}

function cloneSyncVersion(version) {
  if (!version) return null;
  if (version.kind === 'entry') {
    const entry = normalizeEntry(version.value);
    return syncVersion('entry', { ...entry, syncClock: normalizeSyncClock(entry.syncClock) });
  }
  const tombstone = normalizeTombstone(version.value);
  return tombstone ? syncVersion('delete', tombstone) : null;
}

function syncVersionsEquivalent(left, right) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'delete') return true;
  return entrySyncContent(left.value) === entrySyncContent(right.value);
}

function syncVersionState(version) {
  if (!version) return 'missing';
  const clock = Object.fromEntries(
    Object.entries(normalizeSyncClock(version.clock)).sort(([left], [right]) => left.localeCompare(right)),
  );
  if (version.kind === 'delete') {
    return JSON.stringify({ kind: 'delete', deletedAt: version.value.deletedAt, clock });
  }
  return JSON.stringify({
    kind: 'entry',
    content: entrySyncContent(version.value),
    createdAt: version.value.createdAt,
    updatedAt: version.value.updatedAt,
    clock,
  });
}

function buildSyncVersionMap(entries, tombstones) {
  const versions = new Map();
  entries.map(normalizeEntry).forEach((entry) => {
    if (versions.has(entry.id)) throw syncError('La copia contiene credenciales duplicadas y no puede fusionarse.');
    versions.set(entry.id, syncVersion('entry', entry));
  });
  normalizeTombstones(tombstones).forEach((tombstone) => {
    if (versions.has(tombstone.id)) {
      throw syncError('La copia marca una misma credencial como activa y eliminada. No se modificó la bóveda.');
    }
    versions.set(tombstone.id, syncVersion('delete', tombstone));
  });
  return versions;
}

function mergeSyncHistory(localHistory, incomingHistory) {
  const merged = new Map();
  const localEvents = normalizeHistory(localHistory);
  const incomingEvents = normalizeHistory(incomingHistory)
    .filter((event) => !LOCAL_ONLY_SYNC_HISTORY_TYPES.has(event.type));
  [...localEvents, ...incomingEvents].forEach((event) => {
    if (!merged.has(event.id)) merged.set(event.id, event);
  });
  return [...merged.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .slice(-HISTORY_LIMIT);
}

function countAppliedSyncChange(localVersion, nextVersion, counts) {
  if (!nextVersion || !localVersion) {
    if (nextVersion?.kind === 'entry') counts.added += 1;
    return;
  }
  if (localVersion.kind === 'entry' && nextVersion.kind === 'delete') {
    counts.deleted += 1;
    return;
  }
  if (localVersion.kind === 'delete' && nextVersion.kind === 'entry') {
    counts.added += 1;
    return;
  }
  if (
    localVersion.kind === 'entry'
    && nextVersion.kind === 'entry'
    && entrySyncContent(localVersion.value) !== entrySyncContent(nextVersion.value)
  ) counts.updated += 1;
}

function buildVaultSyncPlan(incomingPayload) {
  const localVersions = buildSyncVersionMap(state.entries, state.tombstones);
  const incomingVersions = buildSyncVersionMap(incomingPayload.entries, incomingPayload.tombstones);
  const resultVersions = new Map();
  const conflicts = [];
  const counts = { added: 0, updated: 0, deleted: 0 };
  const entryIds = new Set([...localVersions.keys(), ...incomingVersions.keys()]);

  entryIds.forEach((entryId) => {
    const local = localVersions.get(entryId) || null;
    const incoming = incomingVersions.get(entryId) || null;
    if (!local || !incoming) {
      const only = local || incoming;
      if (syncClockHasChanges(only.clock)) {
        resultVersions.set(entryId, cloneSyncVersion(only));
        if (!local) countAppliedSyncChange(local, only, counts);
      } else {
        conflicts.push({ id: crypto.randomUUID(), entryId, local, incoming, reason: 'legacy-missing' });
      }
      return;
    }

    const order = compareSyncClocks(local.clock, incoming.clock);
    if (order === 'left') {
      resultVersions.set(entryId, cloneSyncVersion(local));
      return;
    }
    if (order === 'right') {
      resultVersions.set(entryId, cloneSyncVersion(incoming));
      countAppliedSyncChange(local, incoming, counts);
      return;
    }
    if (syncVersionsEquivalent(local, incoming)) {
      const selected = cloneSyncVersion(local);
      selected.clock = mergeSyncClocks(local.clock, incoming.clock);
      selected.value.syncClock = selected.clock;
      resultVersions.set(entryId, selected);
      return;
    }
    conflicts.push({
      id: crypto.randomUUID(),
      entryId,
      local,
      incoming,
      reason: order === 'concurrent' ? 'concurrent' : 'legacy-different',
    });
  });

  const mergedHistory = mergeSyncHistory(state.history, incomingPayload.history);
  const historyChanged = JSON.stringify(mergedHistory) !== JSON.stringify(normalizeHistory(state.history));
  const automaticStateChanged = [...resultVersions.entries()].some(
    ([entryId, version]) => syncVersionState(localVersions.get(entryId) || null) !== syncVersionState(version),
  );
  return {
    resultVersions,
    conflicts,
    counts,
    mergedHistory,
    historyChanged,
    automaticStateChanged,
  };
}

function syncConflictEntry(conflict) {
  return conflict.local?.kind === 'entry'
    ? conflict.local.value
    : conflict.incoming?.kind === 'entry'
      ? conflict.incoming.value
      : null;
}

function syncConflictTitle(conflict) {
  return syncConflictEntry(conflict)?.service || 'Credencial eliminada';
}

function syncChangedFields(conflict) {
  if (conflict.local?.kind !== 'entry' || conflict.incoming?.kind !== 'entry') return [];
  const fields = [
    ['service', 'servicio'],
    ['username', 'correo/usuario'],
    ['password', 'contraseña'],
    ['website', 'sitio web'],
    ['notes', 'notas'],
    ['favorite', 'favorito'],
  ];
  return fields.filter(([field]) => conflict.local.value[field] !== conflict.incoming.value[field])
    .map(([, label]) => label);
}

function syncConflictDescription(conflict) {
  if (!conflict.local || !conflict.incoming) {
    return 'Sólo existe en uno de los archivos antiguos. Elegí conservarla o mantenerla eliminada.';
  }
  if (conflict.local.kind !== conflict.incoming.kind) {
    return 'Un dispositivo la eliminó y el otro la conservó o modificó.';
  }
  const fields = syncChangedFields(conflict);
  return fields.length
    ? `Ambos dispositivos cambiaron: ${fields.join(', ')}.`
    : 'Ambos dispositivos generaron versiones diferentes.';
}

function syncVersionOption(version, location) {
  if (!version || version.kind === 'delete') {
    return {
      label: location === 'local' ? 'Mantenerla eliminada en este dispositivo' : 'Aceptar que fue eliminada en el otro dispositivo',
      detail: 'La credencial no aparecerá en la bóveda fusionada.',
    };
  }
  const updatedAt = new Date(version.value.updatedAt);
  const date = Number.isNaN(updatedAt.getTime())
    ? 'fecha desconocida'
    : new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' }).format(updatedAt);
  return {
    label: location === 'local' ? 'Conservar la versión de este dispositivo' : 'Usar la versión del archivo importado',
    detail: `${version.value.username || 'Sin usuario'} · actualizada ${date}. La contraseña no se muestra en esta pantalla.`,
  };
}

function appendSyncConflictOption(container, conflict, choice, copy) {
  const label = document.createElement('label');
  label.className = 'sync-conflict-option';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = `sync-conflict-${conflict.id}`;
  input.value = choice;
  input.dataset.conflictId = conflict.id;
  const text = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = copy.label;
  const detail = document.createElement('small');
  detail.textContent = copy.detail;
  text.append(title, detail);
  label.append(input, text);
  container.append(label);
}

function renderSyncConflicts(conflicts) {
  const container = $('syncConflicts');
  container.replaceChildren();
  conflicts.forEach((conflict) => {
    const card = document.createElement('article');
    card.className = 'sync-conflict';
    const title = document.createElement('h4');
    title.textContent = syncConflictTitle(conflict);
    const description = document.createElement('p');
    description.textContent = syncConflictDescription(conflict);
    const options = document.createElement('div');
    options.className = 'sync-conflict-options';
    appendSyncConflictOption(options, conflict, 'local', syncVersionOption(conflict.local, 'local'));
    appendSyncConflictOption(options, conflict, 'incoming', syncVersionOption(conflict.incoming, 'incoming'));
    if (conflict.local?.kind === 'entry' && conflict.incoming?.kind === 'entry') {
      appendSyncConflictOption(options, conflict, 'both', {
        label: 'Conservar ambas como credenciales separadas',
        detail: 'PWM duplicará la versión importada para que puedas revisarlas después.',
      });
    }
    card.append(title, description, options);
    container.append(card);
  });
}

function syncSelectionsComplete() {
  const pending = state.pendingSync;
  if (!pending) return false;
  return pending.conflicts.every((conflict) => Boolean(pending.choices.get(conflict.id)));
}

function updateApplySyncButton() {
  const pending = state.pendingSync;
  const hasChanges = Boolean(
    pending
    && (pending.automaticStateChanged || pending.conflicts.length || pending.historyChanged),
  );
  $('applySyncButton').disabled = !hasChanges || !syncSelectionsComplete();
}

function renderSyncPreview() {
  const pending = state.pendingSync;
  if (!pending) return;
  $('syncIntroStep').classList.add('hidden');
  $('syncPreviewStep').classList.remove('hidden');
  $('syncAddedCount').textContent = String(pending.counts.added);
  $('syncUpdatedCount').textContent = String(pending.counts.updated);
  $('syncDeletedCount').textContent = String(pending.counts.deleted);
  $('syncConflictCount').textContent = String(pending.conflicts.length);
  const hasChanges = Boolean(
    pending.automaticStateChanged || pending.conflicts.length || pending.historyChanged
  );
  $('syncSourceText').textContent = pending.conflicts.length
    ? `La copia “${pending.fileName}” pertenece a esta bóveda. Revisá ${pending.conflicts.length} ${pending.conflicts.length === 1 ? 'conflicto' : 'conflictos'} antes de continuar.`
    : hasChanges
      ? `La copia “${pending.fileName}” pertenece a esta bóveda. Los cambios compatibles están listos para aplicarse.`
      : `La copia “${pending.fileName}” pertenece a esta bóveda, pero no contiene cambios nuevos. Ambos archivos ya están sincronizados.`;
  $('syncConflictSection').classList.toggle('hidden', !pending.conflicts.length);
  renderSyncConflicts(pending.conflicts);
  updateApplySyncButton();
}

function clearPendingSync() {
  state.pendingSync = null;
  $('syncInput').value = '';
  $('syncConflicts').replaceChildren();
}

function closeSyncDialog() {
  clearPendingSync();
  $('syncPreviewStep').classList.add('hidden');
  $('syncIntroStep').classList.remove('hidden');
  if ($('syncDialog').open) $('syncDialog').close();
  resetAutoLock();
}

async function updateUndoSyncAvailability() {
  const button = $('undoSyncButton');
  button.classList.add('hidden');
  if (!state.vaultId || !state.record) return;
  try {
    const checkpoint = await readValue(syncCheckpointKey(state.vaultId));
    if (
      checkpoint?.format === 'pwm-sync-checkpoint'
      && checkpoint.version === 1
      && checkpoint.vaultUid === state.index.vaults.find((vault) => vault.id === state.vaultId)?.uid
      && checkpoint.afterSnapshot === vaultRecordSnapshot(state.record)
      && validateVaultRecord(checkpoint.beforeRecord)
    ) button.classList.remove('hidden');
  } catch (_) {
    // La sincronización sigue disponible aunque no pueda ofrecerse deshacer.
  }
}

async function openSyncDialog() {
  if (!state.key || !state.vaultId || !state.record) return;
  state.pendingSync = null;
  $('syncPreviewStep').classList.add('hidden');
  $('syncIntroStep').classList.remove('hidden');
  $('syncDialog').showModal();
  await updateUndoSyncAvailability();
  $('chooseSyncFileButton').focus();
  resetAutoLock();
}

async function prepareSyncFile(event) {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file || !state.key || !state.vaultId || !state.record) return;
  $('chooseSyncFileButton').disabled = true;
  try {
    if (file.size <= 0 || file.size > BACKUP_MAX_BYTES) {
      throw syncError('La copia seleccionada no tiene un tamaño válido.');
    }
    const parsed = JSON.parse(await file.text());
    if (parsed?.format === USB_KEY_FORMAT) throw syncError(KEY_AS_VAULT_MESSAGE);
    if (parsed?.format !== 'pwm-vault-backup' || parsed.version !== 3) {
      throw syncError('Elegí una copia cifrada reciente exportada desde la misma bóveda.');
    }
    const metadata = state.index.vaults.find((vault) => vault.id === state.vaultId);
    if (!metadata || parsed.vaultUid !== metadata.uid) {
      const otherName = typeof parsed.name === 'string' && parsed.name.trim() ? ` “${parsed.name.trim()}”` : '';
      throw syncError(`Esa copia pertenece a otra bóveda${otherName}. Elegí una exportación de “${state.vaultName}”.`);
    }
    if (!validateVaultRecord(parsed.vault) || parsed.vault.version !== 2) {
      throw syncError('La copia pertenece a esta bóveda, pero usa un formato antiguo. Abrila y exportala nuevamente en el otro dispositivo.');
    }

    let incomingPayload;
    try {
      incomingPayload = await decryptPayloadV2(state.key, parsed.vault);
    } catch (_) {
      throw syncError('La copia tiene el mismo identificador, pero no comparte la clave de cifrado de esta bóveda. No se modificó nada.');
    }
    const plan = buildVaultSyncPlan(incomingPayload);
    state.pendingSync = {
      ...plan,
      choices: new Map(),
      fileName: file.name,
      sourceName: typeof parsed.name === 'string' ? parsed.name : state.vaultName,
    };
    renderSyncPreview();
    resetAutoLock();
  } catch (error) {
    showNotice(
      error.name === 'SyncError' ? error.message : 'No pude leer esa copia para sincronizar. No se modificó la bóveda.',
      'error',
    );
  } finally {
    $('chooseSyncFileButton').disabled = false;
  }
}

function resolvedConflictVersions(conflict, choice) {
  const combinedClock = resolvedSyncClock(conflict.local?.clock, conflict.incoming?.clock);
  const now = new Date().toISOString();
  if (choice === 'both' && conflict.local?.kind === 'entry' && conflict.incoming?.kind === 'entry') {
    const localEntry = normalizeEntry({
      ...conflict.local.value,
      updatedAt: now,
      syncClock: combinedClock,
    });
    const incomingEntry = normalizeEntry({
      ...conflict.incoming.value,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      syncClock: nextSyncClock(),
    });
    return [syncVersion('entry', localEntry), syncVersion('entry', incomingEntry)];
  }

  const selected = choice === 'incoming' ? conflict.incoming : conflict.local;
  if (selected?.kind === 'entry') {
    const entry = normalizeEntry({ ...selected.value, updatedAt: now, syncClock: combinedClock });
    return [syncVersion('entry', entry)];
  }
  return [syncVersion('delete', {
    id: conflict.entryId,
    deletedAt: now,
    syncClock: combinedClock,
  })];
}

async function applyPendingSync() {
  const pending = state.pendingSync;
  if (!pending || !syncSelectionsComplete() || !state.key || !state.vaultId) return;
  const button = $('applySyncButton');
  button.disabled = true;
  const previousEntries = state.entries;
  const previousTombstones = state.tombstones;
  const previousHistory = state.history;
  const beforeRecord = state.record;
  const access = captureVaultAccess();
  const metadata = state.index.vaults.find((vault) => vault.id === state.vaultId);
  let mergeCommitted = false;
  try {
    assertVaultAccess(access, true);
    const versions = new Map(pending.resultVersions);
    const finalCounts = { ...pending.counts };
    pending.conflicts.forEach((conflict) => {
      const choice = pending.choices.get(conflict.id);
      const resolved = resolvedConflictVersions(conflict, choice);
      versions.set(conflict.entryId, resolved[0]);
      countAppliedSyncChange(conflict.local, resolved[0], finalCounts);
      if (resolved[1]) {
        versions.set(resolved[1].value.id, resolved[1]);
        finalCounts.added += 1;
      }
    });
    state.entries = [];
    state.tombstones = [];
    versions.forEach((version) => {
      if (version.kind === 'entry') state.entries.push(normalizeEntry(version.value));
      if (version.kind === 'delete') state.tombstones.push(normalizeTombstone(version.value));
    });
    state.tombstones = normalizeTombstones(state.tombstones);
    state.history = pending.mergedHistory;
    const visibleChangeCount = finalCounts.added + finalCounts.updated + finalCounts.deleted;
    await saveVault(
      'sync',
      createHistoryEvent(
        'sync-merged',
        visibleChangeCount
          ? `${finalCounts.added} nuevas, ${finalCounts.updated} actualizadas, ${finalCounts.deleted} eliminadas`
          : 'estado entre dispositivos actualizado',
      ),
      {
        syncCheckpointBeforeRecord: beforeRecord,
        syncVaultUid: metadata?.uid,
      },
    );
    mergeCommitted = true;
    closeSyncDialog();
    renderEntries();
    showNotice('Sincronización aplicada. Exportá la bóveda ahora. En el otro dispositivo, usá Sincronizar → Fusionar copia con ese archivo.');
  } catch (error) {
    if (!mergeCommitted && state.vaultAccess === access && state.key) {
      state.entries = previousEntries;
      state.tombstones = previousTombstones;
      state.history = previousHistory;
    }
    if (mergeCommitted) {
      closeSyncDialog();
      renderEntries();
      showNotice('La sincronización se guardó, pero ocurrió un problema al cerrar el proceso. Exportá la bóveda ahora.', 'error');
    } else {
      showNotice(error.message || 'No se pudo aplicar la sincronización. No se modificó la bóveda.', 'error');
    }
  } finally {
    button.disabled = false;
  }
}

function buildUndoneSyncState(payload) {
  const currentVersions = buildSyncVersionMap(state.entries, state.tombstones);
  const previousVersions = buildSyncVersionMap(payload.entries, payload.tombstones);
  const entryIds = new Set([...currentVersions.keys(), ...previousVersions.keys()]);
  const entries = [];
  const tombstones = [];
  const now = new Date().toISOString();

  entryIds.forEach((entryId) => {
    const current = currentVersions.get(entryId) || null;
    const previous = previousVersions.get(entryId) || null;
    if (previous?.kind === 'entry') {
      entries.push(normalizeEntry({
        ...previous.value,
        syncClock: resolvedSyncClock(current?.clock, previous.clock),
      }));
      return;
    }
    if (previous?.kind === 'delete') {
      tombstones.push({
        id: entryId,
        deletedAt: now,
        syncClock: resolvedSyncClock(current?.clock, previous.clock),
      });
      return;
    }
    if (current?.kind === 'entry') {
      tombstones.push({
        id: entryId,
        deletedAt: now,
        syncClock: resolvedSyncClock(current.clock),
      });
      return;
    }
    if (current?.kind === 'delete') tombstones.push(normalizeTombstone(current.value));
  });

  return { entries, tombstones: normalizeTombstones(tombstones) };
}

async function undoLastSync() {
  if (!state.key || !state.vaultId || !state.record) return;
  if (!window.confirm('¿Deshacer la última sincronización? Los cambios posteriores impedirían esta acción.')) return;
  const button = $('undoSyncButton');
  button.disabled = true;
  try {
    const access = captureVaultAccess();
    const expectedSnapshot = vaultRecordSnapshot(state.record);
    const checkpoint = await readValue(syncCheckpointKey(state.vaultId));
    const metadata = state.index.vaults.find((vault) => vault.id === state.vaultId);
    if (
      checkpoint?.format !== 'pwm-sync-checkpoint'
      || checkpoint.version !== 1
      || checkpoint.vaultUid !== metadata?.uid
      || checkpoint.afterSnapshot !== expectedSnapshot
      || !validateVaultRecord(checkpoint.beforeRecord)
    ) throw syncError('La sincronización ya no puede deshacerse porque la bóveda cambió después.');

    const payload = await decryptPayloadV2(state.key, checkpoint.beforeRecord);
    const undone = buildUndoneSyncState(payload);
    const { entries, tombstones } = undone;
    const history = historyWithEvent(payload.history, createHistoryEvent('sync-undone'));
    const encrypted = await encryptPayloadV2(state.key, {
      syncVersion: SYNC_PAYLOAD_VERSION,
      entries,
      tombstones,
      history,
      appearance: normalizeAppearance(payload.appearance),
    });
    const updatedAt = new Date().toISOString();
    const record = { ...checkpoint.beforeRecord, ...encrypted, updatedAt };
    const committed = await commitVaultSnapshot(
      access,
      state.vaultId,
      expectedSnapshot,
      (currentMetadata) => currentMetadata.uid === checkpoint.vaultUid,
      (index) => ({
        record,
        index: updateVaultMetadata(
          index,
          state.vaultId,
          state.vaultName,
          updatedAt,
          { needsBackup: true, backupReason: 'sync' },
        ),
        deleteKeys: [syncCheckpointKey(state.vaultId)],
      }),
    );
    assertVaultAccess(access, true);
    state.entries = entries;
    state.tombstones = tombstones;
    state.history = history;
    state.appearance = normalizeAppearance(payload.appearance);
    state.record = record;
    state.index = committed.index;
    closeSyncDialog();
    applyVaultBackground(state.appearance);
    renderEntries();
    updateBackupReminder();
    showNotice('La última sincronización se deshizo. Exportá una copia nueva para respaldar este estado.');
  } catch (error) {
    showNotice(error.message || 'No pude deshacer la sincronización.', 'error');
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

async function duplicateVaultReason(backup, vaultName, index = state.index, access = null) {
  if (vaultNameExistsInIndex(index, vaultName)) {
    return `Ya existe una bóveda llamada “${vaultName}”.`;
  }
  if (backup.uid && index.vaults.some((vault) => vault.uid === backup.uid)) {
    return 'Esa bóveda ya está guardada en este navegador.';
  }

  const importedFingerprint = await vaultIdentityFingerprint(backup.record);
  for (const metadata of index.vaults) {
    const record = await readValue(vaultRecordKey(metadata.id));
    if (access) assertVaultAccess(access);
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

  if (file.size > BACKUP_MAX_BYTES) {
    showNotice('La copia cifrada supera el límite de 50 MiB y no se importó.', 'error');
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());
    if (parsed?.format === USB_KEY_FORMAT) {
      showNotice(KEY_AS_VAULT_MESSAGE, 'error');
      return;
    }
    const backup = extractBackup(parsed, file.name);
    const vaultName = cleanImportedVaultName(backup.name);
    await withTemporaryVaultAccess(async (access) => {
      const currentIndex = await readVaultIndexWithAccess(access, true);
      const duplicateReason = await duplicateVaultReason(backup, vaultName, currentIndex, access);
      if (duplicateReason) throw new Error(duplicateReason);

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
        ...currentIndex,
        activeVaultId: keepCurrentVault ? currentIndex.activeVaultId : vaultId,
        vaults: [...currentIndex.vaults, metadata],
      };
      await writeValues([
        [vaultRecordKey(vaultId), backup.record],
        [INDEX_KEY, nextIndex],
      ], access);
      assertVaultAccess(access);
      state.index = nextIndex;
      renderVaultSelect(vaultId);
      if (!keepCurrentVault) {
        state.index.activeVaultId = vaultId;
        setScreen('unlock');
      }
    });
    showNotice(`“${vaultName}” se importó como una bóveda nueva.`);
  } catch (error) {
    const duplicateMessages = [
      `Ya existe una bóveda llamada “${vaultName}”.`,
      'Esa bóveda ya está guardada en este navegador.',
      'Esa copia cifrada ya fue importada.',
    ];
    showNotice(
      duplicateMessages.includes(error.message)
        ? error.message
        : 'No pude leer esa copia cifrada.',
      'error',
    );
  }
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
  const access = captureVaultAccess();
  assertVaultAccess(access, true);
  const expectedSnapshot = vaultRecordSnapshot(state.record);
  const nextHistory = historyEvent
    ? historyWithEvent(state.history, historyEvent)
    : state.history;
  const encrypted = await encryptPayloadV2(state.key, {
    syncVersion: SYNC_PAYLOAD_VERSION,
    entries: state.entries,
    tombstones: state.tombstones,
    history: nextHistory,
    appearance: state.appearance,
  });
  const updatedAt = new Date().toISOString();
  const record = { ...nextRecord, ...encrypted, updatedAt };
  const updates = {
    ...metadataUpdates,
    backupReason: metadataUpdates.backupReason || 'usb',
    needsBackup: true,
  };
  const committed = await commitVaultSnapshot(
    access,
    state.vaultId,
    expectedSnapshot,
    (metadata) => !Number.isSafeInteger(updates.usbKeyVersion)
      || metadata.usbKeyVersion === updates.usbKeyVersion - 1,
    (index) => ({
      record,
      index: updateVaultMetadata(index, state.vaultId, state.vaultName, updatedAt, updates),
      deleteKeys: [syncCheckpointKey(state.vaultId)],
    }),
  );
  assertVaultAccess(access, true);
  state.record = record;
  state.history = nextHistory;
  state.index = committed.index;
  renderVaultSelect(state.vaultId);
}

function clearPendingUsbKey() {
  const pending = state.pendingUsbKey;
  if (pending?.secret) pending.secret.fill(0);
  if (pending) pending.text = '';
  state.pendingUsbKey = null;
}

function setUsbKeyBusy(busy) {
  state.usbKeyBusy = busy;
  ['cancelUsbKey', 'cancelPendingUsbKeyButton', 'disableUsbKeyButton', 'savePendingUsbKeyButton', 'verifyPendingUsbKeyButton']
    .forEach((id) => { $(id).disabled = busy; });
  $('usbKeyDialog').toggleAttribute('data-busy', busy);
}

function usbKeyStillActiveMessage() {
  return validUsbUnlock(state.record?.usbUnlock)
    ? 'La llave anterior sigue funcionando.'
    : 'La llave nueva todavía no está activa.';
}

function setUsbKeySetupStep() {
  $('usbKeySetupStep').classList.remove('hidden');
  $('usbKeyFileStep').classList.add('hidden');
  $('usbKeyFileText').textContent = '';
  $('usbKeyFileName').textContent = '';
  $('usbKeyFileStatus').textContent = '';
  $('verifyPendingUsbKeyButton').classList.add('hidden');
  $('savePendingUsbKeyButton').classList.remove('hidden');
}

function renderPendingUsbKeyStep() {
  const pending = state.pendingUsbKey;
  if (!pending) return;
  $('usbKeySetupStep').classList.add('hidden');
  $('usbKeyFileStep').classList.remove('hidden');
  $('usbKeyFileName').textContent = pending.fileName;
  const verifyButton = $('verifyPendingUsbKeyButton');
  const saveButton = $('savePendingUsbKeyButton');
  const previousKeyMessage = validUsbUnlock(state.record?.usbUnlock)
    ? 'Hasta activarla, la llave anterior sigue funcionando.'
    : 'La llave nueva todavía no está activa.';

  if (pending.fileVerified) {
    $('usbKeyFileTitle').textContent = 'Archivo comprobado';
    $('usbKeyFileText').textContent = 'El archivo coincide con la llave nueva. Activala para que esta bóveda pueda usarlo.';
    $('usbKeyFileStatus').textContent = previousKeyMessage;
    verifyButton.classList.add('hidden');
    saveButton.classList.remove('hidden');
    saveButton.textContent = 'Activar llave comprobada';
    return;
  }

  if (pending.downloadStarted) {
    $('usbKeyFileTitle').textContent = 'Comprobá el archivo descargado';
    $('usbKeyFileText').textContent = 'El navegador inició la descarga. Elegí ese mismo archivo para comprobarlo y activar la llave nueva.';
    $('usbKeyFileStatus').textContent = previousKeyMessage;
    verifyButton.classList.remove('hidden');
    saveButton.classList.add('hidden');
    return;
  }

  $('usbKeyFileTitle').textContent = 'Guardá y activá la llave';
  if (canUseDirectoryPicker()) {
    $('usbKeyFileText').textContent = 'Elegí la carpeta de tu USB. PWM guardará la llave sin reemplazar ningún archivo existente.';
    saveButton.textContent = 'Elegir carpeta y guardar';
  } else {
    $('usbKeyFileText').textContent = 'El navegador descargará el archivo. Elegilo después para comprobarlo antes de activar la llave nueva.';
    saveButton.textContent = 'Descargar y comprobar';
  }
  $('usbKeyFileStatus').textContent = previousKeyMessage;
  verifyButton.classList.add('hidden');
  saveButton.classList.remove('hidden');
}

async function pendingUsbKeyStillMatches(pending) {
  if (
    !pending
    || !state.key
    || !state.record
    || state.vaultId !== pending.vaultId
    || vaultRecordSnapshot(state.record) !== pending.recordSnapshot
  ) return false;

  const storedIndex = await readValue(INDEX_KEY);
  const storedRecord = await readValue(vaultRecordKey(pending.vaultId));
  if (!validateVaultIndex(storedIndex) || !validateVaultRecord(storedRecord)) return false;
  const metadata = storedIndex.vaults.find((vault) => vault.id === pending.vaultId);
  return Boolean(
    metadata
    && metadata.usbKeyVersion === pending.previousUsbKeyVersion
    && vaultRecordSnapshot(storedRecord) === pending.recordSnapshot,
  );
}

async function activatePendingUsbKey() {
  const pending = state.pendingUsbKey;
  if (!pending?.fileVerified) return;
  const access = captureVaultAccess();
  assertVaultAccess(access, true);
  if (!await pendingUsbKeyStillMatches(pending)) {
    throw new Error('La bóveda cambió antes de activar la llave. La llave nueva no se activó.');
  }
  await persistCurrentRecord(
    { ...state.record, usbUnlock: pending.usbUnlock },
    { usbKeyVersion: pending.usbKeyVersion, backupReason: 'usb' },
    createHistoryEvent('usb-key-created', `v${pending.usbKeyVersion}`),
  );
  const version = pending.usbKeyVersion;
  clearPendingUsbKey();
  // La activación ocurre mientras el diálogo está ocupado. Forzamos sólo este
  // cierre interno una vez que la escritura cifrada ya terminó con éxito.
  closeUsbKeyDialog(false, true, true);
  showNotice(`Llave v${version} activada. Es necesario exportar la bóveda a tu USB ahora: sin una copia nueva, esta llave no abrirá tus respaldos.`);
}

function beginUsbKeyDownloadVerification(pending) {
  triggerTextDownload(pending.text, pending.fileName);
  pending.downloadStarted = true;
  renderPendingUsbKeyStep();
  showNotice('Elegí el archivo descargado para comprobarlo antes de activar la llave nueva.');
}

async function savePendingUsbKey() {
  const pending = state.pendingUsbKey;
  if (!pending) return;
  const saveButton = $('savePendingUsbKeyButton');
  setUsbKeyBusy(true);
  try {
    if (pending.fileVerified) {
      await activatePendingUsbKey();
      return;
    }
    if (canUseDirectoryPicker()) {
      const result = await saveNewUsbKeyInDirectory(pending.text, pending.fileName);
      if (result.saved) {
        pending.fileVerified = true;
        renderPendingUsbKeyStep();
        await activatePendingUsbKey();
        return;
      }
      if (result.existingFile) {
        showNotice(`${result.error.message} ${usbKeyStillActiveMessage()}`, 'error');
        return;
      }
      if (result.cancelled) {
        showNotice(`No se guardó la llave. ${usbKeyStillActiveMessage()}`, 'error');
        return;
      }
      showNotice(
        `${result.error?.message || 'No se pudo guardar la llave en esa carpeta.'} ${usbKeyStillActiveMessage()}`,
        'error',
      );
      return;
    }
    beginUsbKeyDownloadVerification(pending);
  } catch (error) {
    renderPendingUsbKeyStep();
    showNotice(
      error.message || `El archivo se guardó, pero no se activó. ${usbKeyStillActiveMessage()}`,
      'error',
    );
  } finally {
    setUsbKeyBusy(false);
  }
}

async function verifyPendingUsbKeyFile(event) {
  const [file] = event.target.files;
  event.target.value = '';
  const pending = state.pendingUsbKey;
  if (!file || !pending) return;
  let usbKey;
  setUsbKeyBusy(true);
  try {
    usbKey = await readUsbKeyFile(file);
    if (usbKey.keyId !== pending.keyId || !equalBytes(usbKey.secret, pending.secret)) {
      throw new Error('El archivo elegido no coincide con la llave nueva.');
    }
    pending.fileVerified = true;
    renderPendingUsbKeyStep();
    await activatePendingUsbKey();
  } catch (error) {
    renderPendingUsbKeyStep();
    showNotice(error.message || 'No pude comprobar el archivo llave.', 'error');
  } finally {
    usbKey?.secret.fill(0);
    setUsbKeyBusy(false);
  }
}

function openUsbKeyDialog() {
  if (!state.record || state.record.version !== 2) return;
  clearPendingUsbKey();
  $('usbKeyForm').reset();
  setUsbKeySetupStep();
  const configured = validUsbUnlock(state.record.usbUnlock);
  $('usbKeyStatus').textContent = configured
    ? 'Hay un archivo llave activo. Crear otro dejará de aceptar el anterior.'
    : 'No hay ningún archivo llave activo para esta bóveda.';
  $('disableUsbKeyButton').classList.toggle('hidden', !configured);
  $('usbKeyDialog').showModal();
  $('usbMaster').focus();
  resetAutoLock();
}

function closeUsbKeyDialog(discardPending = true, silent = false, force = false) {
  if (state.usbKeyBusy && !force) return;
  const hadPending = Boolean(state.pendingUsbKey);
  const hadPreviousKey = validUsbUnlock(state.record?.usbUnlock);
  if (discardPending) clearPendingUsbKey();
  $('usbKeyForm').reset();
  $('usbKeyVerificationInput').value = '';
  setUsbKeySetupStep();
  if ($('usbKeyDialog').open) $('usbKeyDialog').close();
  setUsbKeyBusy(false);
  resetAutoLock();
  if (hadPending && !silent) {
    showNotice(
      hadPreviousKey
        ? 'La llave nueva no se activó. La llave anterior sigue funcionando.'
        : 'La llave nueva no se activó.',
      'error',
    );
  }
}

async function createOrReplaceUsbKey(event) {
  event.preventDefault();
  if (state.usbKeyBusy) return;
  let access;
  const master = $('usbMaster').value;
  $('usbMaster').value = '';
  if (!master) return showNotice('Ingresá tu clave maestra para preparar el archivo llave.', 'error');
  let secret;
  setUsbKeyBusy(true);
  try {
    access = captureVaultAccess();
    await verifyCurrentMaster(master);
    assertVaultAccess(access, true);
    const metadata = state.index.vaults.find((vault) => vault.id === state.vaultId);
    if (!metadata || !state.record) throw new Error('Bóveda no encontrada');
    const usbKeyVersion = metadata.usbKeyVersion + 1;
    const keyId = crypto.randomUUID();
    secret = randomDek();
    const secretKey = await importAesKey(secret);
    const usbUnlock = {
      keyId,
      ...(await wrapDek(secretKey, state.keyBytes, aad('usb-wrap', keyId))),
    };
    assertVaultAccess(access, true);
    clearPendingUsbKey();
    state.pendingUsbKey = {
      vaultId: state.vaultId,
      previousUsbKeyVersion: metadata.usbKeyVersion,
      usbKeyVersion,
      keyId,
      secret,
      usbUnlock,
      recordSnapshot: vaultRecordSnapshot(state.record),
      text: JSON.stringify(
        { format: USB_KEY_FORMAT, version: USB_KEY_VERSION, keyId, secret: base64FromBytes(secret) },
        null,
        2,
      ),
      fileName: `${safeFileName(state.vaultName)}-llave-v${usbKeyVersion}.json`,
      fileVerified: false,
      downloadStarted: false,
    };
    secret = null;
    renderPendingUsbKeyStep();
    showNotice('La llave nueva está lista, pero todavía no está activa. Guardala y comprobala para activarla.');
  } catch (_) {
    showNotice('La clave maestra no es correcta o no pude preparar el archivo llave.', 'error');
  } finally {
    $('usbMaster').value = '';
    secret?.fill(0);
    setUsbKeyBusy(false);
  }
}

async function disableUsbKey() {
  const master = $('usbMaster').value;
  $('usbMaster').value = '';
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
  } finally {
    $('usbMaster').value = '';
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

  try {
    const access = captureVaultAccess();
    const currentIndex = await readVaultIndexWithAccess(access);
    const remainingVaults = currentIndex.vaults.filter((vault) => vault.id !== deletedVaultId);
    if (remainingVaults.length === currentIndex.vaults.length) {
      throw new Error('La bóveda ya no existe en este navegador.');
    }
    const nextIndex = {
      ...currentIndex,
      activeVaultId: remainingVaults[0]?.id ?? null,
      vaults: remainingVaults,
    };
    await writeAndDeleteValues(
      [[INDEX_KEY, nextIndex]],
      [vaultRecordKey(deletedVaultId), syncCheckpointKey(deletedVaultId)],
      access,
    );
    assertVaultAccess(access, true);
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
    const access = captureVaultAccess();
    const expectedSnapshot = vaultRecordSnapshot(state.record);
    await verifyCurrentMaster(currentMaster);
    assertVaultAccess(access, true);
    const salt = newSalt();
    const newPasswordKey = await deriveKey(newMaster, salt, PBKDF2_ITERATIONS);
    const passwordWrap = await wrapDek(newPasswordKey, state.keyBytes, aad('password-wrap'));
    const nextHistory = historyWithEvent(
      state.history,
      createHistoryEvent('master-password-changed'),
    );
    const encrypted = await encryptPayloadV2(state.key, {
      syncVersion: SYNC_PAYLOAD_VERSION,
      entries: state.entries,
      tombstones: state.tombstones,
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
    const committed = await commitVaultSnapshot(
      access,
      state.vaultId,
      expectedSnapshot,
      () => true,
      (index) => ({
        record: nextRecord,
        index: updateVaultMetadata(
          index,
          state.vaultId,
          state.vaultName,
          updatedAt,
          { needsBackup: true, backupReason: 'master' },
        ),
        deleteKeys: [syncCheckpointKey(state.vaultId)],
      }),
    );
    assertVaultAccess(access, true);
    state.record = nextRecord;
    state.history = nextHistory;
    state.index = committed.index;
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
    if (action === 'favorite') toggleFavorite(id, button);
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
  $('syncButton').addEventListener('click', openSyncDialog);
  $('closeSyncButton').addEventListener('click', closeSyncDialog);
  $('cancelSyncPreviewButton').addEventListener('click', closeSyncDialog);
  $('chooseSyncFileButton').addEventListener('click', () => $('syncInput').click());
  $('syncInput').addEventListener('change', prepareSyncFile);
  $('syncConflicts').addEventListener('change', (event) => {
    const input = event.target.closest('input[data-conflict-id]');
    if (!input || !state.pendingSync) return;
    state.pendingSync.choices.set(input.dataset.conflictId, input.value);
    updateApplySyncButton();
    resetAutoLock();
  });
  $('applySyncButton').addEventListener('click', applyPendingSync);
  $('undoSyncButton').addEventListener('click', undoLastSync);
  $('exportForSyncButton').addEventListener('click', () => {
    closeSyncDialog();
    downloadBackup();
  });
  $('syncDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeSyncDialog();
  });
  $('newVaultButton').addEventListener('click', () => showSetup(true));
  $('cancelSetupButton').addEventListener('click', () => {
    $('setupForm').reset();
    $('setupMaster').value = '';
    $('setupConfirm').value = '';
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
  $('cancelPendingUsbKeyButton').addEventListener('click', closeUsbKeyDialog);
  $('disableUsbKeyButton').addEventListener('click', disableUsbKey);
  $('savePendingUsbKeyButton').addEventListener('click', savePendingUsbKey);
  $('verifyPendingUsbKeyButton').addEventListener('click', () => $('usbKeyVerificationInput').click());
  $('usbKeyVerificationInput').addEventListener('change', verifyPendingUsbKeyFile);
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
  $('selectBackupVerificationButton').addEventListener('click', () => $('backupVerificationInput').click());
  $('backupVerificationInput').addEventListener('change', verifyPendingBackupFile);
  $('cancelBackupVerificationButton').addEventListener('click', cancelBackupVerification);
  $('backupVerificationDialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    cancelBackupVerification();
  });

  $('exportButton').addEventListener('click', downloadBackup);
  $('dismissBackupReminder').addEventListener('click', dismissBackupReminder);
  $('importButton').addEventListener('click', () => $('importInput').click());
  $('showImportFromLock').addEventListener('click', () => $('importInput').click());
  $('showImportFromSetup').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', importBackup);
  window.addEventListener('pagehide', lockVaultOnPageExit);
  window.addEventListener('pageshow', lockRestoredVault);
  window.addEventListener('storage', handleLegacyVaultLeaseStorage);
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
