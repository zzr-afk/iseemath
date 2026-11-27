import { nanoid } from 'nanoid';
import { db } from './db';

export const LEASE_HEARTBEAT_MS = 2_000;
export const LEASE_TIMEOUT_MS = 6_000;

const TAB_ID_KEY = 'iseemath:tabId';

export function getTabId(): string {
  let tabId = sessionStorage.getItem(TAB_ID_KEY);
  if (!tabId) {
    tabId = nanoid(12);
    sessionStorage.setItem(TAB_ID_KEY, tabId);
  }
  return tabId;
}

/**
 * Try to become the single writer for a project. IndexedDB serializes the
 * readwrite transaction, so at most one tab can observe a stale lease and
 * increment the fencing token.
 */
export async function acquireLease(
  projectId: string,
  tabId: string,
  now = Date.now(),
): Promise<number | null> {
  return db.transaction('rw', db.leases, async () => {
    const lease = await db.leases.get(projectId);
    const stale =
      !lease ||
      lease.leaderTabId === tabId ||
      now - lease.leaderHeartbeatAt > LEASE_TIMEOUT_MS;
    if (!stale) return null;
    const leaseToken = (lease?.leaseToken ?? 0) + 1;
    await db.leases.put({
      projectId,
      leaseToken,
      leaderTabId: tabId,
      leaderHeartbeatAt: now,
    });
    return leaseToken;
  });
}

/** Refresh the heartbeat only while we still hold the current token. */
export async function heartbeat(
  projectId: string,
  tabId: string,
  leaseToken: number,
  now = Date.now(),
): Promise<boolean> {
  return db.transaction('rw', db.leases, async () => {
    const lease = await db.leases.get(projectId);
    if (!lease || lease.leaderTabId !== tabId || lease.leaseToken !== leaseToken) {
      return false;
    }
    await db.leases.put({ ...lease, leaderHeartbeatAt: now });
    return true;
  });
}

/** Release the lease early so another tab can take over immediately. */
export async function releaseLease(
  projectId: string,
  tabId: string,
  leaseToken: number,
): Promise<void> {
  await db.transaction('rw', db.leases, async () => {
    const lease = await db.leases.get(projectId);
    if (!lease || lease.leaderTabId !== tabId || lease.leaseToken !== leaseToken) return;
    await db.leases.put({ ...lease, leaderHeartbeatAt: 0 });
  });
}
