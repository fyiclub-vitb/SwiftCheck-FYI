import { getSheetByTitle } from "../../lib/sheets";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { reg_number, registration_number } = req.body || {};
    const normalizedRegNumber = String(reg_number || registration_number || "")
      .trim()
      .toUpperCase();

    if (!normalizedRegNumber) {
      return res.status(400).json({ error: "reg_number is required" });
    }

    const sheet = await getSheetByTitle("users");
    const rows = await sheet.getRows();

    const match = rows.find(
      (row) =>
        String(row.reg_number || "").trim().toUpperCase() ===
        normalizedRegNumber
    );

    if (!match) {
      return res.status(404).json({ error: "User not found" });
    }

    const currentStatus = String(match.status || "").trim();
    if (currentStatus.toLowerCase() === "present") {
      return res.status(200).json({
        status: "already",
        message: `Already marked for ${match.name || "user"}`,
        name: match.name || null,
      });
    }

    match.status = "Present";
    match.timestamp = new Date().toLocaleString();
    await match.save();

    return res.status(200).json({
      status: "marked",
      message: `Attendance marked for ${match.name || "user"}`,
      name: match.name || null,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Server error" });
  }
}
