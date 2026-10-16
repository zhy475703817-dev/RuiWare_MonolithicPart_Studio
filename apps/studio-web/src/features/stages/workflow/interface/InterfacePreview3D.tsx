import { Suspense } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { Bounds, Edges, Grid, Line, OrbitControls } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { Box, LoaderCircle } from "lucide-react";
import type { CompileResult, Draft, ResolvedFeature, TemplateEvaluation } from "../../../../types";

const COLORS = ["#dc3f55", "#2478d0", "#15966b", "#9a52d0", "#d27a16", "#008d9e"];

function FaceOverlay({ hostFrame, color, min, max, center, region }: { hostFrame: string; color: string; min: [number, number, number]; max: [number, number, number]; center: [number, number, number]; region?: { mode: "rectangle"; uStart: number; vStart: number; uSpan: number; vSpan: number } | null }) {
  const offset = 0.8;
  const material = <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} side={2} />;
  const fullU = hostFrame === "negativeX" || hostFrame === "positiveX" ? max[1] - min[1] : max[0] - min[0];
  const fullV = hostFrame === "negativeZ" || hostFrame === "positiveZ" ? max[1] - min[1] : max[2] - min[2];
  const uSpan = region?.uSpan || fullU;
  const vSpan = region?.vSpan || fullV;
  const uCenter = region ? region.uStart - (hostFrame === "negativeX" || hostFrame === "positiveX" ? center[1] : center[0]) : (hostFrame === "negativeX" || hostFrame === "positiveX" ? min[1] : min[0]) + uSpan / 2;
  const vCenter = region ? region.vStart - (hostFrame === "negativeZ" || hostFrame === "positiveZ" ? center[1] : center[2]) : (hostFrame === "negativeZ" || hostFrame === "positiveZ" ? min[1] : min[2]) + vSpan / 2;
  if (hostFrame === "negativeY" || hostFrame === "positiveY") {
    const y = (hostFrame === "negativeY" ? min[1] : max[1]) + (hostFrame === "negativeY" ? -offset : offset);
    return <mesh position={[uCenter, y, vCenter]} rotation={[Math.PI / 2, 0, 0]} scale={[uSpan, vSpan, 1]} renderOrder={4}><planeGeometry args={[1, 1]} />{material}<Edges color={color} linewidth={3} /></mesh>;
  }
  if (hostFrame === "negativeX" || hostFrame === "positiveX") {
    const x = (hostFrame === "negativeX" ? min[0] : max[0]) + (hostFrame === "negativeX" ? -offset : offset);
    return <mesh position={[x, uCenter, vCenter]} rotation={[0, Math.PI / 2, 0]} scale={[vSpan, uSpan, 1]} renderOrder={4}><planeGeometry args={[1, 1]} />{material}<Edges color={color} linewidth={3} /></mesh>;
  }
  if (hostFrame === "negativeZ" || hostFrame === "positiveZ") {
    const z = (hostFrame === "negativeZ" ? min[2] : max[2]) + (hostFrame === "negativeZ" ? -offset : offset);
    return <mesh position={[uCenter, vCenter, z]} scale={[uSpan, vSpan, 1]} renderOrder={4}><planeGeometry args={[1, 1]} />{material}<Edges color={color} linewidth={3} /></mesh>;
  }
  return null;
}

function InterfaceOverlays({ draft, evaluation, min, max, center }: { draft: Draft; evaluation: TemplateEvaluation | null; min: [number, number, number]; max: [number, number, number]; center: [number, number, number] }) {
  const byId = new Map(draft.geometryRecipe.semanticFaces.map((face) => [face.id, face]));
  return <>{(evaluation?.resolvedInterfaces || []).map((item) => {
    if (item.declarationMode === "featureDerived") return null;
    const colorIndex = draft.interfaces.findIndex((candidate) => candidate.id === item.sourceInterfaceId);
    const color = COLORS[(colorIndex < 0 ? 0 : colorIndex) % COLORS.length];
    return item.geometryRefs.map((faceId) => { const face = byId.get(faceId); return face ? <FaceOverlay key={`${item.id}-${faceId}`} hostFrame={face.hostFrame} color={color} min={min} max={max} center={center} region={item.region} /> : null; });
  })}</>;
}

