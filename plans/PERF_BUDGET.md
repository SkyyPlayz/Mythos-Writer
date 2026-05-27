# Performance Budget Report

Generated: `2026-05-24T11:07:39.765Z`
Status: **✅ PASS**

## Targets

- Story Vault: **1000 scenes**
- Notes Vault: **5000 notes**
- Max vault size: **500 MB**

## Measurements

| Metric | Result | Threshold | Status |
|--------|-------:|----------:|:------:|
| `db_open_ms` | 4 ms | < 1000 ms | ✅ |
| `vault_reindex_ms` | 187 ms | < 30000 ms | ✅ |
| `fts5_build_ms` | 166 ms | < 30000 ms | ✅ |
| `fts5_search_median_ms` | 2 ms | < 500 ms | ✅ |
| `archive_index_ms` | 112 ms | < 60000 ms | ✅ |
| `archive_scan_10_ms` | 768 ms | < 10000 ms | ✅ |

> No baseline on record — this run has been written as the initial baseline.
> Re-run with `PERF_UPDATE_BASELINE=1 npm run perf` to refresh it intentionally.

## Notes

- **db-cold-open**: time to open a brand-new SQLite DB and run all schema migrations.
- **vault-reindex**: cold scan of 1 000 scene files from disk (first-open scenario).
- **fts5-build**: full FTS5 index build for 1 000 scenes + 5 000 entity docs.
- **fts5-search**: median of three representative full-text search queries.
- **archive-index**: time for the Archive Agent to read and index all 5 000 entity files.
- **archive-scan**: total time to scan 10 scenes for inconsistencies and wiki-link gaps.

## Regression Policy

Regressions > 25 % from the last green baseline are treated as bugs.
Update baseline intentionally: `PERF_UPDATE_BASELINE=1 npm run perf`
