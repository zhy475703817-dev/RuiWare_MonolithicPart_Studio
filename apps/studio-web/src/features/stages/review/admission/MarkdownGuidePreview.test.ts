import { describe, expect, it } from "vitest";
import { parseGuideMarkdown, splitGuideBlocks } from "./MarkdownGuidePreview";

describe("MarkdownGuidePreview", () => {
  it("parses guide headings, tables, steps and notes for readable rendering", () => {
    const blocks = parseGuideMarkdown([
      "## 参数填写指南",
      "",
      "> 先填写长度。",
      "",
      "1. 创建草图。",
      "2. 添加约束。",
      "",
      "| 参数 | 值 |",
      "| --- | --- |",
      "| `length` | 100 |",
    ].join("\n"));

    expect(blocks.map((block) => block.type)).toEqual(["heading", "quote", "ordered", "table"]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2, text: "参数填写指南" });
    expect(blocks[2]).toMatchObject({ type: "ordered", items: ["创建草图。", "添加约束。"] });
    expect(blocks[3]).toMatchObject({ type: "table", headers: ["参数", "值"], rows: [["`length`", "100"]] });
  });

  it("separates the technical appendix from the user-facing guide", () => {
    const result = splitGuideBlocks("# 手册\n\n## 参数\n\n正文\n\n## 技术附录\n\n### 原始参数\n\n| ID | 值 |\n| --- | --- |\n| `length` | 100 |\n");

    expect(result.main.map((block) => block.type)).toEqual(["heading", "heading", "paragraph"]);
    expect(result.technical.map((block) => block.type)).toEqual(["heading", "heading", "table"]);
  });
});
