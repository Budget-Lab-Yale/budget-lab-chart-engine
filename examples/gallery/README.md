# Gallery

A visual review scaffold for chart/table engine feature work. Each subfolder is one
self-contained fixture: a spec (`chart.yaml` or `table.yaml`) plus its `data.csv`.

## Layout

```
examples/gallery/
  NN_short-name/
    chart.yaml   (or table.yaml)
    data.csv
```

- `NN_` is a two-digit sort prefix (matching the feature/task number where relevant) so the
  gallery index lists fixtures in a stable, meaningful order.
- Each spec's `note` field (charts) or `notes` field (tables) should state what to visually
  confirm when reviewing the rendered output — e.g. "Confirm: all four leaf columns render
  under both banner groups."

## Running

```
npm run build
npm run gallery
```

This serves every `chart.yaml` and `table.yaml` found under `examples/gallery/` at
`http://localhost:5173`. The index page lists all fixtures found (tables are tagged
"table"); open one to render it full-page.
