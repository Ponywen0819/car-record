// Global test setup for the web app.
// - fake-indexeddb gives Dexie a real IndexedDB implementation under jsdom.
// - jest-dom adds DOM matchers (toBeInTheDocument, ...).
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// jsdom lacks matchMedia, which Ionic queries for dark mode / platform detection.
// (Tests marked `@vitest-environment node` have no window at all.)
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
