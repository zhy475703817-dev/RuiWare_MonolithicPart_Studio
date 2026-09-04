export type StageName =
  | "templateInfo"
  | "material"
  | "baseSketch"
  | "features"
  | "variants"
  | "review"
  | "admission";

export type StageState = "not_started" | "in_progress" | "complete";
export type ManufacturingClassification = {
  originId: string;
  primaryProcessId: string;
  secondaryProcessIds: string[];
  reviewed: boolean;
};
export type GeometryOperationDefaults = Pick<GeometryRecipe["operations"][number], "arguments" | "argumentExpressions" | "sourceRefs" | "profileAnchor" | "orientationMode" | "scaleMode" | "twistMode" | "cornerMode">;
export type RegistryOption = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  tags: string[];
};
export type GeometryPrototypeOption = RegistryOption & {
  constructionMode: string;
  previewStrategy:
    "generic" | "plate" | "openProfile" | "closedProfile" | "revolved" | "path";
  operator: string;
  drivingParameters: string[];
  implementationStatus: "available" | "configurable" | "planned";
};
export type TemplateAuthoringRegistry = {
  version: string;
  templateKind: "monolithicPart";
  origins: RegistryOption[];
  primaryProcesses: RegistryOption[];
  secondaryProcesses: RegistryOption[];
  geometryPrototypes: GeometryPrototypeOption[];
};

export type StageStatus = Record<StageName, StageState>;
export type SourceAttachment = {
  id: string;
  filename: string;
  mediaType: string;
  kind: "referenceImage" | "drawing" | "specification" | "other";
  description: string;
  size: number;
  sha256: string;
  url: string;
  createdAt: string;
};
export type Material = {
  id: string;
  code: string;
  name: string;
  type: string;
  grade?: string;
  thickness?: number;
  standard?: string;
  surface?: string;
  supplyForms?: string[];
  supplyFormSource?: string;
  requirementMatch?: { compatible: boolean; reasons: string[] };
};
export type MaterialBinding = {
  id: string;
  mode: "reference" | "copy";
  sourceLibrary: string;
  sourceRecordId: string;
  sourceChecksum: string;
  snapshot?: Material;
};
export type ParameterSource = {
  type:
    | "userInput"
    | "materialProperty"
    | "formula"
    | "lookup"
    | "productConfig"
    | "componentConfig"
    | "projectZone"
    | "standard"
    | "geometricMeasurement"
    | "externalApi"
    | "constant";
  reference?: string | null;
  expression?: string | null;
  dependencies: string[];
  lookupTable: Record<string, string | number | boolean>;
  fallback?: string | number | boolean | null;
};
export type ParameterDefinition = {
  id: string;
  label: string;
  displayName?: string;
  aliases?: string[];
  symbol?: string | null;
  valueType?: "number" | "integer" | "boolean" | "enum" | "string";
  unit: string;
  default: string | number | boolean;
  minimum?: number | null;
  maximum?: number | null;
  allowedValues?: (string | number | boolean)[];
  exposed: boolean;
  source: "user" | "formula" | "material" | "lookup";
  sourceDefinition?: ParameterSource | null;
  scope?: "template" | "partInstance" | "component" | "product" | "projectZone";
  declaredInRuleStage?: boolean;
  contractReady?: boolean;
  description?: string;
};
export type VariantDefinition = {
  id: string;
  name: string;
  kind?: string;
  overrides: Record<string, string | number | boolean>;
  expected: "valid" | "invalid";
  requiredForAdmission?: boolean;
  purpose?: string;
};
export type MaterialRequirement = {
  id: string;
  selectionMode: "category" | "family" | "specificRecord";
  supplyForm: string;
  familyTags: string[];
  allowedGrades: string[];
  standards: string[];
  surfaces: string[];
  thickness: {
    parameterId?: string | null;
    allowedValues: number[];
    minimum?: number | null;
    maximum?: number | null;
  };
  requiredProperties: Record<string, string | number | boolean>;
  allowInstanceSubstitution: boolean;
  specificBindingId?: string | null;
  reviewed: boolean;
};
export type MaterialValidationSample = {
  id: string;
  role: "minimum" | "nominal" | "maximum" | "special";
  name: string;
  bindingId: string;
  bindingMode: "reference" | "copy";
  materialCode: string;
  materialName: string;
  materialThickness?: number | null;
  variantId: string;
  requiredForAdmission: boolean;
  reviewed: boolean;
};
export type SketchPoint = { x: number; y: number };
export type SketchPrimitive = {
  id: string;
  role: string;
  type: "point" | "line" | "arc" | "circle";
  construction: boolean;
  start?: SketchPoint;
  end?: SketchPoint;
  center?: SketchPoint;
  radius?: number;
  startAngle?: number | null;
  endAngle?: number | null;
  largeArc?: boolean | null;
  sweepDirection?: SweepDirection;
  points?: SketchPoint[];
};
export type SketchSolveCase = {
  case: "minimum" | "nominal" | "maximum";
  values: Record<string, number>;
  degreesOfFreedom: number;
  primitives: SketchPrimitive[];
  segments: SketchPrimitive[];
  regions: {
    id: string;
    operation: "add" | "subtract";
    boundaryRefs: string[];
    closed: boolean;
    area: number;
  }[];
  bounds: {
    minimumX: number;
    maximumX: number;
    minimumY: number;
    maximumY: number;
  };
  topologySignature: string;
  valid: boolean;
  diagnostics: {
    severity: "warning" | "error";
    code: string;
    path: string;
    message: string;
  }[];
};
export type SketchSolveResult = {
  solver: string;
  profileKind: string;
  degreesOfFreedom: number;
  fullyConstrained: boolean;
  valid: boolean;
  underConstrainedEntities: string[];
  redundantConstraints: string[];
  missingRoles: string[];
  missingConstraintTypes: string[];
  topologyDiagnostics: {
    severity: "warning" | "error";
    code: string;
    path: string;
    message: string;
  }[];
  diagnostics: {
    severity: "warning" | "error";
    code: string;
    path: string;
    message: string;
  }[];
  cases: SketchSolveCase[];
};

