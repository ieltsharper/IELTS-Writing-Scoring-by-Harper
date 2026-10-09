# IELTS Writing Scoring by Harper

IELTS Writing practice (Task 1 Academic and Task 2) with teacher scoring.
Front end: Vite + TypeScript on GitHub Pages. Back end: Google Apps Script + Google Sheets/Drive/Gmail.

## Creating a test Sheet and test deployment

Use a separate test setup before touching real student data.

1. In Google Drive, create an empty Google Sheet named `IELTS Writing (TEST)`. Copy its ID from the URL
   (`https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`).
2. Create a folder named `IELTS Writing Essays (TEST)`. Copy its ID from the URL
   (`https://drive.google.com/drive/folders/<FOLDER_ID>`).
3. Create a test Apps Script project and push the code (see _Deploying Apps Script_ below), then set the Script
   Properties `ADMIN_EMAIL`, `SHEET_ID`, `DRIVE_ROOT_FOLDER_ID` and `APP_URL` to the test values.
4. In the Apps Script editor choose `setup` and press **Run**. Approve the permissions. `setup()` creates every tab
   with headers and seeds topics, classes, ~40 error categories, feedback sources, your admin user and two demo
   students (`demo.an@example.com`, `demo.binh@example.com`) with sample essays, scores and one rewrite request.
   Running it again is safe: it only adds what is missing.
5. Deploy a test web app (**Deploy → New deployment → Web app**, Execute as **Me**, Who has access **Anyone**) and
   point a local front end at it: create `.env.local` with `VITE_API_URL=<test web app URL>` and run `npm run dev`.

The demo students use `example.com` addresses, so no real email is ever sent to them.
