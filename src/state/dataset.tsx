import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Dataset } from '../core/types.ts';
import {
  buildOverview,
  buildTraining,
  availableMetrics,
  bucketByDay,
  chooseLoadModel,
  type Overview,
  type TrainingAnalysis,
} from '../analytics/index.ts';

export interface DatasetView {
  dataset: Dataset;
  overview: Overview;
  training: TrainingAnalysis;
  metrics: ReturnType<typeof availableMetrics>;
  days: ReturnType<typeof bucketByDay>;
  loadOf: (activityId: string) => number;
}

const DatasetContext = createContext<DatasetView | null>(null);

export function DatasetProvider({ dataset, children }: { dataset: Dataset; children: ReactNode }) {
  const value = useMemo<DatasetView>(() => {
    const model = chooseLoadModel(dataset.activities, dataset.user);
    const days = bucketByDay(dataset.activities, model.loadOf);
    const loads = new Map(dataset.activities.map((a) => [a.id, model.loadOf(a)]));
    return {
      dataset,
      overview: buildOverview(dataset.activities, dataset.daily),
      training: buildTraining(dataset),
      metrics: availableMetrics(dataset.daily),
      days,
      loadOf: (id) => loads.get(id) ?? 0,
    };
  }, [dataset]);

  return <DatasetContext value={value}>{children}</DatasetContext>;
}

export function useDataset(): DatasetView {
  const value = useContext(DatasetContext);
  if (!value) throw new Error('useDataset must be used inside a DatasetProvider');
  return value;
}