export type SweepPathStatus =
  | "empty"
  | "editing"
  | "valid"
  | "invalid"
  | "confirmed";

/** Directed orientation of a circular sweep-path arc. */
export type SweepDirection = "ccw" | "cw";

export type SweepPathWindowState =
  | "pathWindowClosed"
  | "pathWindowOpen"
  | "pathEditing"
  | "pathValid"
  | "pathInvalid"
  | "pathConfirmed"
  | "pathGenerating"
  | "pathGenerationFailed"
  | "pathGenerationSucceeded";

export type SweepPathGeometry = {
  id: string;
  role: string;
  geometryType: "point" | "line" | "arc" | "circle";
  parameterRefs: string[];
  construction: boolean;
  start?: [number, number] | null;
  end?: [number, number] | null;
  center?: [number, number] | null;
  radius?: number | null;
  startAngle?: number | null;
  endAngle?: number | null;
  largeArc?: boolean | null;
  sweepDirection?: SweepDirection;
  points: [number, number][];
};

export type SweepPathConstraint = {
  id: string;
  label?: string;
  constraintType:
    | "coincident"
    | "horizontal"
    | "vertical"
    | "parallel"
    | "perpendicular"
    | "distance"
    | "distanceX"
    | "distanceY"
    | "radius"
    | "diameter"
    | "angle"
    | "fixed"
    | "tangent"
    | "concentric"
    | "symmetric"
    | "equal"
    | "pointOn"
    | "closed";
  entityRefs: string[];
  endpointRefs?: Array<"start" | "end">;
  expression?: string | null;
  parameterId?: string | null;
  value?: number | null;
  driverMode?: "unset" | "fixed" | "parameter" | "expression" | null;
  enabled: boolean;
  driving: boolean;
};

