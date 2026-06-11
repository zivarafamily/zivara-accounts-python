# Deployment Notes

## Apps Script Backend

1. Create a new Apps Script project for Zivara Accounts.
2. Copy all files from `gas-backend/`.
3. Update `SPREADSHEET_ID` in `Utils.gs`.
4. Deploy as Web App:
   - Execute as: Me
   - Access: Anyone
5. Copy the `/exec` URL.

## Frontend

Set `VITE_GAS_WEB_APP_URL` to the accounts Apps Script `/exec` URL.

For Vercel:

1. Import this repo.
2. Set Root Directory to `frontend`.
3. Add `VITE_GAS_WEB_APP_URL`.
4. Deploy.
