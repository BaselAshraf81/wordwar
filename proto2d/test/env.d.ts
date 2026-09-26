// Minimal Node globals used by the diagnostic tests (avoids pulling in @types/node).
declare const process: { env: Record<string, string | undefined> };
