import {
  Beaker,
  Box,
  ClipboardCheck,
  GitBranch,
  Layers3,
  PackageCheck,
  Variable,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { StageName } from "../../types";

/** 七阶段工作流的展示配置，供侧边栏、阶段切换和进度计算共同使用。 */
export type StageConfig = {
  id: StageName;
  number: string;
  title: string;
  caption: string;
  icon: LucideIcon;
};

/** 平台固定的模板工程阶段顺序。 */
export const STAGES: StageConfig[] = [
  {
    id: "templateInfo",
    number: "01",
    title: "定义",
    caption: "需求与证据",
    icon: ClipboardCheck,
  },
  {
    id: "material",
    number: "02",
    title: "材料",
    caption: "适用范围、毛坯与验证",
    icon: Layers3,
  },
  {
    id: "baseSketch",
    number: "03",
    title: "几何",
    caption: "配方与基准",
    icon: Box,
  },
  {
    id: "features",
    number: "04",
    title: "规则",
    caption: "制造特征生成",
    icon: GitBranch,
  },
  {
    id: "variants",
    number: "05",
    title: "契约",
    caption: "参数、接口与变体",
    icon: Variable,
  },
  {
    id: "review",
    number: "06",
    title: "验证",
    caption: "求值与 B-Rep",
    icon: Beaker,
  },
  {
    id: "admission",
    number: "07",
    title: "发布",
    caption: "准入与版本",
    icon: PackageCheck,
  },
];
