import {
  processorRegistry,
  runPipeline,
  normalizePipeline,
} from "./processors";
import { randRange, mulberry32 } from "./rng";
import type { PipelineStage } from "./types";

export function cacheKeyFor(stages: PipelineStage[]): string {
  return JSON.stringify(
    normalizePipeline(stages).map((s) => [s.type, s.enabled, s.seed, s.params]),
  );
}

export function randomizeUnlocked(
  stages: PipelineStage[],
  seed: number,
  mutation = 1,
): PipelineStage[] {
  const rng = mulberry32(seed);
  return stages.map((stage) => {
    if (stage.locked) return stage;
    const def = processorRegistry[stage.type];
    const params = { ...stage.params };
    for (const [key, meta] of Object.entries(def.params)) {
      if (
        stage.locks?.[key] ||
        !meta.randomize ||
        typeof meta.default !== "number"
      )
        continue;
      const current = Number(params[key] ?? meta.default);
      const [min, max] = meta.randomize;
      const target = randRange(rng, min, max);
      params[key] = current + (target - current) * mutation;
    }
    return { ...stage, seed: stage.seed, params };
  });
}

export function validatePresetStages(stages: PipelineStage[]): boolean {
  return normalizePipeline(stages).every(
    (stage) =>
      Boolean(processorRegistry[stage.type]) &&
      Object.values(stage.params).every(
        (value) =>
          value === null || typeof value !== "number" || Number.isFinite(value),
      ),
  );
}

export { runPipeline, normalizePipeline };
