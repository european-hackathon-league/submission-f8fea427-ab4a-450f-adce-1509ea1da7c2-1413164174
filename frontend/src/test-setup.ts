import '@testing-library/jest-dom/vitest';

// Node 25 exposes an incomplete host storage object inside jsdom.
// Keep browser persistence semantics deterministic for workflow tests.
const values = new Map<string, string>();
if (typeof window !== 'undefined') Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, String(value)); },
  removeItem: (key: string) => { values.delete(key); },
  clear: () => values.clear(),
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
}});
