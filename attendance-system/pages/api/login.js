import { getSheetByTitle } from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { username, password, adminSecret } = req.body || {};
    const normalizedUsername = String(username || "").trim().toLowerCase();
    const rawPassword = String(password || "");

    if (!normalizedUsername || !rawPassword) {
      return res.status(400).json({ error: "Username and password required" });
    }

    if (process.env.ADMIN_SECRET_PASSWORD) {
      if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET_PASSWORD) {
        return res.status(401).json({ error: "Invalid admin secret" });
      }
    }

    const sheet = await getSheetByTitle("admins");
    const rows = await sheet.getRows();

    const match = rows.find(
      (row) =>
        String(row.username || "").trim().toLowerCase() ===
          normalizedUsername && String(row.password || "") === rawPassword
    );

    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Server error" });
  }
}
