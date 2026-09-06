import { JobType } from '../../data/SignJob';

export const MAX_IMPORT_ROWS = 500;

// Sheets-derived strings go straight into text columns, which impose no bound
// of their own — a single Google Sheets cell holds up to 50,000 characters, so
// 500 rows of pasted junk is a ~25MB insert. These caps are generous against
// real Australian address and agency data and exist to fail loudly, on the
// offending row, rather than silently truncating (a truncated address geocodes
// to the wrong place, which is worse than a refused import).
const MAX_ADDRESS_CHARS = 300;
const MAX_NAME_CHARS = 200;
const MAX_NOTES_CHARS = 500;
const MAX_SIZE_CHARS = 100;

// Sign2Site actual sheet column layout:
// A: Date (serial number with UNFORMATTED_VALUE), B: AGENCY, C: AGENT,
// D: NOTES (install instructions), E: SIZE (sign dimensions), F: Printed (skip), G: ADDRESS
const COL = {
  date: 0,
  clientName: 1,   // B — AGENCY
  agentName: 2,    // C — AGENT (name; sometimes includes job notes like "(ADD WINGS)")
  notes: 3,        // D — NOTES (install placement instructions)
  size: 4,         // E — sign dimensions (6x4, 4x3, 6x2 SS, COR, etc.)
  // index 5 = F (Printed) — not used
  address: 6,      // G — ADDRESS (must be non-empty; used to geocode)
};

// Google Sheets returns date cells as Excel serial numbers when valueRenderOption=UNFORMATTED_VALUE.
// Serial 0 = 1899-12-30; each integer is one calendar day.
function serialToLocalDate(serial: number): Date {
  const base = new Date(1899, 11, 30);
  base.setDate(base.getDate() + Math.floor(serial));
  return base;
}

function serialMatchesDate(serial: unknown, target: Date): boolean {
  if (typeof serial !== 'number') return false;
  const d = serialToLocalDate(serial);
  return (
    d.getFullYear() === target.getFullYear() &&
    d.getMonth() === target.getMonth() &&
    d.getDate() === target.getDate()
  );
}

// Detect removal jobs from agent + notes text. The sheet uses no explicit job_type column;
// "removal" only appears as incidental text in rare cases. Defaults to 'install'.
export function detectJobType(agentText: string, notesText: string): JobType {
  const combined = `${agentText} ${notesText}`.toLowerCase();
  if (
    combined.includes('removal') ||
    combined.includes('take down') ||
    combined.includes('collect sign')
  ) {
    return 'removal';
  }
  return 'install';
}

// Sheets cells are unbounded; the destination columns are `text`. Fail on the
// offending row rather than truncating — see the MAX_*_CHARS comment above.
//
// Behaviour note (changed 2026-08-21): the previous inline reads were
// `row[col] ? String(row[col]).trim() : ''`, so a cell holding the NUMBER 0 was
// falsy and became ''. This reads it as '0'. That is deliberate — dropping a
// cell's contents because it happens to be zero is data loss, not tidiness —
// but it is a real difference and is pinned by a test.
function readCell(row: unknown[], col: number, rowNum: number, label: string, max: number): string {
  const raw = row[col];
  if (raw === undefined || raw === null) return '';
  // Collapse embedded newlines/tabs: a multi-line address breaks geocoding and
  // a stray newline in a name is never intentional.
  const value = String(raw).replace(/\s+/g, ' ').trim();
  if (value.length > max) {
    throw new Error(
      `Row ${rowNum}: ${label} is ${value.length} characters — the limit is ${max}. ` +
        `Check that cell in the sheet.`
    );
  }
  return value;
}

export type Candidate = {
  rowNum: number;
  address: string;
  clientName: string;
  agentText: string;
  notes: string;
  signDescription: string;
};

// Phase 1 of importJobs: parse, validate and count without touching the
// network, so the row cap and every malformed-cell error are raised before a
// single billable geocode request goes out. The previous single-pass loop
// geocoded rows 1..500 and only then discovered row 501 blew the cap.
export function parseCandidates(allRows: unknown[][], importDate: Date): Candidate[] {
  const candidates: Candidate[] = [];

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const rowNum = i + 2; // 1-indexed, offset by skipped header row

    // Skip rows without an address or not matching the target date
    const rawAddress = row[COL.address];
    if (!rawAddress || !String(rawAddress).trim()) continue;
    if (!serialMatchesDate(row[COL.date], importDate)) continue;

    if (candidates.length + 1 > MAX_IMPORT_ROWS) {
      throw new Error(
        `More than ${MAX_IMPORT_ROWS} jobs found for this date — split them across separate route codes first.`
      );
    }

    const address = readCell(row, COL.address, rowNum, 'the address', MAX_ADDRESS_CHARS);
    const notes = readCell(row, COL.notes, rowNum, 'the notes cell', MAX_NOTES_CHARS);
    const size = readCell(row, COL.size, rowNum, 'the size cell', MAX_SIZE_CHARS);
    const agentText = readCell(row, COL.agentName, rowNum, 'the agent name', MAX_NAME_CHARS);
    const clientName = readCell(row, COL.clientName, rowNum, 'the agency name', MAX_NAME_CHARS);

    // Row reference appended so admin can trace back to the source sheet for contact details
    const noteParts = [notes, size && `(${size})`].filter(Boolean).join(' ');
    const signDescription = noteParts ? `${noteParts} — Row ${rowNum}` : `Row ${rowNum}`;

    candidates.push({ rowNum, address, clientName, agentText, notes, signDescription });
  }

  return candidates;
}
