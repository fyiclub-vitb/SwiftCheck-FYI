# SwiftCheck-FYI

This repository includes the QR Attendance System inside `attendance-system`.

# QR Attendance System Logic

### Admin Authentication
- Admin credentials are stored securely in the 'admins' tab of the Google Sheet.
- The system fetches these credentials during the login process to verify access.

### QR Code Structure
- The system expects QR codes to contain the **Registration Number** as plain text (e.g., `2023CS01`).
- You can generate these QR codes using any standard generator or a bulk Python script.

### Scanning & Database Update Logic
1. **Scan:** The admin uses the built-in camera via the browser to scan a participant's QR code.
2. **Verify:** The app sends the scanned `reg_number` to the Google Sheets API.
3. **Lookup:** The system searches the 'users' tab for a matching registration number.
4. **Update:** 
   - If found: Marks column 'status' as "Present" and adds a 'timestamp'.
   - If already marked: Returns a warning to the admin.
   - If not found: Returns an "Invalid User" error.
5. **Feedback:** The Admin UI turns green for success or red for error to allow for fast processing of lines.

### Sheet Requirements
The Google Sheet must have:
- Tab 1: `admins` (Columns: username, password)
- Tab 2: `users` (Columns: name, reg_number, status, timestamp)
Checklist for Success:

Did you share the Google Sheet with the Service Account Email?

Does the Service Account have "Editor" access?

Are your tab names in Google Sheets exactly admins and users (case sensitive)?
