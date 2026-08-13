# <img src="https://raw.githubusercontent.com/vagnertxr/amazonia_geomonitor/1e17c8b98211d7532eef9f587eee8da89b0d9646/favicon.svg" width="32" valign="middle"> Amazon GeomonitoR

**Territorial intelligence dashboard for monitoring native vegetation loss and forest degradation across the Brazilian Legal Amazon. Heavy processing in R, delivery as a fully static site.**

The dashboard interface is bilingual (Portuguese / English) and defaults to Portuguese.

## Data sources

All data is public and official, refreshed by an automated routine:

- **DETER alerts (INPE)** — Brazil's Real-Time Deforestation Detection System. Covers clear-cutting, clear-cutting with remaining vegetation, degradation, mining, selective logging (disordered and geometric) and burn scars.

  DETER flags changes in vegetation cover; it does not assess whether a given clearing was authorised. Wording throughout the interface stays neutral on legality for that reason — "alerted area" rather than "cleared area", since a degradation or burn-scar alert covers forest that is still standing.
- **Territorial boundaries (IBGE)** — municipalities, the Amazon biome and the Legal Amazon, via the `geobr` package.
- **Protected areas** — Indigenous Lands and Conservation Units, from TerraBrasilis, already clipped to the Legal Amazon.

## Features

- **Interactive map** with alerts sized by area class and coloured by DETER class.
- **Kernel density estimation computed in the browser**, responding to year, month and alert class simultaneously.
- **Municipal ranking** by absolute area or by acceleration against the same range one year earlier.
- **Monthly time series** with year-over-year comparison, **seasonality heatmap** and **rising municipalities**.
- **Time animation** stepping through the monthly series.
- **Protected-area layers** plus the share of alerted area falling inside them.

## Architecture

### Processing (R)

- Extraction through the TerraBrasilis WFS API (`R_scripts/update_all.R`).
- Spatial joins against municipalities and protected areas via `sf`.
- Polygons reduced to centroids, preserving area as an attribute.
- Export to compact formats: columnar for alerts, a sparse grid for the KDE, matrices for the series.

### Front end (vanilla JS + Leaflet)

No framework, no build step, no charting library — charts are SVG generated in JavaScript.

**Columnar format.** Alerts travel as parallel arrays rather than GeoJSON. Municipality and class become numeric indices, dates become integer day offsets and areas become integers. The centroid GeoJSON had grown to 89 MB across 276k features, close to GitHub's hard 100 MB per-file limit; the columnar payload carries the same information in 8.8 MB and loads straight into typed arrays, which turns filtering into a scan of a few milliseconds.

**Browser-side KDE.** Instead of pre-computed contours — 13 MB, and blind to the class filter — the pipeline exports a sparse grid of counts per cell × month × class (0.84 MB, roughly 290 KB gzipped). The browser accumulates the active selection, applies a separable Gaussian convolution and extracts isolines with marching squares. The full cycle takes 12–35 ms, so the density surface is recomputed on every filter change.

Bandwidth is adaptive, scaling with `n^(-1/6)`, so sparse selections are smoothed more heavily than dense ones; it is driven by sample size rather than by the weighting metric, so switching between alert count and alerted area does not change the smoothing radius. Levels are quantiles of the positive density, which removes the noise ring that previously accounted for half the vertices in the contour file.

**Encoding.** Colour identifies the DETER class and circle size encodes an area class; no variable is encoded twice. A scatter map requires every one of the 28 colour pairs to separate, so the palette was optimised to maximise the minimum separation under protanopia, deuteranopia and tritanopia: the worst pair sits at ΔE 10.9 (floor 8) and ΔE 19.5 under normal vision (floor 15). That required varying lightness across classes — the only channel that survives colour-vision deficiency at eight categories. The same colour table drives the filter chips, the map legend and the marks themselves.

Size uses graduated classes rather than a continuous scale: alert areas span 0.001–198 km² with a median of 0.16 km², a range no continuous mapping can honour without either hiding the small alerts or letting the large ones swamp the map. The legend states the breaks explicitly.

### Freshness

A cron job runs the pipeline at 03:00 on the 1st of each month. The date shown in the dashboard comes from `data/meta.json`, written by the pipeline and committed alongside the data, so the displayed date and the data itself cannot drift apart. The header reports both the date of the most recent alert and the date the pipeline ran.

## Running locally

The app uses `fetch()`, so it needs a static server rather than `file://`:

```bash
python3 -m http.server 8085
```

Then open `http://localhost:8085`.

To regenerate the data (downloads from INPE and takes a while):

```bash
Rscript R_scripts/update_all.R
```

R dependencies: `sf`, `dplyr`, `jsonlite`, `geobr`, `httr`.

## Repository layout

```
index.html      structure, sidebar tabs, indicator band, legend
style.css       design system (colour, type and spacing tokens)
i18n.js         pt/en dictionaries, applied through data-i18n
kde.js          browser-side kernel density estimation
charts.js       inline SVG charts
app.js          map, filters, ranking, indicators, time player
R_scripts/      processing pipeline and cron routine
data/           pre-processed payloads consumed by the front end
```
