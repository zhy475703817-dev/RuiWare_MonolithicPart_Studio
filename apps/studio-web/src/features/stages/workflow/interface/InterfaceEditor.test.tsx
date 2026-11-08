import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Draft, MatingContract, PartInterface } from "../../../../types";
import { InterfaceEditor } from "./InterfaceEditor";
import { MatingContractEditor } from "./MatingContractEditor";

vi.mock("./InterfacePreview3D", () => ({ InterfacePreview3D: () => null }));
vi.mock("./MatingContractEditor", () => ({ MatingContractEditor: vi.fn(() => null) }));

describe("plane-contact process integration", () => {
  it.each(["welded", "bolted"])("adds and locks the %s process while preserving interface data", (method) => {
    const item: PartInterface = {
      id: "mount", name: "安装面", declarationMode: "staticGeometry", interfaceType: "locating",
      locatingType: "axisCoincident", role: "secondary", geometryRefs: ["part.face.front"],
      referenceFrame: { axis: "z" }, parameterRefs: [], compatibilityTags: [],
      connectionProcesses: ["riveted"], description: "保留接口说明", required: true, reviewed: true,
    };
    const draft = { id: "draft", interfaces: [item], parameterDefinitions: [], featureRules: [], geometryRecipe: { semanticFaces: [] } } as unknown as Draft;
    const change = vi.fn();
    renderToStaticMarkup(<InterfaceEditor draft={draft} change={change} />);
    const mating: MatingContract = { version: 1, family: "plane-contact", role: "surface", connectionMethod: method, dimensions: {}, allowedRelations: ["贴合"], capacity: 1 };
    vi.mocked(MatingContractEditor).mock.calls.at(-1)![0].onChange(mating);
    const updated = change.mock.calls[0][0] as Draft;
    expect(updated.interfaces[0]).toEqual({ ...item, locatingType: "planeContact", mating, connectionProcesses: ["riveted", method] });
    const markup = renderToStaticMarkup(<InterfaceEditor draft={updated} change={change} />);
    expect(markup).toContain("面贴合契约要求的工艺会自动勾选并锁定");
    expect(markup).toMatch(/disabled=""[^>]*checked=""/);
    vi.mocked(MatingContractEditor).mock.calls.at(-1)![0].onChange(null);
    expect(change.mock.calls.at(-1)![0].interfaces[0].connectionProcesses).toEqual(["riveted", method]);
  });
});
