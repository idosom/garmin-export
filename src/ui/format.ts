import { useMemo } from 'react';
import { useSettings } from '../state/settings.tsx';
import { sportMeta } from '../core/metrics.ts';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatHours,
  formatMass,
  formatNumber,
  formatPace,
  formatPace100,
  formatSpeed,
  formatTemperature,
  joinFormatted,
  type Formatted,
  type UnitSystem,
} from '../core/units.ts';
import type { Activity } from '../core/types.ts';

export interface Formatters {
  units: UnitSystem;
  distance(metres: number | undefined): string;
  distanceParts(metres: number | undefined): Formatted;
  elevation(metres: number | undefined): string;
  elevationParts(metres: number | undefined): Formatted;
  duration(seconds: number | undefined): string;
  hours(seconds: number | undefined): string;
  mass(kg: number | undefined): string;
  temperature(celsius: number | undefined): string;
  speed(ms: number | undefined): string;
  pace(ms: number | undefined): string;
  /** Pace or speed, whichever suits the sport. */
  rate(sport: string, ms: number | undefined): string;
  rateLabel(sport: string): string;
  number(value: number | undefined, decimals?: number): string;
}

export function useFormatters(): Formatters {
  const { units } = useSettings();
  return useMemo<Formatters>(
    () => ({
      units,
      distance: (m) => joinFormatted(formatDistance(m, units)),
      distanceParts: (m) => formatDistance(m, units),
      elevation: (m) => joinFormatted(formatElevation(m, units)),
      elevationParts: (m) => formatElevation(m, units),
      duration: (s) => formatDuration(s),
      hours: (s) => formatHours(s),
      mass: (kg) => joinFormatted(formatMass(kg, units)),
      temperature: (c) => joinFormatted(formatTemperature(c, units)),
      speed: (ms) => joinFormatted(formatSpeed(ms, units)),
      pace: (ms) => joinFormatted(formatPace(ms, units)),
      rate: (sport, ms) => {
        if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return '—';
        const meta = sportMeta(sport);
        if (meta.rate === 'speed') return joinFormatted(formatSpeed(ms, units));
        if (meta.rate === 'pace100') return joinFormatted(formatPace100(ms, units));
        if (meta.rate === 'pace') return joinFormatted(formatPace(ms, units));
        return joinFormatted(formatSpeed(ms, units));
      },
      rateLabel: (sport) => {
        const meta = sportMeta(sport);
        if (meta.rate === 'speed') return 'Avg speed';
        if (meta.rate === 'pace100') return 'Avg pace';
        return 'Avg pace';
      },
      number: (value, decimals) => (value === undefined || !Number.isFinite(value) ? '—' : formatNumber(value, decimals ?? 0)),
    }),
    [units],
  );
}

export function activityTitle(activity: Activity): string {
  if (activity.name && activity.name.trim()) return activity.name;
  const meta = sportMeta(activity.sport);
  const hour = new Date(activity.startTime).getHours();
  const partOfDay = hour < 5 ? 'Night' : hour < 11 ? 'Morning' : hour < 15 ? 'Midday' : hour < 19 ? 'Afternoon' : 'Evening';
  return `${partOfDay} ${meta.label.toLowerCase()}`;
}

/** The duration we treat as "training time" for an activity. */
export function activityDuration(activity: Activity): number | undefined {
  return activity.movingTime ?? activity.timerTime ?? activity.elapsedTime;
}
