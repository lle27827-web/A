export const OFFLINE_SYNC_TAG = "so-cong-pending-writes";
export const OFFLINE_SYNC_REQUEST_MESSAGE = "SO_CONG_SYNC_PENDING_WRITES";
export const OFFLINE_WRITE_QUEUED_EVENT = "so-cong:offline-write-queued";

const DATABASE_NAME = "so-cong-offline";
const DATABASE_VERSION = 1;
const STORE_NAME = "pending-writes";

export type OfflineWrite = {
  id: string;
  userId: string;
  businessId: string | null;
  url: string;
  method: "POST";
  body: string;
  headers: Record<string, string>;
  idempotencyStorageKey: string;
  createdAt: number;
  state: "pending" | "blocked";
  lastError?: string;
};

export type OfflineSyncResult = {
  synced: number;
  blocked: number;
  waitingForContext: boolean;
};

let currentUserId: string | null = null;

export function setOfflineSyncUserId(userId: string | null): void {
  currentUserId = userId;
}

export function getOfflineSyncUserId(): string | null {
  return currentUserId;
}

/**
 * Only queue create operations whose server handlers support idempotency.
 * Updates/deletes and payment/card actions stay online-only to avoid delayed,
 * surprising destructive or financial changes.
 */
export function isQueueableOfflineWrite(method: string, url: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  let pathname: string;
  try {
    pathname = new URL(url, "https://offline-check.invalid").pathname;
  } catch {
    return false;
  }
  return [
    "/api/attendance",
    "/api/service-sessions",
    "/api/appointments",
    "/api/personal/sessions",
  ].includes(pathname);
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("userId", "userId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
    request.onblocked = () => reject(new Error("Offline storage is blocked by another tab."));
  });
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline storage transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage transaction was aborted."));
  });
}

export async function enqueueOfflineWrite(
  write: Omit<OfflineWrite, "id" | "createdAt" | "state">,
): Promise<boolean> {
  if (!currentUserId || write.userId !== currentUserId || !isQueueableOfflineWrite(write.method, write.url)) {
    return false;
  }
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).add({
      ...write,
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: Date.now(),
      state: "pending",
    } satisfies OfflineWrite);
    await completeTransaction(transaction);
    return true;
  } finally {
    database.close();
  }
}

async function listUserWrites(userId: string): Promise<OfflineWrite[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).index("userId").getAll(userId);
    const entries = await new Promise<OfflineWrite[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as OfflineWrite[]);
      request.onerror = () => reject(request.error ?? new Error("Could not read offline writes."));
    });
    await completeTransaction(transaction);
    return entries.sort((left, right) => left.createdAt - right.createdAt);
  } finally {
    database.close();
  }
}

async function updateWrite(write: OfflineWrite): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(write);
    await completeTransaction(transaction);
  } finally {
    database.close();
  }
}

async function removeWrite(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    await completeTransaction(transaction);
  } finally {
    database.close();
  }
}

export async function flushOfflineWrites(
  send: (write: OfflineWrite) => Promise<unknown>,
  activeBusinessId: string | null,
): Promise<OfflineSyncResult> {
  if (!currentUserId) return { synced: 0, blocked: 0, waitingForContext: true };

  const entries = await listUserWrites(currentUserId);
  let synced = 0;
  let blocked = 0;
  let waitingForContext = false;

  for (const entry of entries) {
    // A queued business operation is sent only while that same business is
    // selected. Server-side membership and permission checks still run.
    if (entry.businessId !== activeBusinessId) {
      waitingForContext = true;
      continue;
    }
    if (entry.state === "blocked") {
      blocked += 1;
      continue;
    }

    try {
      await send(entry);
      await removeWrite(entry.id);
      synced += 1;
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : 0;
      if (status >= 400 && status < 500 && status !== 401) {
        entry.state = "blocked";
        entry.lastError = error instanceof Error ? error.message : "Máy chủ từ chối thao tác đang chờ.";
        await updateWrite(entry);
        blocked += 1;
        continue;
      }
      // Preserve order and retry later for network/server/authentication errors.
      break;
    }
  }

  return { synced, blocked, waitingForContext };
}

export async function requestOfflineBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const syncRegistration = registration as ServiceWorkerRegistration & {
      sync?: { register(tag: string): Promise<void> };
    };
    await syncRegistration.sync?.register(OFFLINE_SYNC_TAG);
  } catch {
    // The foreground "online" event remains the fallback where Background Sync
    // is unsupported or denied by the browser.
  }
}
