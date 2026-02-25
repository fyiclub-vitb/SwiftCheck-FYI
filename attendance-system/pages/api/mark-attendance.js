import { getSheetRowsByTitle, readRowField, setRowField } from "../../lib/sheets";

function normalizeQrKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function extractRegNumberFromObject(data) {
  if (!data || typeof data !== "object") {
    return "";
  }

  const normalizedEntries = Object.entries(data).map(([key, value]) => [
    normalizeQrKey(key),
    value,
  ]);

  const keyPriority = [
    "registrationnumber",
    "regnumber",
    "registrationno",
    "regno",
  ];

  for (const expectedKey of keyPriority) {
    const entry = normalizedEntries.find(([key]) => key === expectedKey);
    if (!entry) {
      continue;
    }

    const value = String(entry[1] || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function extractRegNumber(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) {
    return "";
  }

  try {
    const parsed = JSON.parse(text);
    const fromJson = extractRegNumberFromObject(parsed);
    if (fromJson) {
      return fromJson;
    }
  } catch {
    // Not JSON; continue parsing as plain text.
  }

  const labeledMatch = text.match(
    /registration\s*(?:number|no\.?)\s*[:#-]?\s*([A-Za-z0-9-]+)/i
  );
  if (labeledMatch && labeledMatch[1]) {
    return labeledMatch[1].trim();
  }

  const tokens = text.match(/[A-Za-z0-9-]{5,}/g) || [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i];
    if (/[A-Za-z]/.test(token) && /\d/.test(token)) {
      return token;
    }
  }

  return text;
}

function getRowRegistrationNumber(row) {
  const directRegNumber = String(
    readRowField(
      row,
      [
        "reg_number",
        "registration_number",
        "registration number",
        "reg no",
        "reg_no",
      ],
      1
    ) || ""
  )
    .trim()
    .toUpperCase();

  if (directRegNumber) {
    return directRegNumber;
  }

  const rowObject =
    row && typeof row.toObject === "function" ? row.toObject() : row || {};
  const rowValues = Object.values(rowObject);

  for (const rowValue of rowValues) {
    const extracted = extractRegNumber(rowValue).trim().toUpperCase();
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { reg_number, registration_number } = req.body || {};
    const normalizedRegNumber = extractRegNumber(
      reg_number || registration_number
    )
      .trim()
      .toUpperCase();

    if (!normalizedRegNumber) {
      return res.status(400).json({ error: "reg_number is required" });
    }

    const { rows } = await getSheetRowsByTitle("users", {
      expectedHeaders: [
        "name",
        "reg_number",
        "registration_number",
        "status",
        "timestamp",
      ],
      minHeaderMatches: 2,
    });

    const match = rows.find(
      (row) => getRowRegistrationNumber(row) === normalizedRegNumber
    );

    if (!match) {
      return res.status(404).json({
        error: `User not found for registration number: ${normalizedRegNumber}`,
      });
    }

    const displayName =
      String(readRowField(match, ["name", "student_name", "student name"], 0) || "")
        .trim() || "user";

    const currentStatus = String(
      readRowField(match, ["status", "attendance status"], 2) || ""
    ).trim();

    if (currentStatus.toLowerCase() === "present") {
      return res.status(200).json({
        status: "already",
        message: `Already marked for ${displayName}`,
        name: displayName,
      });
    }

    const statusUpdated = setRowField(
      match,
      ["status", "attendance status"],
      "Present"
    );
    const timestampUpdated = setRowField(
      match,
      ["timestamp", "time", "marked_at", "marked at"],
      new Date().toLocaleString()
    );

    if (!statusUpdated || !timestampUpdated) {
      return res.status(500).json({
        error:
          'Missing required columns in "users" sheet. Expected columns like status and timestamp.',
      });
    }

    await match.save();

    return res.status(200).json({
      status: "marked",
      message: `Attendance marked for ${displayName}`,
      name: displayName,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Server error" });
  }
}
