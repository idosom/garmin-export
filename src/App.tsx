import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SettingsProvider, useSettings } from './state/settings.tsx';
import { DatasetProvider, useDataset } from './state/dataset.tsx';
import { useIngest, filesFromDataTransfer, filesFromInput, type FileInput } from './state/useIngest.ts';
import { clearDataset, loadDataset, saveDataset } from './state/storage.ts';
import { UploadScreen } from './ui/views/UploadScreen.tsx';
import { OverviewView } from './ui/views/OverviewView.tsx';
import { ActivitiesView } from './ui/views/ActivitiesView.tsx';
import { TrainingView } from './ui/views/TrainingView.tsx';
import { HealthView } from './ui/views/HealthView.tsx';
import { CalendarView } from './ui/views/CalendarView.tsx';
import { ExplorerView } from './ui/views/ExplorerView.tsx';
import { ActivityDetail } from './ui/views/ActivityDetail.tsx';
import { Alert, Badge } from './ui/components/primitives.tsx';
import {
  IconOverview,
  IconActivities,
  IconTraining,
  IconHealth,
  IconCalendar,
  IconExplorer,
  IconSun,
  IconMoon,
  IconMonitor,
  IconUpload,
  IconTrash,
} from './ui/components/icons.tsx';
import { formatDate } from './core/units.ts';
import type { Activity, Dataset } from './core/types.ts';

type ViewId = 'overview' | 'activities' | 'training' | 'health' | 'calendar' | 'explorer';

const VIEWS: { id: ViewId; label: string; subtitle: string; icon: typeof IconOverview }[] = [
  { id: 'overview', label: 'Overview', subtitle: 'Everything at a glance', icon: IconOverview },
  { id: 'activities', label: 'Activities', subtitle: 'Search, filter and open any session', icon: IconActivities },
  { id: 'training', label: 'Training', subtitle: 'Volume, load and personal bests', icon: IconTraining },
  { id: 'health', label: 'Health', subtitle: 'Sleep, heart, stress and body metrics', icon: IconHealth },
  { id: 'calendar', label: 'Calendar', subtitle: 'Training and recovery, day by day', icon: IconCalendar },
  { id: 'explorer', label: 'Data explorer', subtitle: 'Exactly what was found in your export', icon: IconExplorer },
];

export default function App() {
  return (
    <SettingsProvider>
      <Root />
    </SettingsProvider>
  );
}

