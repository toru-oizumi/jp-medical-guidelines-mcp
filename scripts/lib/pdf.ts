import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Line } from "./structure.js";

type TextItem = { str: string; transform: number[]; height: number };

/** PDF を「行」の列にする。PDF のテキストは行単位で来ないので、y 座標の近いものを束ねる。 */
export async function readLines(file: string): Promise<{ lines: Line[]; numPages: number }> {
  const data = new Uint8Array(await readFile(file));
  const pdf = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const lines: Line[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    lines.push(...groupByLine(p, content.items as TextItem[]));
  }
  return { lines, numPages: pdf.numPages };
}

export function groupByLine(page: number, items: TextItem[]): Line[] {
  const rows = new Map<number, { x: number; str: string; h: number }[]>();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]!);
    const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
    let row = rows.get(key);
    if (!row) rows.set(key, (row = []));
    row.push({ x: it.transform[4]!, str: it.str, h: it.height });
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, cells]) => {
      cells.sort((a, b) => a.x - b.x);
      return {
        page,
        y,
        x: Math.round(cells[0]!.x),
        h: Math.max(...cells.map((c) => c.h)),
        text: cells
          .map((c) => c.str)
          .join("")
          .replace(/\s+/g, " ")
          .trim(),
      };
    })
    .filter((l) => l.text.length > 0);
}
