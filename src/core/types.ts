export type ProcessorType =
  | "tone"
  | "dither"
  | "pixelate"
  | "halftone"
  | "displace"
  | "noise"
  | "geometry"
  | "blendOriginal";

export type ParamType =
  "number" | "boolean" | "color" | "select" | "palette" | "text";
export type PresetCategory =
  | "Traditional"
  | "Historical"
  | "Halftone"
  | "Pixel"
  | "Print"
  | "Glitch"
  | "Entropic"
  | "User";
export type EdgeMode = "clamp" | "wrap" | "mirror" | "transparent";

export interface Modulation {
  enabled: boolean;
  source:
    | "luminance"
    | "red"
    | "green"
    | "blue"
    | "x"
    | "y"
    | "radial"
    | "angle"
    | "random"
    | "noise"
    | "checker"
    | "stripe";
  amount: number;
  frequency: number;
  phase: number;
  offset: number;
  invert: boolean;
  seed: number;
  clamp: boolean;
}

export interface ParamMeta<T = unknown> {
  label: string;
  description: string;
  type: ParamType;
  default: T;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string | number | boolean }>;
  randomize?: [number, number];
  mutationStrength?: number;
  advanced?: string;
}

export type StageParams = Record<string, unknown>;

export interface PipelineStage<T extends StageParams = StageParams> {
  id: string;
  type: ProcessorType;
  enabled: boolean;
  locked: boolean;
  seed: number;
  params: T;
  locks?: Record<string, boolean>;
  modulation?: Record<string, Modulation>;
}

export interface ProcessorDefinition<T extends StageParams = StageParams> {
  type: ProcessorType;
  name: string;
  description: string;
  params: Record<keyof T & string, ParamMeta>;
  process: (
    image: ImageData,
    stage: PipelineStage<T>,
    ctx: ProcessContext,
  ) => ImageData;
}

export interface ProcessContext {
  original?: ImageData;
  mode: "preview" | "full";
  revision: number;
}

export interface Preset {
  id: string;
  name: string;
  category: PresetCategory;
  description: string;
  stages: PipelineStage[];
}

export interface RenderRequest {
  requestId: string;
  revision: number;
  source: ImageData;
  original?: ImageData;
  pipeline: PipelineStage[];
  mode: "preview" | "full";
  maxPreviewEdge: number;
}

export interface RenderResponse {
  requestId: string;
  revision: number;
  image: ImageData;
  renderMs: number;
}
