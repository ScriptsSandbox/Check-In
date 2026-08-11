import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createDryRunManifest,
  issuesToCsv,
  reconcileSourceSnapshot,
  type SourceSnapshot,
} from "../lib/sync/reconciliation.ts";

const [, , inputPath, outputDirectory] = process.argv;

if (!inputPath || !outputDirectory) {
  throw new Error(
    "Usage: node --experimental-strip-types scripts/reconcile-source-snapshot.ts INPUT_JSON OUTPUT_DIRECTORY",
  );
}

const input = JSON.parse(await readFile(resolve(inputPath), "utf8")) as SourceSnapshot;
const result = reconcileSourceSnapshot(input);
const manifest = createDryRunManifest(result);
const destination = resolve(outputDirectory);

await mkdir(destination, { recursive: true });
await Promise.all([
  writeFile(resolve(destination, "dry-run-import-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  writeFile(resolve(destination, "migration-issue-register.csv"), issuesToCsv(result.issues)),
]);

process.stdout.write(
  `${JSON.stringify({
    canonicalAccounts: result.metrics.canonicalAccounts,
    issues: result.issues.length,
    safeCards: result.metrics.safeDistinctCards,
    sourceWritesPerformed: false,
    productionWritesPerformed: false,
  })}\n`,
);