function Root() {
  const ingest = useIngest();
  const settings = useSettings();
  const [restored, setRestored] = useState<Dataset | undefined>();
  const [restoreChecked, setRestoreChecked] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  // Bring back the last dataset so a reload does not mean re-uploading.
  useEffect(() => {
    let cancelled = false;
    loadDataset()
      .then((dataset) => {
        if (!cancelled && dataset) setRestored(dataset);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setRestoreChecked(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const dataset = ingest.dataset ?? restored;

  useEffect(() => {
    if (!ingest.dataset || !settings.persist) return;
    saveDataset(ingest.dataset).catch((error: Error) =>
      setSaveError(`Could not keep this export in the browser (${error.message}). The dashboard still works for this session.`),
    );
  }, [ingest.dataset, settings.persist]);

  const handleFiles = useCallback((files: FileInput[], label?: string) => ingest.start(files, label), [ingest]);

  const handleSample = useCallback(async () => {
    const { sampleExportFile } = await import('./demo/sampleExport.ts');
    const file = sampleExportFile();
    ingest.start([{ path: file.name, file }], 'Sample export (synthetic)');
  }, [ingest]);

  const handleClear = useCallback(async () => {
    await clearDataset().catch(() => undefined);
    setRestored(undefined);
    ingest.reset();
  }, [ingest]);

  if (!dataset || ingest.status === 'working' || ingest.status === 'error') {
    if (!restoreChecked && ingest.status === 'idle') {
      return <div className="upload-screen" aria-busy="true" />;
    }
    return (
      <UploadScreen
        state={ingest}
        onFiles={handleFiles}
        onSample={handleSample}
        onRetry={ingest.reset}
      />
    );
  }

  return (
    <DatasetProvider dataset={dataset}>
      <Shell onFiles={handleFiles} onClear={handleClear} saveError={saveError} />
    </DatasetProvider>
  );
}

function Shell({
  onFiles,
  onClear,
  saveError,
}: {
  onFiles: (files: FileInput[], label?: string) => void;
  onClear: () => void;
  saveError?: string;
}) {
  const { dataset, overview } = useDataset();
  const settings = useSettings();
  const [view, setView] = useState<ViewId>(() => (VIEWS.some((v) => `#${v.id}` === location.hash) ? (location.hash.slice(1) as ViewId) : 'overview'));
  const [openActivity, setOpenActivity] = useState<Activity | null>(null);
  const [dragging, setDragging] = useState(false);
  const addInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    history.replaceState(null, '', `#${view}`);
  }, [view]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenActivity(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const counts = useMemo<Record<ViewId, number | undefined>>(
    () => ({
      overview: undefined,
      activities: dataset.activities.length,
      training: undefined,
      health: dataset.daily.length,
      calendar: undefined,
      explorer: dataset.report.files.length,
    }),
    [dataset, overview],
  );

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <div
      className="app"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={async (event) => {
        event.preventDefault();
        setDragging(false);
        const files = await filesFromDataTransfer(event.dataTransfer);
        if (files.length) onFiles(files);
      }}
    >
      <header className="floating-nav">
        <div className="brand">
          <span className="brand-mark">
            <svg width="17" height="17" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path d="M6 21l5-7 4 4 4-8 7 11" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-name">Garmin Dashboard</span>
        </div>

        <nav className="nav-links" aria-label="Sections">
          {VIEWS.map((item) => {
            const Icon = item.icon;
            const count = counts[item.id];
            return (
              <button
                key={item.id}
                type="button"
                className="nav-item"
                aria-current={view === item.id ? 'page' : undefined}
                onClick={() => setView(item.id)}
              >
                <Icon size={16} />
                <span className="nav-label">{item.label}</span>
                {count !== undefined && count > 0 && <span className="count">{count.toLocaleString()}</span>}
              </button>
            );
          })}
        </nav>

        <span className="nav-divider" />

        <div className="nav-actions">
          <div className="segmented" role="group" aria-label="Theme">
            <button type="button" aria-pressed={settings.theme === 'light'} onClick={() => settings.set('theme', 'light')} title="Light">
              <IconSun size={14} />
            </button>
            <button type="button" aria-pressed={settings.theme === 'system'} onClick={() => settings.set('theme', 'system')} title="Match system">
              <IconMonitor size={14} />
            </button>
            <button type="button" aria-pressed={settings.theme === 'dark'} onClick={() => settings.set('theme', 'dark')} title="Dark">
              <IconMoon size={14} />
            </button>
          </div>
          <button type="button" className="btn primary small" onClick={() => addInput.current?.click()}>
            <IconUpload size={14} /> <span className="btn-label">Add files</span>
          </button>
          <input
            ref={addInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const files = filesFromInput(event.target.files);
              if (files.length) onFiles(files);
              event.target.value = '';
            }}
          />
        </div>
      </header>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{current.label}</h1>
            <span className="subtitle">{current.subtitle}</span>
          </div>
          <div className="topbar-actions">
            <div className="segmented" role="group" aria-label="Units">
              <button type="button" aria-pressed={settings.units === 'metric'} onClick={() => settings.set('units', 'metric')}>
                km
              </button>
              <button type="button" aria-pressed={settings.units === 'imperial'} onClick={() => settings.set('units', 'imperial')}>
                mi
              </button>
            </div>
            <div className="dataset-chip" title={`${dataset.label} — imported ${new Date(dataset.createdAt).toLocaleDateString()}`}>
              <strong>{dataset.label}</strong>
              <span>
                {overview.range ? `${formatDate(overview.range.start)} – ${formatDate(overview.range.end)}` : 'No dated records'}
              </span>
            </div>
            <button type="button" className="btn ghost small" onClick={onClear}>
              <IconTrash size={14} /> Clear local data
            </button>
          </div>
        </header>

        <main className="content">
          {saveError && <Alert kind="warn">{saveError}</Alert>}
          {dataset.report.files.some((f) => f.status === 'error') && view !== 'explorer' && (
            <Alert kind="warn">
              Some files could not be read.{' '}
              <button type="button" className="btn ghost small" onClick={() => setView('explorer')}>
                See the data explorer
              </button>
            </Alert>
          )}

          {view === 'overview' && <OverviewView onOpenActivity={setOpenActivity} onShowExplorer={() => setView('explorer')} />}
          {view === 'activities' && <ActivitiesView onOpenActivity={setOpenActivity} />}
          {view === 'training' && <TrainingView onOpenActivity={setOpenActivity} />}
          {view === 'health' && <HealthView />}
          {view === 'calendar' && <CalendarView onOpenActivity={setOpenActivity} />}
          {view === 'explorer' && <ExplorerView />}
        </main>
      </div>

      {dragging && (
        <div className="sheet-backdrop" style={{ justifyContent: 'center', alignItems: 'center', pointerEvents: 'none' }}>
          <Badge tone="accent">Drop to add these files to the dashboard</Badge>
        </div>
      )}

      {openActivity && <ActivityDetail activity={openActivity} onClose={() => setOpenActivity(null)} />}
    </div>
  );
}