export type SweepPathSketch = {
  id: string;
  plane: "XY" | "XZ" | "YZ";
  geometry: SweepPathGeometry[];
  constraints: SweepPathConstraint[];
  startPointId: string | null;
  startEndpointRef?: { geometryId: string; endpoint: "start" | "end" } | null;
  status: SweepPathStatus;
  generationStatus?: "idle" | "generating" | "failed" | "succeeded";
  diagnostics: Diagnostic[];
};
export type GeometryRecipe = {
  id: string;
  constructionMode:
    | "extrude"
    | "revolve"
    | "sweep"
    | "loft"
    | "sheetMetal"
    | "coldRollForming"
    | "machinedStock"
    | "externalDerived"
    | "standardParametric";
  sketches: string[];
  paths: string[];
  operations: {
    id: string;
    operator: string;
    sourceRefs: string[];
    arguments: Record<string, string | number | boolean>;
    argumentExpressions: Record<string, string>;
    conditionExpression: string;
    semanticOutputs: string[];
    pathSketchId?: string | null;
    profileSketchId?: string | null;
    profileAnchor?: string;
    orientationMode?: "followPath" | "fixedWorld" | "minimumTwist";
    scaleMode?: "constant";
    twistMode?: "none";
    cornerMode?: "right";
  }[];
  semanticFaces: {
    id: string;
    label: string;
    hostFrame: "negativeY" | "positiveY" | "negativeX" | "positiveX" | "negativeZ" | "positiveZ";
    sourceOperationId: string;
    uStartExpression: string;
    uSpanExpression: string;
    vStartExpression: string;
    vSpanExpression: string;
  }[];
  reviewed: boolean;
};
export type FeatureRule = {
  id: string;
  name: string;
  featureType: "circularHole" | "straightSlot" | "rectangularCutout" | "polygonalCutout";
  enabled: boolean;
  conditionExpression: string;
  countExpression: string;
  indexVariable: string;
  arguments: Record<string, string | number | boolean>;
  argumentExpressions: Record<string, string>;
  faceBindings: { semanticFaceId: string }[];
  profileDimensions: { id: string; label: string; parameterId: string }[];
  placement: {
    mode: "single" | "linearArray" | "equalSpan" | "maxPitch" | "symmetric";
    axis: "u" | "v";
    pitchExpression: string;
    startMarginExpression: string;
    endMarginExpression: string;
    maximumPitchExpression: string;
  };
  polygonVertices: { uExpression: string; vExpression: string }[];
  maximumCount: number;
  semanticGroup?: string | null;
  description: string;
};
export type PartInterface = {
  id: string;
  name: string;
  declarationMode: "staticGeometry" | "featureDerived";
  sourceFeatureRuleId?: string | null;
  interfaceType: "locating" | "connecting" | "supporting" | "adjustable" | "processDatum" | "other";
  locatingType?: "planeContact" | "axisCoincident" | "pinHole" | "edgeStop" | "slotAdjustable" | "keyedAntiError" | null;
  role?: "primary" | "secondary" | "tertiary" | null;
  geometryRefs: string[];
  referenceFrame: { originRef?: string | null; axis: "x" | "y" | "z" | "-x" | "-y" | "-z" };
  parameterRefs: string[];
  compatibilityTags: string[];
  description: string;
  required: boolean;
  reviewed: boolean;
};
export type EvaluationDiagnostic = {
  severity: "warning" | "error";
  code: string;
  path: string;
  message: string;
};
export type ResolvedFeature = {
  id: string;
  featureType: "circularHole" | "straightSlot" | "rectangularCutout" | "polygonalCutout";
  arguments: Record<string, string | number | boolean>;
  semanticFaceId: string;
  hostFace: "negativeY" | "positiveY" | "negativeX" | "positiveX" | "negativeZ" | "positiveZ";
  polygonVertices: [number, number][];
  sourceRuleId: string;
  index: number;
};
export type ResolvedInterface = {
  id: string;
  sourceInterfaceId: string;
  declarationMode: "staticGeometry" | "featureDerived";
  interfaceType: PartInterface["interfaceType"];
  geometryRefs: string[];
  parameterRefs: string[];
  sourceFeatureRuleId?: string | null;
  sourceFeatureId?: string | null;
};
export type TemplateEvaluation = {
  values: Record<string, string | number | boolean>;
  evaluationOrder: string[];
  features: ResolvedFeature[];
  resolvedInterfaces: ResolvedInterface[];
  diagnostics: EvaluationDiagnostic[];
};
export type EvaluationRequest = {
  overrides: Record<string, string | number | boolean>;
  material?: Record<string, unknown>;
  product?: Record<string, unknown>;
  component?: Record<string, unknown>;
  projectZone?: Record<string, unknown>;
};

