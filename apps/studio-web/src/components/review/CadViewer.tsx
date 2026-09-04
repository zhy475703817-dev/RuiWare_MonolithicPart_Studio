import { Suspense } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { Bounds, Center, Grid, OrbitControls } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { Box } from "lucide-react";
import type { CompileResult } from "../../types";

/** 加载并显示 CAD Worker 生成的 STL 网格。 */
function Model({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  return (
    <Center>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color="#e99a35" roughness={0.34} metalness={0.4} />
      </mesh>
    </Center>
  );
}

/**
 * 三维审查组件。
 *
 * 组件只消费编译结果，不参与 CAD 计算；没有 STL 产物时显示引导状态，
 * 有产物时提供旋转、缩放和平移能力。
 */
export function CadViewer({ result, stale = false }: { result: CompileResult | null; stale?: boolean }) {
  const stl = result?.artifacts.find((item) => item.kind === "stl");
  if (!stl) {
    return (
      <div className="viewer-empty">
        <Box size={38} />
        <strong>等待生成三维模型</strong>
        <span>先保存模板并完成参数求值，再运行 B-Rep 编译</span>
      </div>
    );
  }
  // The artifact path is deterministic for a draft input hash and therefore
  // stays the same when a worker recompiles that input after an implementation
  // change.  Include the content hash in the loader key so Three.js does not
  // keep rendering a stale STL from its URL cache.
  const stlLoaderUrl = stl.sha256 ? `${stl.url}?sha256=${stl.sha256}` : stl.url;
  return (
    <div className="cad-viewer">
      {stale && <div className="viewer-stale-banner">当前显示的是上一次成功生成的预览；它对应的扫掠输入已发生变化。</div>}
      <Canvas camera={{ position: [160, 140, 220], fov: 42 }} shadows>
        <color attach="background" args={["#f5f6f7"]} />
        <ambientLight intensity={1.7} />
        <directionalLight position={[100, 160, 180]} intensity={2.7} castShadow />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.25}>
            <Model url={stlLoaderUrl} />
          </Bounds>
        </Suspense>
        <Grid
          position={[0, -60, 0]}
          args={[600, 600]}
          cellSize={20}
          cellThickness={0.55}
          cellColor="#d4d9de"
          sectionSize={100}
          sectionColor="#aeb7c0"
          fadeDistance={700}
          infiniteGrid
        />
        <OrbitControls makeDefault />
      </Canvas>
      <span className="viewer-hint">拖拽旋转 · 滚轮缩放 · 右键平移</span>
    </div>
  );
}
