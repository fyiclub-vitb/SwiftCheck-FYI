import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

const DEFAULT_HEADER_SCAN_ROWS = 25;
const DEFAULT_HEADER_SCAN_LAST_COLUMN = "AZ";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export async function getDoc() {
  const sheetId = requireEnv("GOOGLE_SHEET_ID");
  const serviceAccountEmail = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKeyRaw = requireEnv("GOOGLE_PRIVATE_KEY");
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  const auth = new JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(sheetId, auth);
  await doc.loadInfo();
  return doc;
}

export async function getSheetByTitle(title) {
  const doc = await getDoc();
  const sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    throw new Error(`Sheet not found: ${title}`);
  }
  return sheet;
}

function normalizeHeaderName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^\w]/g, "");
}

function normalizeExpectedHeaders(headers) {
  return Array.from(
    new Set((headers || []).map((header) => normalizeHeaderName(header)).filter(Boolean))
  );
}

function scoreHeaderRow(rowValues, normalizedExpectedHeaders) {
  const normalizedRow = new Set(
    (Array.isArray(rowValues) ? rowValues : [])
      .map((cellValue) => normalizeHeaderName(cellValue))
      .filter(Boolean)
  );

  let score = 0;
  for (const expectedHeader of normalizedExpectedHeaders) {
    if (normalizedRow.has(expectedHeader)) {
      score += 1;
    }
  }
  return score;
}

export function readRowField(row, expectedNames, fallbackIndex) {
  const data =
    row && typeof row.toObject === "function" ? row.toObject() : row || {};

  const normalizedEntries = new Map(
    Object.entries(data).map(([key, value]) => [
      normalizeHeaderName(key),
      value,
    ])
  );

  for (const expectedName of expectedNames || []) {
    const normalizedExpectedName = normalizeHeaderName(expectedName);
    if (normalizedEntries.has(normalizedExpectedName)) {
      return normalizedEntries.get(normalizedExpectedName);
    }
  }

  const values = Object.values(data);
  if (
    typeof fallbackIndex === "number" &&
    fallbackIndex >= 0 &&
    fallbackIndex < values.length
  ) {
    return values[fallbackIndex];
  }

  return "";
}

export function findRowHeaderKey(row, expectedNames) {
  const data =
    row && typeof row.toObject === "function" ? row.toObject() : row || {};

  const normalizedKeyToActualKey = new Map(
    Object.keys(data).map((key) => [normalizeHeaderName(key), key])
  );

  for (const expectedName of expectedNames || []) {
    const normalizedExpectedName = normalizeHeaderName(expectedName);
    if (normalizedKeyToActualKey.has(normalizedExpectedName)) {
      return normalizedKeyToActualKey.get(normalizedExpectedName);
    }
  }

  return null;
}

export function setRowField(row, expectedNames, value) {
  const key = findRowHeaderKey(row, expectedNames);
  if (!key) {
    return false;
  }

  row.set(key, value);
  return true;
}

export async function getSheetRowsByTitle(title, options = {}) {
  const {
    expectedHeaders = [],
    minHeaderMatches = 1,
    headerScanRows = DEFAULT_HEADER_SCAN_ROWS,
    headerScanLastColumn = DEFAULT_HEADER_SCAN_LAST_COLUMN,
  } = options;

  const sheet = await getSheetByTitle(title);
  const normalizedExpectedHeaders = normalizeExpectedHeaders(expectedHeaders);

  if (!normalizedExpectedHeaders.length) {
    const rows = await sheet.getRows();
    return { sheet, rows, headerRowIndex: 1 };
  }

  const headerScanRange = `A1:${headerScanLastColumn}${headerScanRows}`;
  const values = await sheet.getCellsInRange(headerScanRange);

  if (!values || !values.length) {
    throw new Error(
      `Could not detect headers in "${title}". Expected headers like: ${expectedHeaders.join(
        ", "
      )}`
    );
  }

  let bestRowIndex = -1;
  let bestScore = -1;

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const score = scoreHeaderRow(values[rowIndex], normalizedExpectedHeaders);
    if (score > bestScore) {
      bestScore = score;
      bestRowIndex = rowIndex;
    }

    if (score === normalizedExpectedHeaders.length) {
      break;
    }
  }

  const requiredMatches = Math.max(
    1,
    Math.min(minHeaderMatches, normalizedExpectedHeaders.length)
  );

  if (bestRowIndex < 0 || bestScore < requiredMatches) {
    throw new Error(
      `Could not detect header row in "${title}". Expected headers like: ${expectedHeaders.join(
        ", "
      )}`
    );
  }

  const headerRowIndex = bestRowIndex + 1;
  await sheet.loadHeaderRow(headerRowIndex);
  const rows = await sheet.getRows();

  return { sheet, rows, headerRowIndex };
}
