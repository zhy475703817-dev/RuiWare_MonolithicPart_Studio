import type { Draft } from "../../../../types";
import { validateSweepPathTopology } from "../../../sketch/sweepPathTopology";

export type SweepPreviewAdmission = { allowed: boolean; missing: string[] };

/** 前端预览准入只负责显示缺项；最终判断仍由后端重复执行。 */
export function sweepPreviewAdmission(draft: Draft): SweepPreviewAdmission {
  const missing: string[] = [];
  const sweep = draft.geometryRecipe.operations.find((item) => item.operator === "solid.sweep");
  if (!sweep) return { allowed: true, missing };
  const entities = draft.sketch.entities.filter((item) => !item.construction);
  const regions = draft.sketch.regions;
  const entityIds = new Set(entities.map((item) => item.id));
  if (!entities.length || !regions.length || regions.some((region) => !region.closed || region.boundaryRefs.some((id) => !entityIds.has(id)))) missing.push("闭合截面草图");
  const path = draft.sweepPath;
  if (!path || !path.geometry.length || path.status !== "confirmed") missing.push("已确认扫掠路径");
  if (path) {
    const topology = validateSweepPathTopology(path);
    if (topology.diagnostics.some((item) => item.severity === "error" && item.code !== "SWEEP_PATH_ARC_UNSUPPORTED")) missing.push("有效路径拓扑");
    if (!topology.startEndpointRef) missing.push("路径起点");
  }
  if (sweep.profileSketchId !== "sketch.section.main" || sweep.pathSketchId !== "path.main" || new Set(sweep.sourceRefs).size !== 2 || !sweep.sourceRefs.includes("sketch.section.main") || !sweep.sourceRefs.includes("path.main") || !draft.geometryRecipe.sketches.includes("sketch.section.main") || !draft.geometryRecipe.paths.includes("path.main")) missing.push("一致的截面/路径草图引用");
  if (sweep.profileAnchor !== "sketch.origin" || !["followPath", "fixedWorld", "minimumTwist"].includes(sweep.orientationMode ?? "minimumTwist") || sweep.scaleMode !== "constant" || sweep.twistMode !== "none" || sweep.cornerMode !== "right") missing.push("有效扫掠配置");
  if (!draft.parameterDefinitions.length) missing.push("生成参数");
  const hasMaterial = draft.materialRequirements.length > 0 && draft.materialRequirements.every((item) => item.reviewed && !!item.supplyForm);
  if (!hasMaterial) missing.push("材料数据");
  return { allowed: missing.length === 0, missing: Array.from(new Set(missing)) };
}
