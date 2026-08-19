# Trailhead — Garmin export analytics

A local-first web app that turns a Garmin Connect data export into a personal
analytics dashboard. Drop in the export ZIP, an extracted folder, or a handful
of loose files; everything is parsed **in your browser** and nothing is
uploaded anywhere.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # parser / normalization / analytics tests
npm run build    # type-check + production build into dist/
```

Open the app and either drop your export on the page or press **Load sample
export** — that generates a synthetic Garmin export in the browser and runs it
through the real pipeline, so you can see the whole dashboard without handing
over personal data.

## What it reads

| Format | Notes |
| --- | --- |
| **FIT** | Full protocol decode: file headers (12- and 14-byte), definition and data messages, compressed-timestamp records, arrays, endianness, invalid sentinels, chained files, CRC checks, and **developer fields** (via `field_description`). Activity files (session/lap/record) and wellness files (monitoring, stress, sleep stages, weight, HRV status, VO₂ max, SpO₂, respiration). |
| **CSV** | Garmin Connect's activity list and its wellness report downloads. Headers are matched by synonym, `--` is treated as missing, thousands separators and decimal commas both parse, and the distance unit is derived from the data (Garmin's CSVs never state it). |
| **TCX** | Activities, laps, trackpoints and the `TPX`/`LX` extension elements (speed, power, run cadence, steps). |
| **GPX** | Tracks plus `TrackPointExtension` (hr, cadence, temperature) and power extensions. |
| **ZIP / gzip** | Expanded recursively, including ZIPs inside ZIPs, in batches so a huge archive does not have to be inflated all at once. |
| **JSON** | Best-effort support for the JSON files in "Export Your Data" (`UDSFile_*`, sleep, summarized activities). Structural rather than schema-driven, since these files are undocumented. |

Anything it does not recognise is still reported — file, size, detected type
and why it was skipped — in the Data explorer.

## Design principles

**Never invent a metric.** If a file does not contain heart rate, the UI says
so rather than showing a zero. Values that *are* derived (best efforts,
training load when the device did not record one, distance reconstructed from a
GPS track) say what they were derived from.

**Nothing leaves the device.** Parsing happens in a Web Worker; the parsed
dataset is cached in IndexedDB so a reload does not mean re-uploading. The only
outbound request the app can make is OpenStreetMap basemap tiles on the
activity map, which is off by default and opt-in per browser.

**Unknown data is kept, not dropped.** Unrecognised FIT fields become
`field_<n>`, developer fields keep their declared name and units, and unknown
CSV columns and XML extension elements are preserved. They show up in the
activity detail view and in the Data explorer.

## Architecture

The pipeline is a straight line, and each stage is independent of the ones
around it:

```
 ingestion            discovery              parsers            normalization        analytics          UI
 ──────────           ─────────              ───────            ─────────────        ─────────          ──
 files / folders  →   sniff content     →    fit/ csv/ tcx/  →  Activity          →  overview        →  React views
 drag & drop          expand archives        gpx/ json          DailyRecord          training           charts (SVG)
 (Web Worker)         (fflate)               → ParseResult      dedupe / merge       records            canvas map
```

| Path | Responsibility |
| --- | --- |
| `src/core/` | The normalized model (`types.ts`), the metric/sport registries (`metrics.ts`), unit conversion and formatting (`units.ts`), time handling (`time.ts`), numeric helpers (`stats.ts`). |
| `src/ingest/` | `discovery.ts` sniffs each file's real type; `archive.ts` expands ZIP/gzip; `pipeline.ts` drives discovery → parse → normalize and builds the ingest report. Free of DOM APIs, so it runs in a worker, in tests, and on the main thread as a fallback. |
| `src/parsers/` | One module per format, each returning a `ParseResult` (raw activities, daily records, message counts, fields seen, unknown fields, developer fields, warnings). `fit/decoder.ts` is a streaming FIT decoder; `fit/profile.ts` is the curated message/field table; `fit/encoder.ts` writes FIT files for tests and the sample export. |
| `src/normalize/` | `activity.ts` turns a loose `RawActivity` into an `Activity`, filling in only what the samples can prove; `dedupe.ts` merges the same activity when it appears as FIT *and* TCX *and* a CSV row, including timezone-shifted copies. |
| `src/analytics/` | Overview totals, weekly/monthly volume, training load (device figure → TSS → HR TRIMP → duration, whichever the data supports), fitness/fatigue/form curves, best efforts and power curves computed by sliding windows over the real streams, and wellness series. |
| `src/ui/` | Views, hand-rolled SVG charts (line, bar, share, heatmap, sparkline) with a shared crosshair/tooltip layer, and a canvas route map with pan/zoom and optional tiles. |
| `src/state/` | Settings (theme, units, map tiles), IndexedDB persistence, and the worker-backed ingest hook. |
| `src/demo/` | Synthetic FIT/CSV/GPX/TCX/ZIP builders shared by the tests and the in-app sample export. |

### Extending it

* **A new metric**: add a row to `WELLNESS_METRICS` (wellness) or
  `CHANNEL_META` (per-sample). The Health view, the calendar overlay and the
  activity charts pick it up automatically — they enumerate what exists rather
  than hard-coding a list.
* **A new FIT message or field**: add it to `FIT_MESSAGES` in
  `parsers/fit/profile.ts`. Until you do, the value is still decoded and kept as
  `mesg_<n>` / `field_<n>`.
* **A new file format**: write a parser that returns a `ParseResult` and add it
  to the switch in `parsers/index.ts` plus a sniff rule in
  `ingest/discovery.ts`. Nothing downstream changes.

## Defensiveness

Real exports are messy, so the tests cover the mess: truncated FIT files, bad
CRCs, chained FIT files, files with records but no session summary, unknown
message numbers, developer fields, activities without GPS, wellness data with no
activities at all, CSVs with missing values and unrecognised columns, imperial
exports, semicolon delimiters, invalid JSON, duplicate activities across
formats, timezone-shifted duplicates, and a 900-activity export (720 000
samples, ~5 s end to end).

Sample data is columnar (`Float64Array`/`Float32Array`) rather than millions of
objects, streams are downsampled with largest-triangle-three-buckets before
charting, and archives are inflated in batches, so multi-year exports stay
responsive.
