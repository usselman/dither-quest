import { processorRegistry } from "./processors";
import { normalizePipeline } from "./pipeline";
import type { PipelineStage, Preset } from "./types";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Accept named presets and legacy pipeline exports; validate before normalization. */
export function decodePreset(value: unknown, fallbackName = "Imported stack"): Preset {
  if (!record(value)) throw new Error("Invalid preset.");
  const stages = value.stages ?? value.pipeline;
  if (!Array.isArray(stages) || stages.length > 64) throw new Error("Invalid stage list.");
  for (const stage of stages) {
    if (!record(stage) || typeof stage.type !== "string" ||
        !Object.hasOwn(processorRegistry, stage.type) || !record(stage.params))
      throw new Error("Invalid processor.");
    const definition = processorRegistry[stage.type as PipelineStage["type"]];
    for (const [key, param] of Object.entries(stage.params)) {
      const meta = definition.params[key];
      if (!meta) continue;
      if ((meta.type === "number" && (typeof param !== "number" || !Number.isFinite(param))) ||
          (meta.type === "boolean" && typeof param !== "boolean") ||
          (meta.type === "palette" && (!Array.isArray(param) || !param.every((color) => typeof color === "string" && /^#[\da-f]{6}$/i.test(color)))) ||
          (meta.type === "color" && (typeof param !== "string" || !/^#[\da-f]{6}$/i.test(param))) ||
          (meta.type === "text" && typeof param !== "string") ||
          (meta.type === "select" && !meta.options?.some((option) => option.value === param)))
        throw new Error("Invalid parameter.");
    }
  }
  return {
    id: crypto.randomUUID(),
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : fallbackName,
    description: typeof value.description === "string" ? value.description : "Imported local stack.",
    category: "User",
    stages: normalizePipeline(stages as PipelineStage[]),
  };
}
