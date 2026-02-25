# QR Attendance System (Next.js + Google Sheets)

This app marks attendance by scanning QR codes and matching a student's registration number in Google Sheets.

## 1. Prepare Google Sheet

Create a Google Sheet with these exact tabs and columns:

- `admins`
- Column A: `username`
- Column B: `password`

- `users`
- Column A: `name`
- Column B: `reg_number`
- Column C: `status`
- Column D: `timestamp`

Add at least one admin (example: `admin`, `1234`) and pre-fill users.

Copy your Sheet ID from:
`https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit`

## 2. Google Cloud Setup

1. Create a project in Google Cloud Console.
2. Enable **Google Sheets API**.
3. Create a **Service Account**.
4. Create a JSON key for that service account.
5. From the JSON, keep:
- `client_email`
- `private_key`
6. Share your Google Sheet with the service account email and grant **Editor** access.

## 3. Install and Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## 4. Environment Variables

Create `.env.local` in this folder:

```env
GOOGLE_SHEET_ID=your_sheet_id_here
GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account_email_here
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYourKeyHere\n-----END PRIVATE KEY-----\n"
```

Notes:
- Keep `\n` in `GOOGLE_PRIVATE_KEY` exactly as-is.

## 5. API Logic

- `POST /api/login`
- Reads `admins` tab.
- Validates `username` and `password`.

- `POST /api/mark-attendance`
- Reads `users` tab.
- Accepts either `reg_number` or `registration_number` in the request body.
- Finds matching `reg_number` in the sheet.
- If already present: returns `already`.
- If not present: sets `status = Present` and updates `timestamp`.

## 6. QR Format

Supported QR payload formats:

- Plain text:
`2023CS01`

- JSON object:
`{"event":"FYI CLUB 2026","team_name":"Tester","student_name":"Anshu","registration_number":"24BCE11527"}`

The scanner extracts `registration_number` from JSON automatically.

## 7. Deploy to Vercel

1. Push project to GitHub.
2. Import the repo in Vercel.
3. Add the same environment variables in **Project Settings -> Environment Variables**.
4. Deploy.

## Checklist

- Sheet tabs are exactly `admins` and `users`.
- Service account has Editor permission on the sheet.
- QR data contains a registration number (plain text or JSON `registration_number`).