function FeatureOutline({ feature, color, width, height, length, center }: { feature: ResolvedFeature; color: string; width: number; height: number; length: number; center: [number, number, number] }) {
  const args = feature.arguments;
  const x = Number(args.x ?? 0) - center[0];
  const z = Number(args.z ?? 0) - center[2];
  const size = Number(args.diameter ?? args.width ?? 10);
  const host = feature.hostFace;
  if (feature.featureType === "circularHole") {
    const radius = Math.max(1, size / 2);
    const y = Number(args.x ?? 0) - center[1];
    if (host === "negativeY" || host === "positiveY") return <mesh position={[x, host === "negativeY" ? -height / 2 - 0.8 : height / 2 + 0.8, z]} rotation={[Math.PI / 2, 0, 0]} renderOrder={5}><torusGeometry args={[radius, Math.max(0.8, radius * 0.08), 8, 40]} /><meshBasicMaterial color={color} /></mesh>;
    if (host === "negativeX" || host === "positiveX") return <mesh position={[host === "negativeX" ? -width / 2 - 0.8 : width / 2 + 0.8, y, z]} rotation={[0, Math.PI / 2, 0]} renderOrder={5}><torusGeometry args={[radius, Math.max(0.8, radius * 0.08), 8, 40]} /><meshBasicMaterial color={color} /></mesh>;
    if (host === "negativeZ" || host === "positiveZ") return <mesh position={[x, Number(args.z ?? 0) - center[1], host === "negativeZ" ? -length / 2 - 0.8 : length / 2 + 0.8]} renderOrder={5}><torusGeometry args={[radius, Math.max(0.8, radius * 0.08), 8, 40]} /><meshBasicMaterial color={color} /></mesh>;
  }
  const w = feature.featureType === "circularHole" ? size : Number(args.width ?? size);
  const d = feature.featureType === "straightSlot" ? Number(args.length ?? size) : Number(args.height ?? size);
  if (host === "negativeY" || host === "positiveY") {
    const y = host === "negativeY" ? -height / 2 - 0.8 : height / 2 + 0.8;
    const points: [number, number, number][] = feature.featureType === "straightSlot"
      ? [[x - w / 2, y, z - (d - w) / 2], [x - w / 2, y, z + (d - w) / 2], [x, y, z + d / 2], [x + w / 2, y, z + (d - w) / 2], [x + w / 2, y, z - (d - w) / 2], [x, y, z - d / 2]]
      : [[x - w / 2, y, z - d / 2], [x + w / 2, y, z - d / 2], [x + w / 2, y, z + d / 2], [x - w / 2, y, z + d / 2]];
    return <Line points={[...points, points[0]]} color={color} lineWidth={3} />;
  }
  return null;
}

function PreviewScene({ url, draft, evaluation }: { url: string; draft: Draft; evaluation: TemplateEvaluation | null }) {
  const geometry = useLoader(STLLoader, url);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const min = box?.min;
  const max = box?.max;
  const width = Math.max(1, (max?.x || 0) - (min?.x || 0));
  const height = Math.max(1, (max?.y || 0) - (min?.y || 0));
  const length = Math.max(1, (max?.z || 0) - (min?.z || 0));
  const center: [number, number, number] = [((min?.x || 0) + (max?.x || 0)) / 2, ((min?.y || 0) + (max?.y || 0)) / 2, ((min?.z || 0) + (max?.z || 0)) / 2];
  const interfaceIds = new Set(draft.interfaces.map((item) => item.id));
  const featureInterfaces = (evaluation?.resolvedInterfaces || []).filter((item) => item.sourceFeatureId && interfaceIds.has(item.sourceInterfaceId));
  const localMin: [number, number, number] = [min ? min.x - center[0] : -width / 2, min ? min.y - center[1] : -height / 2, min ? min.z - center[2] : -length / 2];
  const localMax: [number, number, number] = [max ? max.x - center[0] : width / 2, max ? max.y - center[1] : height / 2, max ? max.z - center[2] : length / 2];
  return <group><mesh geometry={geometry} position={[-center[0], -center[1], -center[2]]} castShadow receiveShadow><meshStandardMaterial color="#9ca8b3" roughness={0.38} metalness={0.28} /></mesh><InterfaceOverlays draft={draft} evaluation={evaluation} min={localMin} max={localMax} center={center} />{featureInterfaces.map((item, index) => { const feature = evaluation?.features.find((candidate) => candidate.id === item.sourceFeatureId); return feature ? <FeatureOutline key={item.id} feature={feature} color={COLORS[draft.interfaces.findIndex((candidate) => candidate.id === item.sourceInterfaceId) % COLORS.length] || COLORS[index % COLORS.length]} width={width} height={height} length={length} center={center} /> : null; })}</group>;
}

export function InterfacePreview3D({ draft, result, evaluation, busy, error, onRefresh }: { draft: Draft; result: CompileResult | null; evaluation: TemplateEvaluation | null; busy: boolean; error: string; onRefresh: () => void }) {
  const stl = result?.artifacts.find((item) => item.kind === "stl");
  return <div className="interface-preview panel"><div className="interface-preview-head"><div><strong>接口三维预览</strong><span>彩色轮廓表示接口面和接口孔的真实轮廓。</span></div><button className="secondary-btn" disabled={busy} onClick={onRefresh}>{busy ? <LoaderCircle size={14} className="spin" /> : <Box size={14} />} {busy ? "生成中…" : "生成／刷新预览"}</button></div>{!stl ? <div className="interface-preview-empty"><Box size={30} /><span>{error || "填写接口关联几何后，点击“生成／刷新预览”。"}</span></div> : <><div className="interface-preview-canvas"><Canvas camera={{ position: [160, 140, 220], fov: 42 }} shadows><color attach="background" args={["#f5f6f7"]} /><ambientLight intensity={1.6} /><directionalLight position={[100, 160, 180]} intensity={2.6} castShadow /><Suspense fallback={null}><Bounds fit clip observe margin={1.25}><PreviewScene url={stl.sha256 ? `${stl.url}?sha256=${stl.sha256}` : stl.url} draft={draft} evaluation={evaluation} /></Bounds></Suspense><Grid position={[0, -8, 0]} args={[600, 600]} cellSize={20} cellColor="#d4d9de" sectionSize={100} sectionColor="#aeb7c0" fadeDistance={700} infiniteGrid /><OrbitControls makeDefault /></Canvas></div><div className="interface-preview-legend"><small>彩色轮廓：接口面／接口孔</small>{draft.interfaces.map((item, index) => <span key={item.id}><i style={{ background: COLORS[index % COLORS.length] }} />{item.name || "未命名接口"}</span>)}</div></>}</div>;
}
