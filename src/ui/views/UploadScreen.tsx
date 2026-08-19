import { useRef, useState } from 'react';
import { filesFromDataTransfer, filesFromInput, type FileInput, type IngestState } from '../../state/useIngest.ts';
import { IconUpload, IconLock, IconAlert } from '../components/icons.tsx';
import { Badge } from '../components/primitives.tsx';
import { formatBytes } from '../../core/units.ts';

export interface UploadScreenProps {
  state: IngestState;
  onFiles: (files: FileInput[], label?: string) => void;
  onSample: () => void;
  onRetry: () => void;
}

const FORMATS = ['Export ZIP', 'FIT', 'TCX', 'GPX', 'CSV', 'JSON', 'Folders'];

export function UploadScreen({ state, onFiles, onSample, onRetry }: UploadScreenProps) {
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);

  const working = state.status === 'working';
  const progress = state.progress;
  const percent = progress && progress.total > 0 ? Math.min(100, (progress.processed / progress.total) * 100) : 0;

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    setPending(true);
    try {
      const files = await filesFromDataTransfer(event.dataTransfer);
      if (files.length) onFiles(files, describe(files));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="upload-screen">
      <div className="upload-inner">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
          <span className="brand-mark" style={{ width: 44, height: 44, borderRadius: 13 }}>
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path d="M6 21l5-7 4 4 4-8 7 11" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        <h1 className="upload-title">Your Garmin export, as a dashboard</h1>
        <p className="upload-lede">
          Drop your Garmin Connect export and this becomes a personal analytics dashboard: activities, routes, training load, sleep,
          stress, Body Battery, HRV and everything else the files happen to contain.
        </p>

        {state.status === 'error' ? (
          <div className="dropzone" style={{ borderColor: 'var(--critical)' }}>
            <IconAlert size={26} />
            <h2>That import failed</h2>
            <p className="muted" style={{ fontSize: 13, maxWidth: '50ch' }}>{state.error}</p>
            <button type="button" className="btn primary" onClick={onRetry}>
              Try again
            </button>
          </div>
        ) : working || pending ? (
          <div className="dropzone">
            <IconUpload size={26} />
            <h2>{pending ? 'Reading files…' : phaseLabel(progress?.phase)}</h2>
            <div style={{ width: '100%', maxWidth: 420 }}>
              <div className="progress-track">
                <div
                  className={`progress-fill${!progress || progress.total <= 1 ? ' indeterminate' : ''}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 8, minHeight: 18 }}>
                {progress?.currentFile ? shorten(progress.currentFile) : ''}
              </p>
              <p className="muted" style={{ fontSize: 12 }}>
                {progress ? `${progress.processed} of ${progress.total} files` : ''} {progress?.message ?? ''}
              </p>
            </div>
          </div>
        ) : (
          <div
            className={`dropzone${dragging ? ' dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <IconUpload size={28} />
            <h2>Drop your export here</h2>
            <p className="dropzone-hint">A whole export ZIP, an extracted folder, or individual files — all handled.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" className="btn primary" onClick={() => fileInput.current?.click()}>
                Choose files
              </button>
              <button type="button" className="btn" onClick={() => folderInput.current?.click()}>
                Choose folder
              </button>
              <button type="button" className="btn ghost" onClick={onSample}>
                Load sample export
              </button>
            </div>
            <div className="file-kinds">
              {FORMATS.map((format) => (
                <Badge key={format}>{format}</Badge>
              ))}
            </div>
          </div>
        )}

        <p className="privacy-note">
          <IconLock size={14} />
          Everything is parsed on this device. Your files are never uploaded anywhere.
        </p>

        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = filesFromInput(e.target.files);
            if (files.length) onFiles(files, describe(files));
            e.target.value = '';
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          // @ts-expect-error non-standard but widely supported directory picker
          webkitdirectory=""
          directory=""
          onChange={(e) => {
            const files = filesFromInput(e.target.files);
            if (files.length) onFiles(files, describe(files));
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case 'expanding':
      return 'Expanding archive…';
    case 'parsing':
      return 'Parsing files…';
    case 'normalizing':
      return 'Building your dashboard…';
    case 'done':
      return 'Finishing up…';
    default:
      return 'Reading files…';
  }
}

function shorten(path: string): string {
  if (path.length <= 64) return path;
  return `…${path.slice(-61)}`;
}

function describe(files: FileInput[]): string {
  if (files.length === 1) return files[0].file.name;
  const bytes = files.reduce((sum, f) => sum + f.file.size, 0);
  return `${files.length} files · ${formatBytes(bytes)}`;
}
