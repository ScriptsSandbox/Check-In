export function chunkItems<T>(items: T[], size = 35): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("Batch size must be a positive integer.");
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function safeImportError(error: unknown): { errorCode: string; errorDetail: string } {
  const message = error instanceof Error ? error.message : "unknown";
  if (/unique constraint/i.test(message)) {
    return { errorCode: "constraint_conflict", errorDetail: "An imported identifier already exists." };
  }
  if (/foreign key/i.test(message)) {
    return { errorCode: "relationship_conflict", errorDetail: "An import relationship could not be created." };
  }
  return { errorCode: "import_failed", errorDetail: "The staging import stopped before completion." };
}
