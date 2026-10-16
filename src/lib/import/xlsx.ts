import { inflateRawSync } from "node:zlib";

type Attributes = Map<string, string>;

export type XlsxSheet = Record<number, Record<string, string>>;

export type XlsxWorkbook = {
  sheetNames: string[];
  sheets: Record<string, XlsxSheet>;
};

function decodeEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseAttributes(tag: string): Attributes {
  const attrs: Attributes = new Map();
  const re = /([a-zA-Z0-9:_-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag)) !== null) attrs.set(match[1], match[2]);
  return attrs;
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Workbook is not a valid ZIP/XLSX archive");

  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > buffer.length) throw new Error("Workbook archive central directory is invalid");

  let pos = cdOffset;
  const limit = cdOffset + cdSize;
  while (pos < limit) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString("utf8");
    if (name.startsWith("xl/")) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      const data = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
      if (!data || data.length !== uncompressedSize) throw new Error(`Could not read workbook entry ${name}`);
      entries.set(name, data);
    }
    pos += 46 + nameLength + extraLength;
  }
  if (entries.size === 0) throw new Error("Workbook contained no readable entries");
  return entries;
}

function parseSharedStrings(xml: string) {
  const strings: string[] = [];
  const entries = xml.match(/<si\b[\s\S]*?<\/si>/g) ?? [];
  for (const entry of entries) {
    const parts = entry.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [];
    strings.push(
      parts
        .map((part) => decodeEntities(part.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? ""))
        .join("")
    );
  }
  return strings;
}

function cellValue(tag: string, inner: string, sharedStrings: string[]) {
  const attributes = parseAttributes(tag);
  const type = attributes.get("t");
  if (type === "s") {
    const index = Number(decodeEntities(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ""));
    return Number.isFinite(index) ? sharedStrings[index] ?? "" : "";
  }
  if (type === "inlineStr") {
    return decodeEntities(
      (inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) ?? [])
        .map((part) => part.replace(/<\/?t\b[^>]*>/g, ""))
        .join("")
    );
  }
  return decodeEntities(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
}

function parseSheet(xml: string, sharedStrings: string[]) {
  const rows: XlsxSheet = {};
  const rowMatches = xml.match(/<row\b[^>]*>([\s\S]*?)<\/row>/g) ?? [];
  for (const [index, rowXml] of rowMatches.entries()) {
    const rowAttrs = parseAttributes(rowXml.match(/^<row\b[^>]*>/)?.[0] ?? "");
    const rowNumber = Number(rowAttrs.get("r") ?? index + 1);
    if (!Number.isFinite(rowNumber)) continue;
    const cells: Record<string, string> = {};
    const cellMatches = rowXml.match(/<c\b[^>]*>([\s\S]*?)<\/c>/g) ?? [];
    for (const cellXml of cellMatches) {
      const opening = cellXml.match(/^<c\b[^>]*>/)?.[0] ?? "";
      const attributes = parseAttributes(opening);
      const column = (attributes.get("r") ?? "").replace(/[0-9]/g, "");
      if (!column) continue;
      const inner = cellXml.match(/^<c\b[^>]*>([\s\S]*?)<\/c>$/)?.[1] ?? "";
      cells[column] = cellValue(opening, inner, sharedStrings);
    }
    rows[rowNumber] = cells;
  }
  return rows;
}

export function parseWorkbook(buffer: Buffer): XlsxWorkbook {
  const entries = readZipEntries(buffer);
  const workbookXml = entries.get("xl/workbook.xml")?.toString("utf8");
  const workbookRelsXml = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  const sharedStringsXml = entries.get("xl/sharedStrings.xml")?.toString("utf8");

  if (!workbookXml || !workbookRelsXml) throw new Error("Workbook metadata is missing");

  const rels = new Map<string, string>();
  for (const tag of workbookRelsXml.match(/<Relationship\b[^>]*(?:\/>|>[\s\S]*?<\/Relationship>)/g) ?? []) {
    const attrs = parseAttributes(tag);
    const id = attrs.get("Id");
    const target = attrs.get("Target");
    if (id && target) rels.set(id, target);
  }

  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : [];
  const sheetNames: string[] = [];
  const sheets: Record<string, XlsxSheet> = {};

  for (const tag of workbookXml.match(/<sheet\b[^>]*(?:\/>|>[\s\S]*?<\/sheet>)/g) ?? []) {
    const attrs = parseAttributes(tag);
    const name = attrs.get("name");
    const relationshipId = attrs.get("r:id");
    if (!name || !relationshipId) continue;
    let target = rels.get(relationshipId);
    if (!target) continue;
    if (!target.startsWith("xl/")) target = `xl/${target.replace(/^\//, "")}`;
    target = target.replace(/^\//, "");
    const xml = entries.get(target)?.toString("utf8");
    if (!xml) throw new Error(`Could not read worksheet ${name}`);
    sheets[name] = parseSheet(xml, sharedStrings);
    sheetNames.push(name);
  }

  if (sheetNames.length === 0) throw new Error("Workbook contained no worksheets");
  return { sheetNames, sheets };
}
