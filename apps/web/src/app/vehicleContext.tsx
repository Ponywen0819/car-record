import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Vehicle } from '@car-record/shared';
import { useServices } from './services';
import { loadCurrentVehicleId, saveCurrentVehicleId } from './prefs';
import { pickCurrentVehicle } from './currentVehicle';
import { useVehicleData, useVehicles, type VehicleData } from '../hooks/useVehicleData';
import { useToday } from '../hooks/useToday';
import { deriveVehicleState, type VehicleState } from '../features/dashboard/dashboardModel';

// ---------------------------------------------------------------------------
// Vehicle selection (available as soon as the vehicle list is loaded)
// ---------------------------------------------------------------------------

export interface VehicleSelection {
  vehicles: Vehicle[];
  current: Vehicle | undefined;
  setCurrentId: (id: string) => void;
}

const SelectionContext = createContext<VehicleSelection | null>(null);

export function useVehicleSelection(): VehicleSelection {
  const v = useContext(SelectionContext);
  if (!v) throw new Error('useVehicleSelection must be used inside <VehicleSelectionProvider>');
  return v;
}

/** Renders `loading` until the vehicle list is available. */
export function VehicleSelectionProvider(props: { children: ReactNode; loading: ReactNode }) {
  const { db } = useServices();
  const vehicles = useVehicles(db);
  const [storedId, setStoredId] = useState(() => loadCurrentVehicleId());
  const setCurrentId = useCallback((id: string) => {
    saveCurrentVehicleId(id);
    setStoredId(id);
  }, []);
  const value = useMemo<VehicleSelection | null>(
    () => (vehicles ? { vehicles, current: pickCurrentVehicle(vehicles, storedId), setCurrentId } : null),
    [vehicles, storedId, setCurrentId],
  );
  if (!value) return <>{props.loading}</>;
  return <SelectionContext.Provider value={value}>{props.children}</SelectionContext.Provider>;
}

// ---------------------------------------------------------------------------
// Current vehicle data + derived state
// ---------------------------------------------------------------------------

export interface VehicleContextValue {
  vehicle: Vehicle;
  data: VehicleData;
  state: VehicleState;
  today: string;
}

const VehicleStateContext = createContext<VehicleContextValue | null>(null);

export function useVehicleContext(): VehicleContextValue {
  const v = useContext(VehicleStateContext);
  if (!v) throw new Error('useVehicleContext must be used inside <VehicleStateProvider>');
  return v;
}

export function VehicleStateProvider(props: { vehicleId: string; children: ReactNode; loading: ReactNode }) {
  const { db } = useServices();
  const loaded = useVehicleData(db, props.vehicleId);
  // While switching vehicles (or right after deleting one) keep showing the previous data
  // instead of unmounting the router.
  const last = useRef<VehicleData | null>(null);
  if (loaded) last.current = loaded;
  const data = loaded ?? last.current;
  const today = useToday();
  const value = useMemo<VehicleContextValue | null>(() => {
    if (!data) return null;
    return { vehicle: data.vehicle, data, state: deriveVehicleState(data, today), today };
  }, [data, today]);
  if (!value) return <>{props.loading}</>;
  return <VehicleStateContext.Provider value={value}>{props.children}</VehicleStateContext.Provider>;
}
