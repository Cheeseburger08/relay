import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historySyncMessage } from '../src/sync-status.js';
test('history status separates online sync, offline sync and unmatched deletions', () => {
 assert.equal(historySyncMessage(), '');
 assert.match(historySyncMessage({pending:1},true), /Syncing deletions with your phone/);
 assert.match(historySyncMessage({pending:1},false), /reconnects/);
 const unmatched={pending:2,awaitingHistory:2};
 assert.equal(historySyncMessage(unmatched,true), '2 deleted items are waiting to be matched with phone history.');
 assert.equal(historySyncMessage(unmatched,true), historySyncMessage(unmatched,false));
 assert.match(historySyncMessage({pending:2,awaitingHistory:1},true), /Syncing deletions.*1 deleted item is/);
 assert.match(historySyncMessage({failed:1},true), /could not be confirmed/);
 assert.doesNotMatch(historySyncMessage({failed:1},true), /permissions|offline/);
});