export type Draft = {
  schemaVersion: "3.0";
  templateKind: "monolithicPart";
  id?: string;
  code: string;
  name: string;
  description: string;
  designIntent: string;
  tags: string[];
  owner: string;
  organization: string;
  manufacturingClassification: ManufacturingClassification;
  geometryPrototypeId: string;
  unitSystem: "mm-kg-s";
  coordinateSystem: "right-handed-z-up";
  lifecycleStatus: "draft" | "review" | "published";
  stageStatus: StageStatus;
  attachments: SourceAttachment[];
  materialRequirements: MaterialRequirement[];
  materialValidationSamples: MaterialValidationSample[];
  blank: {
    form:
      | "strip"
      | "flatBlank"
      | "profileSegment"
      | "tubeSegment"
      | "barSegment"
      | "wireBlank"
      | "castBlank"
      | "externalModel"
      | "standardPart";
    preparationMode: "sameAsSupply" | "preparedBlank";
    preparationProcesses: (
      | "uncoiling"
      | "leveling"
      | "slitting"
      | "cutToLength"
      | "sawing"
      | "blanking"
      | "preforming"
      | "none"
    )[];
    manufacturingRoute:
      | "coldRollForming"
      | "laserCutting"
      | "machining"
      | "extrusion"
      | "bending"
      | "casting"
      | "purchased";
    lengthExpression: string;
    widthExpression: string;
    thicknessExpression: string;
    lengthAllowance: number;
    widthAllowance: number;
    grainDirection: "longitudinal" | "transverse" | "notApplicable";
  };
  sketch: {
    model: "semanticProfile";
    acquisitionMethod: "manual" | "imported" | "reused";
    plane: "XY" | "XZ" | "YZ";
    profileMode: "closedRegion" | "multiRegion" | "centerlineThinWall";
    drivingParameters: string[];
    entities: {
      id: string;
      role: string;
      geometryType: "point" | "line" | "arc" | "circle";
      parameterRefs: string[];
      construction: boolean;
      start?: [number, number] | null;
      end?: [number, number] | null;
      center?: [number, number] | null;
      radius?: number | null;
      startAngle?: number | null;
      endAngle?: number | null;
      largeArc?: boolean | null;
      sweepDirection?: SweepDirection;
      points: [number, number][];
    }[];
    constraints: {
      id: string;
      label?: string;
      constraintType:
        | "coincident"
        | "horizontal"
        | "vertical"
        | "parallel"
        | "perpendicular"
        | "tangent"
        | "concentric"
        | "symmetric"
        | "equal"
        | "distance"
        | "distanceX"
        | "distanceY"
        | "radius"
        | "diameter"
        | "angle"
        | "fixed"
        | "pointOn"
        | "closed";
        entityRefs: string[];
      /** Coincident: which endpoint of each entityRefs item ("start" | "end"). */
      endpointRefs?: Array<"start" | "end">;
      expression?: string | null;
      parameterId?: string | null;
      value?: number | null;
      driverMode?: "unset" | "fixed" | "parameter" | "expression" | null;
      enabled: boolean;
      driving: boolean;
    }[];
    regions: {
      id: string;
      boundaryRefs: string[];
      closed: boolean;
      role: string;
      operation: "add" | "subtract";
    }[];
    constraintsReviewed: boolean;
    sourceAttachmentId?: string | null;
    sourceProfileId?: string | null;
    sourceHash?: string | null;
    importUnit?: "mm" | "cm" | "m" | "inch" | null;
    importScale?: number | null;
    conversionReviewed: boolean;
  };
  /** 独立于截面草图的扫掠路径草图；未使用时为空。 */
  sweepPath?: SweepPathSketch | null;
  parameterDefinitions: ParameterDefinition[];
  variants: VariantDefinition[];
  geometryRecipe: GeometryRecipe;
  featureRules: FeatureRule[];
  featureRulesReviewed: boolean;
  interfaces: PartInterface[];
  evidence: unknown[];
  aiProposals: unknown[];
  admission: {
    changeNote: string;
    reviewer: string;
    releaseChannel: "development" | "pilot" | "production";
  };
  revision: number;
  createdAt?: string;
  updatedAt?: string;
};

export type StageCheck = {
  id: string;
  label: string;
  passed: boolean;
  severity: "error" | "warning";
  path: string;
  message: string;
};
export type StageValidation = {
  stage: StageName;
  complete: boolean;
  progress: number;
  checks: StageCheck[];
};
export type StageActionResult = { draft: Draft; validation: StageValidation };
export type RevisionEntry = {
  revision: number;
  createdAt: string;
  reason: string;
  draft: Draft;
};
export type Diagnostic = {
  severity: "info" | "warning" | "error";
  code: string;
  path: string;
  message: string;
  suggestion?: string;
  geometryIds?: string[];
};
export type Artifact = {
  kind: "step" | "stl" | "plan" | "diagnostics" | "semanticMap";
  url: string;
  sha256: string;
};
export type CompileResult = {
  success: boolean;
  inputHash: string;
  diagnostics: Diagnostic[];
  metrics?: {
    valid: boolean;
    volume: number;
    solidCount: number;
    operationCount: number;
  };
  artifacts: Artifact[];
};
export type PublishedVersion = {
  id: string;
  templateId: string;
  version: number;
  sourceRevision: number;
  code: string;
  name: string;
  createdAt: string;
  sourcePackageUrl: string;
  compileResult: CompileResult;
};
export type PublishResult = {
  draft: Draft;
  version: PublishedVersion;
  validation: StageValidation;
};
