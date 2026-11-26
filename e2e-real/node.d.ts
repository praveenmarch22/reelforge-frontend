// The two Node APIs these tests use (the project does not install @types/node).

declare const process: {env: Record<string, string | undefined>};

declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], options?: {encoding: 'utf8'; input?: string}): string;
}
