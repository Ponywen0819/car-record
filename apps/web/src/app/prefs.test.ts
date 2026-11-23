import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiToken, loadCurrentVehicleId, saveCurrentVehicleId, setApiToken } from './prefs';
import { pickCurrentVehicle } from './currentVehicle';
import type { Vehicle } from '@car-record/shared';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('current vehicle id persistence', () => {
  it('round-trips through localStorage', () => {
    expect(loadCurrentVehicleId()).toBeNull();
    saveCurrentVehicleId('v1');
    expect(loadCurrentVehicleId()).toBe('v1');
    saveCurrentVehicleId(null);
    expect(loadCurrentVehicleId()).toBeNull();
  });

  it('never throws when storage is unavailable (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveCurrentVehicleId('v1')).not.toThrow();
    expect(loadCurrentVehicleId()).toBeNull();
  });
});

describe('api token', () => {
  it('stores a trimmed token and clears it when blank', () => {
    expect(getApiToken()).toBeUndefined();
    setApiToken('  abc ');
    expect(getApiToken()).toBe('abc');
    setApiToken('');
    expect(getApiToken()).toBeUndefined();
  });
});

const v = (id: string, createdAt: number, deletedAt?: number): Vehicle => ({
  id,
  name: id,
  fuelType: 'gasoline',
  createdAt,
  updatedAt: createdAt,
  deletedAt,
});

describe('pickCurrentVehicle', () => {
  it('returns the stored vehicle when it exists', () => {
    expect(pickCurrentVehicle([v('a', 1), v('b', 2)], 'b')?.id).toBe('b');
  });
  it('falls back to the oldest active vehicle', () => {
    expect(pickCurrentVehicle([v('b', 2), v('a', 1)], 'zzz')?.id).toBe('a');
    expect(pickCurrentVehicle([v('a', 1, 5), v('b', 2)], 'a')?.id).toBe('b');
  });
  it('returns undefined when there is no vehicle', () => {
    expect(pickCurrentVehicle([], null)).toBeUndefined();
  });
});
