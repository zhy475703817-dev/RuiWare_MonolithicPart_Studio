import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Field, NumberInput } from "../../../../components/ui/FormParts";
import type { MatingContract } from "../../../../types";
import { MatingContractEditor } from "./MatingContractEditor";

function find(node: ReactNode, predicate: (element: ReactElement<any>) => boolean): ReactElement<any> {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (predicate(child)) return child;
    try { return find(child.props.children, predicate); } catch { /* Search remaining siblings. */ }
  }
  throw new Error("Editor control not found");
}

function setup() {
  const change = vi.fn();
  const empty = MatingContractEditor({ onChange: change });
  find(empty, (element) => element.type === "button").props.onClick();
  const value = change.mock.calls[0][0] as MatingContract;
  change.mockClear();
  return { value, change, tree: MatingContractEditor({ value, onChange: change }) };
}

describe("template interface mating contract", () => {
  it("keeps legacy interfaces optional and creates the documented pin-hole example", () => {
    const { value, tree } = setup();
    expect(value).toEqual({
      version: 1, family: "pin-hole", role: "pin", connectionMethod: "clearance-fit",
      dimensions: { diameter: { nominal: 10, lowerTolerance: -0.02, upperTolerance: 0.02, unit: "mm" } },
      allowedRelations: ["同轴", "贴合"], capacity: 1,
    });
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain("配合契约（mating）");
    expect(markup).toContain("pin-hole");
    expect(markup).toContain("下偏差");
    expect(markup).toContain("发布新版本");
  });

  it("updates the role and tolerance without overwriting other contract fields", () => {
    const { value, change, tree } = setup();
    const role = find(tree, (element) => element.type === Field && element.props.label === "配合角色（role）");
    find(role.props.children, (element) => element.type === "input").props.onChange({ target: { value: "hole" } });
    expect(change).toHaveBeenLastCalledWith({ ...value, role: "hole" });
    const tolerance = find(tree, (element) => element.type === Field && element.props.label === "下偏差");
    find(tolerance.props.children, (element) => element.type === NumberInput).props.onChange(-0.005);
    expect(change).toHaveBeenLastCalledWith({ ...value, dimensions: { diameter: { ...value.dimensions.diameter, lowerTolerance: -0.005 } } });
  });

  it("allows multiple dimensions and prevents overwriting an existing name", () => {
    const { value, change, tree } = setup();
    find(tree, (element) => element.type === "button" && renderToStaticMarkup(element).includes("新增尺寸")).props.onClick();
    const expanded = change.mock.calls[0][0] as MatingContract;
    expect(Object.keys(expanded.dimensions)).toEqual(["diameter", "dimension1"]);
    const expandedTree = MatingContractEditor({ value: expanded, onChange: change });
    const rename = find(expandedTree, (element) => element.type === "input" && element.props.value === "diameter");
    change.mockClear();
    rename.props.onChange({ target: { value: "dimension1" } });
    expect(change).not.toHaveBeenCalled();
    rename.props.onChange({ target: { value: "width" } });
    expect(change.mock.calls[0][0].dimensions.width).toEqual(value.dimensions.diameter);
  });

  it("parses relation names, flags reversed tolerances and removes the contract", () => {
    const { value, change, tree } = setup();
    const relations = find(tree, (element) => element.type === "input" && element.props.onBlur);
    relations.props.onBlur({ target: { value: "同轴， 贴合, " } });
    expect(change).toHaveBeenLastCalledWith({ ...value, allowedRelations: ["同轴", "贴合"] });
    const invalid = { ...value, dimensions: { diameter: { ...value.dimensions.diameter, lowerTolerance: 1 } } };
    expect(renderToStaticMarkup(<MatingContractEditor value={invalid} onChange={change} />)).toContain('role="alert"');
    find(tree, (element) => element.type === "button" && renderToStaticMarkup(element).includes("移除配合契约")).props.onClick();
    expect(change).toHaveBeenLastCalledWith(null);
  });

  it.each(["welded", "bolted"])("creates a %s plane-contact contract without dummy dimensions", (method) => {
    const change = vi.fn();
    const empty = MatingContractEditor({ onChange: change });
    const label = method === "welded" ? "焊接" : "螺栓连接";
    find(empty, (element) => element.type === "button" && renderToStaticMarkup(element).includes(`添加面贴合契约·${label}`)).props.onClick();
    const value = change.mock.calls[0][0] as MatingContract;
    expect(value).toEqual({ version: 1, family: "plane-contact", role: "surface", connectionMethod: method, dimensions: {}, allowedRelations: ["贴合"], capacity: 1 });
    const tree = MatingContractEditor({ value, onChange: change });
    const markup = renderToStaticMarkup(tree);
    expect(markup).toContain("面贴合可不填写尺寸");
    expect(markup).not.toContain("diameter");
    const select = find(tree, (element) => element.type === "select");
    const next = method === "welded" ? "bolted" : "welded";
    select.props.onChange({ target: { value: next } });
    expect(change).toHaveBeenLastCalledWith({ ...value, connectionMethod: next });
    find(tree, (element) => element.type === "button" && renderToStaticMarkup(element).includes("新增尺寸")).props.onClick();
    const expanded = change.mock.calls.at(-1)![0] as MatingContract;
    const expandedTree = MatingContractEditor({ value: expanded, onChange: change });
    const remove = find(expandedTree, (element) => element.type === "button" && renderToStaticMarkup(element).includes("删除尺寸"));
    expect(remove.props.disabled).toBe(false);
    remove.props.onClick();
    expect(change).toHaveBeenLastCalledWith(value);
  });
});
