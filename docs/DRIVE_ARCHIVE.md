# Google Drive archive of uploads

Built 4 Sept 2026. Every file uploaded to CT Hub (Supabase Storage) is copied to
the Shared drive **`09.05 SRM In4Velocity ERP / CLAUDE`**, into a folder tree a
person can browse, with the upload date in the file name. When the hub deletes a
file, its Drive copy is **moved under `Archive/`** (same tree, `__deleted-<date>`
suffix). Nothing is ever purged.

Supabase stays the system of record — the app never reads from Drive, so Drive
being slow or unavailable cannot break a page.

## Tree

```
CLAUDE/
├─ 02 Internal Estimate/<project code>/<sheet code>/2026-08-27_1030_<file>.xlsx
├─ 03 Bills/<YYYY>/<YYYY-MM>/…                (bills-booking, bills-pipeline cards)
├─ 04 JMR photos/<project>/<YYYY-MM>/…
├─ 05 Daily site reports/<project>/<YYYY-MM>/…
├─ 06 Backups/Cost Control/<YYYY>/2026-09-04_0423_cc-backup.xlsx
├─ 07 Warehouse/<YYYY>/<YYYY-MM>/…             (bills, gate passes, item images)
└─ Archive/                                     ← same tree; moved here on delete
```

`01 IN4 reports` is not needed once the IN4 live sync is on — the report is read
from IN4's database, not uploaded. Until then, the raw report Excel files are
parsed in the browser and never stored, so there is nothing to archive for them.

## Pieces

- `lib/drive.ts` — service-account auth (JWT signed with Node crypto), find-or-create folders, upload, move. No library.
- `lib/drive-archive.ts` — the run: list each archived bucket (`list_storage_objects()`), copy what `drive_files` does not know (≤ 40 per run), move deleted ones under `Archive/`.
- `/api/cron/drive-archive` — dispatcher job `drive-archive`, both slots; 503 "not configured" until the two variables exist.
- `drive_files` — the ledger (bucket, object path, Drive id, path, uploaded/archived at, last error).

## Aksha's five steps (one-time)

1. [Google Cloud Console → IAM → Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts), signed in as the Workspace account that owns the shared drive. Create a project "ct-hub" if none exists → **Create service account** → name `ct-hub-drive` → no roles → Done.
2. On that account: **Keys → Add key → JSON**. Download it.
3. [Enable the Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com).
4. In Drive: **Shared drives → 09.05 SRM In4Velocity ERP → CLAUDE** → Share → add the service account's email (`…@….iam.gserviceaccount.com`) as **Content manager**. If Workspace blocks external sharing, the admin allows that one address.
5. [Vercel → ct-hub → Environment Variables](https://vercel.com/projectexecution-9357s-projects/ct-hub/settings/environment-variables) (Production): `GOOGLE_SERVICE_ACCOUNT_JSON` = the whole JSON file, `GDRIVE_ROOT_FOLDER_ID` = the id in the CLAUDE folder's URL. Redeploy.

The first cron run after that copies the backlog forty files at a time (181 Internal Estimate sheets, 30 backups, 12 bill cards, 7 photos… about a week of runs); `drive_files` shows progress and any error per file.
