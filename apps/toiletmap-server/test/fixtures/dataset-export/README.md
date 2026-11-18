# Legacy dataset export fixtures

The first bytes of the **live legacy export** (the files linked from
`https://www.toiletmap.org.uk/dataset`, written by legacy
`src/pages/api/cron/daily_export.page.ts` to Vercel Blob), used as the contract for
`src/services/export/format.ts`.

- **Captured:** 2026-11-18 (~01:58 GMT), from the export generated at 2026-11-18T00:00:39Z.
  Two ranged GETs (3 KB each), no other requests.
- `legacy-sample.json`: the first three objects of the JSON array, byte for byte, closed with `]`.
- `legacy-sample.csv`: the header and the first three records of the CSV, byte for byte (the
  third record's `notes` contains blank lines). No trailing newline, as in the file.

The data is the public Toilet Map dataset (CC BY 4.0). It holds no personal data: the
legacy export already left out `contributors` and `removal_reason`.

`test/unit/dataset-export-format.test.ts` rebuilds these records from database-shaped rows and
checks the output matches these bytes exactly.
