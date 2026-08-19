import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UnitSystem } from '../core/units.ts';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemeChoice;
  units: UnitSystem;
  /** Basemap tiles are opt-in: they are the only outbound request the app makes. */
  mapTiles: boolean;
  /** Keep the parsed dataset in this browser between visits. */
  persist: boolean;
}

const DEFAULTS: Settings = { theme: 'system', units: 'metric', mapTiles: false, persist: true };
const STORAGE_KEY = 'garmin-dashboard.settings';

interface SettingsContextValue extends Settings {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
}

const SettingsContext = createContext<SettingsContextValue>({ ...DEFAULTS, set: () => {} });

function readStored(): Settings {
  if (typeof localStorage === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* private mode — settings just do not persist */
    }
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings]);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const value = useMemo(() => ({ ...settings, set }), [settings, set]);
  return <SettingsContext value={value}>{children}</SettingsContext>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
