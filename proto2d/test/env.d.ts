// Minimal Node globals used by the diagnostic tests (avoids pulling in @types/node).
declare const process: { env: Record<string, string | undefined> };
declare module "node:fs" {
  export function writeFileSync(path: string, data: string): void;
  export function readFileSync(path: string, enc: string): string;
}
