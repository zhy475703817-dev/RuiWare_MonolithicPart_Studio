import { Fragment, type ReactNode } from "react";

export type GuideBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "ordered" | "unordered"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

function isTableSeparator(line: string) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line);
}

function cells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

export function parseGuideMarkdown(markdown: string): GuideBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: GuideBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (line.startsWith("> ")) {
      blocks.push({ type: "quote", text: line.slice(2) });
      index += 1;
      continue;
    }
    if (line.startsWith("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1].trim())) {
      const headers = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(cells(lines[index]));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }
    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    const unordered = /^[-*]\s+(.+)$/.exec(line);
    if (ordered || unordered) {
      const type = ordered ? "ordered" : "unordered";
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const match = type === "ordered" ? /^\d+\.\s+(.+)$/.exec(current) : /^[-*]\s+(.+)$/.exec(current);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type, items });
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,6})\s|^>\s|^\d+\.\s|^[-*]\s|^\|/.test(lines[index].trim())) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

function inlineText(text: string): ReactNode {
  return text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> : <Fragment key={index}>{part}</Fragment>,
  );
}

export function MarkdownGuidePreview({ markdown }: { markdown: string }) {
  return (
    <div className="reconstruction-guide-content">
      {parseGuideMarkdown(markdown).map((block, index) => {
        if (block.type === "heading") {
          const Tag = (`h${Math.min(block.level, 4)}`) as "h1" | "h2" | "h3" | "h4";
          return <Tag key={index}>{inlineText(block.text)}</Tag>;
        }
        if (block.type === "quote") return <aside className="reconstruction-guide-note" key={index}>{inlineText(block.text)}</aside>;
        if (block.type === "paragraph") return <p key={index}>{inlineText(block.text)}</p>;
        if (block.type === "ordered" || block.type === "unordered") {
          const Tag = block.type === "ordered" ? "ol" : "ul";
          return <Tag key={index}>{block.items.map((item) => <li key={item}>{inlineText(item)}</li>)}</Tag>;
        }
        if (block.type !== "table") return null;
        return (
          <div className="reconstruction-guide-table-wrap" key={index}>
            <table>
              <thead><tr>{block.headers.map((header) => <th key={header}>{inlineText(header)}</th>)}</tr></thead>
              <tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inlineText(cell)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
