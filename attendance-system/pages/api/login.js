import { getSheetRowsByTitle, readRowField } from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { username, password } = req.body || {};
    const normalizedUsername = String(username || "").trim().toLowerCase();
    const normalizedPassword = String(password || "").trim();

    if (!normalizedUsername || !normalizedPassword) {
      return res.status(400).json({ error: "Username and password required" });
    }

    const { rows } = await getSheetRowsByTitle("admins", {
      expectedHeaders: ["username", "password"],
      minHeaderMatches: 2,
    });

    const match = rows.find((row) => {
      const rowUsername = String(
        readRowField(
          row,
          ["username", "user name", "admin", "admin username"],
          0
        ) || ""
      )
        .trim()
        .toLowerCase();

      const rowPassword = String(
        readRowField(row, ["password", "pass", "admin password"], 1) || ""
      ).trim();

      return (
        rowUsername === normalizedUsername && rowPassword === normalizedPassword
      );
    });

    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Server error" });
  }
}
