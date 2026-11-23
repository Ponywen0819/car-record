import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './registerServiceWorker';

function fakeContainer(hasController: boolean) {
  const target = new EventTarget();
  return Object.assign(target, {
    controller: hasController ? {} : null,
    register: vi.fn(async () => ({ update: vi.fn() })),
  });
}

describe('registerServiceWorker', () => {
  it('registers /sw.js with root scope', async () => {
    const sw = fakeContainer(false);
    await registerServiceWorker({ serviceWorker: sw } as unknown as Navigator, () => {});
    expect(sw.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('reloads once when an updated worker takes control', async () => {
    const sw = fakeContainer(true);
    const reload = vi.fn();
    await registerServiceWorker({ serviceWorker: sw } as unknown as Navigator, reload);
    sw.dispatchEvent(new Event('controllerchange'));
    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on the very first install', async () => {
    const sw = fakeContainer(false);
    const reload = vi.fn();
    await registerServiceWorker({ serviceWorker: sw } as unknown as Navigator, reload);
    sw.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('is a no-op without service worker support (plain HTTP)', async () => {
    await expect(registerServiceWorker({} as Navigator, () => {})).resolves.toBeUndefined();
  });
});
