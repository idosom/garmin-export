import { useEffect, useMemo, useRef, useState } from 'react';

export interface RouteMapProps {
  lat: Float64Array;
  lon: Float64Array;
  /** Optional per-point values used to colour the track. */
  values?: Float32Array;
  valueLabel?: string;
  formatValue?: (value: number) => string;
  height?: number;
  hoverIndex?: number | null;
  onHoverIndex?: (index: number | null) => void;
  /** Opt-in basemap. Off by default: tile requests would reveal where you run. */
  showTiles?: boolean;
}

const TILE_SIZE = 256;
const RAMP = ['#cde2fb', '#86b6ef', '#3987e5', '#2a78d6', '#1c5cab', '#0d366b'];

interface View {
  zoom: number;
  centerX: number;
  centerY: number;
}

function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

/**
 * Interactive route map drawn on a canvas.
 *
 * The track itself is rendered entirely from local data. Basemap tiles are an
 * explicit opt-in because requesting them tells a third party roughly where the
 * activity happened.
 */
export function RouteMap({
  lat,
  lon,
  values,
  valueLabel,
  formatValue,
  height = 320,
  hoverIndex,
  onHoverIndex,
  showTiles = false,
}: RouteMapProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [size, setSize] = useState({ width: 0, height });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const tilesRef = useRef(new Map<string, HTMLImageElement>());
  const [tileVersion, setTileVersion] = useState(0);

  const points = useMemo(() => {
    const out: { lat: number; lon: number; index: number }[] = [];
    for (let i = 0; i < lat.length; i++) {
      if (Number.isFinite(lat[i]) && Number.isFinite(lon[i]) && Math.abs(lat[i]) <= 90) {
        out.push({ lat: lat[i], lon: lon[i], index: i });
      }
    }
    return out;
  }, [lat, lon]);

  const range = useMemo(() => {
    if (!values) return undefined;
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      const v = values[p.index];
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return Number.isFinite(min) && max > min ? { min, max } : undefined;
  }, [values, points]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const update = () => setSize({ width: node.clientWidth, height });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [height]);

  // Fit the track whenever the geometry or the viewport changes.
  useEffect(() => {
    if (!points.length || size.width <= 0) return;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const p of points) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);
    }
    let zoom = 16;
    for (; zoom > 1; zoom--) {
      const a = project(maxLat, minLon, zoom);
      const b = project(minLat, maxLon, zoom);
      if (b.x - a.x <= size.width - 32 && b.y - a.y <= size.height - 32) break;
    }
    const center = project((minLat + maxLat) / 2, (minLon + maxLon) / 2, zoom);
    setView({ zoom, centerX: center.x, centerY: center.y });
  }, [points, size.width, size.height]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || size.width <= 0) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const styles = getComputedStyle(canvas);
    ctx.fillStyle = styles.getPropertyValue('--surface-sunken') || '#eee';
    ctx.fillRect(0, 0, size.width, size.height);

    const originX = view.centerX - size.width / 2;
    const originY = view.centerY - size.height / 2;
    const toScreen = (p: { lat: number; lon: number }) => {
      const w = project(p.lat, p.lon, view.zoom);
      return { x: w.x - originX, y: w.y - originY };
    };

    if (showTiles) drawTiles(ctx, view, originX, originY, size, tilesRef.current, () => setTileVersion((v) => v + 1));

    // Casing under the track keeps it legible on any basemap.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    points.forEach((p, i) => {
      const s = toScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();

    if (range && values) {
      for (let i = 1; i < points.length; i++) {
        const a = toScreen(points[i - 1]);
        const b = toScreen(points[i]);
        const value = values[points[i].index];
        ctx.strokeStyle = Number.isFinite(value) ? rampColor((value - range.min) / (range.max - range.min)) : '#3987e5';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = '#2a78d6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      points.forEach((p, i) => {
        const s = toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }

    const start = toScreen(points[0]);
    const end = toScreen(points[points.length - 1]);
    dot(ctx, start.x, start.y, '#0ca30c');
    dot(ctx, end.x, end.y, '#d03b3b');

    if (hoverIndex !== null && hoverIndex !== undefined) {
      const match = points.find((p) => p.index >= hoverIndex);
      if (match) {
        const s = toScreen(match);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#eb6834';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
    }
  }, [view, size, points, values, range, hoverIndex, showTiles, tileVersion]);

  if (!points.length) return null;

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;

    if (dragRef.current) {
      const dx = px - dragRef.current.x;
      const dy = py - dragRef.current.y;
      dragRef.current = { x: px, y: py };
      setView({ ...view, centerX: view.centerX - dx, centerY: view.centerY - dy });
      return;
    }
    if (!onHoverIndex) return;

    const originX = view.centerX - size.width / 2;
    const originY = view.centerY - size.height / 2;
    let best = -1;
    let bestDistance = Infinity;
    const stride = Math.max(1, Math.floor(points.length / 900));
    for (let i = 0; i < points.length; i += stride) {
      const w = project(points[i].lat, points[i].lon, view.zoom);
      const d = (w.x - originX - px) ** 2 + (w.y - originY - py) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    onHoverIndex(bestDistance < 40 * 40 && best >= 0 ? points[best].index : null);
  };

  return (
    <div className="map-wrap" ref={wrapRef} style={{ height }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height }}
        onPointerDown={(e) => {
          dragRef.current = { x: e.clientX - e.currentTarget.getBoundingClientRect().left, y: e.clientY - e.currentTarget.getBoundingClientRect().top };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          dragRef.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          dragRef.current = null;
          onHoverIndex?.(null);
        }}
        onWheel={(e) => {
          if (!view) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rect.left - size.width / 2;
          const py = e.clientY - rect.top - size.height / 2;
          const delta = e.deltaY < 0 ? 1 : -1;
          const zoom = Math.max(1, Math.min(19, view.zoom + delta * 0.5));
          const factor = 2 ** (zoom - view.zoom);
          setView({
            zoom,
            centerX: (view.centerX + px) * factor - px,
            centerY: (view.centerY + py) * factor - py,
          });
        }}
      />
      {range && valueLabel && (
        <div className="map-overlay">
          <span className="badge">
            {valueLabel}: {formatValue ? formatValue(range.min) : range.min.toFixed(0)} –{' '}
            {formatValue ? formatValue(range.max) : range.max.toFixed(0)}
          </span>
          <span style={{ display: 'flex', gap: 2 }}>
            {RAMP.map((c) => (
              <span key={c} className="swatch" style={{ background: c, width: 12, height: 10 }} />
            ))}
          </span>
        </div>
      )}
      {showTiles && <div className="map-attribution">© OpenStreetMap contributors</div>}
    </div>
  );
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

function rampColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(scaled));
  return mixHex(RAMP[i], RAMP[i + 1], scaled - i);
}

function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const mixed = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${mixed[0]},${mixed[1]},${mixed[2]})`;
}

function drawTiles(
  ctx: CanvasRenderingContext2D,
  view: View,
  originX: number,
  originY: number,
  size: { width: number; height: number },
  cache: Map<string, HTMLImageElement>,
  onLoad: () => void,
) {
  const z = Math.round(view.zoom);
  const scaleFactor = 2 ** (view.zoom - z);
  const tileScreen = TILE_SIZE * scaleFactor;
  const worldOriginX = originX / scaleFactor;
  const worldOriginY = originY / scaleFactor;
  const first = { x: Math.floor(worldOriginX / TILE_SIZE), y: Math.floor(worldOriginY / TILE_SIZE) };
  const cols = Math.ceil(size.width / tileScreen) + 1;
  const rows = Math.ceil(size.height / tileScreen) + 1;
  const max = 2 ** z;

  for (let dx = 0; dx < cols; dx++) {
    for (let dy = 0; dy < rows; dy++) {
      const tx = first.x + dx;
      const ty = first.y + dy;
      if (tx < 0 || ty < 0 || tx >= max || ty >= max) continue;
      const key = `${z}/${tx}/${ty}`;
      let img = cache.get(key);
      if (!img) {
        img = new Image();
        img.decoding = 'async';
        img.src = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
        img.addEventListener('load', onLoad, { once: true });
        cache.set(key, img);
      }
      if (!img.complete || img.naturalWidth === 0) continue;
      const screenX = tx * TILE_SIZE * scaleFactor - originX;
      const screenY = ty * TILE_SIZE * scaleFactor - originY;
      ctx.drawImage(img, screenX, screenY, tileScreen + 1, tileScreen + 1);
    }
  }
}
