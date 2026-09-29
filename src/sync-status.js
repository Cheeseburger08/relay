export function historySyncMessage(sync = {}, online = false) {
  const waiting = sync.awaitingHistory || 0;
  const pending = Math.max(0, (sync.pending || 0) - waiting);
  const parts = [];
  if (sync.failed) parts.push('Some deletions could not be confirmed on the phone.');
  if (pending) parts.push(online ? 'Syncing deletions with your phone...' : 'Deletions will sync when your phone reconnects.');
  if (waiting) parts.push(`${waiting} deleted ${waiting === 1 ? 'item is' : 'items are'} waiting to be matched with phone history. Unmatched deletion requests cancel after five minutes.`);
  return parts.join(' ');
}
