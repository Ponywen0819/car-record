import { readStorage, writeStorage } from '../lib/storage';

export const KEY_CURRENT_VEHICLE = 'car-record.currentVehicleId';
export const KEY_API_TOKEN = 'car-record.apiToken';

export function loadCurrentVehicleId(): string | null {
  return readStorage(KEY_CURRENT_VEHICLE);
}

export function saveCurrentVehicleId(id: string | null): void {
  writeStorage(KEY_CURRENT_VEHICLE, id);
}

export function getApiToken(): string | undefined {
  const t = readStorage(KEY_API_TOKEN)?.trim();
  return t ? t : undefined;
}

export function setApiToken(token: string): void {
  const t = token.trim();
  writeStorage(KEY_API_TOKEN, t ? t : null);
}
