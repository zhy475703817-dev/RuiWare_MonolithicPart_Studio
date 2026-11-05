import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublishReview } from "../../../../types";
import { PublishComparisonDialog } from "./PublishComparisonDialog";

const review: PublishReview = {
  reviewToken: "review-token",
  candidates: [{ publicationId: "old-release", name: "Ω 立柱", code: "OMEGA", version: 1, sha256: "a", level: "high", score: .96,
    scores: { geometry: 1, parameters: 1, features: 1, manufacturing: .5 }, canReplace: false, replacementBlockedReason: "REFERENCE_STATUS_UNKNOWN",
    differenceCount: 1, differences: [{ category: "manufacturing", path: "material-requirements.json/grade", old: "Q235", new: "Q355" }] }],
};
const props = { review, newName: "新立柱", busy: false, onCompare: () => {}, onCancel: () => {}, onPublish: () => {} };

describe("conditional publication comparison", () => {
  it("opens no prompt when no duplicate review exists", () => {
    expect(renderToStaticMarkup(<PublishComparisonDialog {...props} review={null} phase="prompt" />)).toBe("");
  });
  it("first notifies about candidates before showing the comparison", () => {
    const markup = renderToStaticMarkup(<PublishComparisonDialog {...props} phase="prompt" />);
    expect(markup).toContain("发现可能的旧版本");
    expect(markup).toContain("查看比较信息");
    expect(markup).not.toContain("Q355");
  });
  it("shows old/new definitions and blocks replacing a package with unknown references", () => {
    const markup = renderToStaticMarkup(<PublishComparisonDialog {...props} phase="compare" />);
    expect(markup).toContain("Q235");
    expect(markup).toContain("Q355");
    expect(markup).toContain("几何定义");
    expect(markup).toContain("新增模板包");
    expect(markup).toContain("引用状态尚未确认");
    expect(markup).toMatch(/disabled=""[^>]*>替换旧版本/);
  });
});
