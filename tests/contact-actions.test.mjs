import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteContacts } from "../src/contact-actions.js";

test("bulk contacts use synchronized deletion and stop with accurate partial progress", async () => {
  const calls = [];
  await deleteContacts(
    async (path, options) => calls.push([path, options.method]),
    ["first", "second"],
  );
  assert.deepEqual(calls, [
    ["/contacts/first", "DELETE"],
    ["/contacts/second", "DELETE"],
  ]);
  const attempted = [];
  await assert.rejects(
    deleteContacts(
      async (path) => {
        attempted.push(path);
        if (path.endsWith("second")) throw new Error("Connection lost.");
      },
      ["first", "second", "third"],
    ),
    /Deleted 1 of 3 contacts.*Connection lost/,
  );
  assert.deepEqual(attempted, ["/contacts/first", "/contacts/second"]);
  await deleteContacts(
    () => assert.fail("Empty list must not send a deletion"),
    [],
  );
});
