import assert from "node:assert/strict";
import test from "node:test";

import { chunkItems, safeImportError } from "../lib/sync/staging-import-utils.ts";

test("chunks large staging writes into bounded batches", () => {
  assert.deepEqual(chunkItems([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.throws(() => chunkItems([1], 0), /positive integer/);
});

test("database failures are reduced to non-sensitive messages", () => {
  assert.deepEqual(safeImportError(new Error("UNIQUE constraint failed: users.primary_email with private value")), {
    errorCode: "constraint_conflict",
    errorDetail: "An imported identifier already exists.",
  });
  assert.deepEqual(safeImportError(new Error("raw card 04-AA-BB-CC failed unexpectedly")), {
    errorCode: "import_failed",
    errorDetail: "The staging import stopped before completion.",
  });
});
