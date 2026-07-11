import { resizeImageData } from "../core/image";
import { normalizePipeline } from "../core/pipeline";
import { processorRegistry } from "../core/processors";
import { cloneImage } from "../core/image";
import type { RenderRequest, RenderResponse } from "../core/types";

const MAX_CACHE_BYTES = 96 * 1024 * 1024;
const cache = new Map<string, { image: ImageData; bytes: number }>();
let cacheBytes = 0;

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${stableValue(v)}`).join(",")}}`;
  return String(value);
}

function remember(key: string, image: ImageData): void {
  const copy = cloneImage(image);
  const bytes = copy.data.byteLength;
  cache.set(key, { image: copy, bytes });
  cacheBytes += bytes;
  while (cacheBytes > MAX_CACHE_BYTES && cache.size > 1) {
    const oldest = cache.entries().next().value as [string, { image: ImageData; bytes: number }] | undefined;
    if (!oldest) break;
    cache.delete(oldest[0]);
    cacheBytes -= oldest[1].bytes;
  }
}

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const started = performance.now();
  const request = event.data;
  const resizeStarted = performance.now();
  const source =
    request.mode === "preview"
      ? resizeImageData(request.source, request.maxPreviewEdge)
      : request.source;
  const original =
    request.original && request.mode === "preview"
      ? resizeImageData(request.original, request.maxPreviewEdge)
      : request.original;
  const resizeMs = performance.now() - resizeStarted;
  const pipelineStarted = performance.now();
  const stages = normalizePipeline(request.pipeline);
  let image = cloneImage(source);
  let prefix = `${request.sourceId}:${source.width}x${source.height}:${request.quality}`;
  let cacheHits = 0;
  let cacheMisses = 0;
  const stageMetrics: RenderResponse["metrics"]["stages"] = [];
  stages.forEach((stage, index) => {
    if (!stage.enabled) return;
    prefix += `|${stage.type}:${stage.seed}:${stableValue(stage.params)}`;
    const cached = cache.get(prefix);
    if (cached) {
      image = cloneImage(cached.image);
      cache.delete(prefix);
      cache.set(prefix, cached);
      cacheHits++;
      stageMetrics.push({ index, type: stage.type, ms: 0, cached: true });
      return;
    }
    const stageStarted = performance.now();
    const processor = processorRegistry[stage.type];
    if (processor) image = processor.process(image, stage, { original, mode: request.mode, revision: request.revision });
    stageMetrics.push({ index, type: stage.type, ms: performance.now() - stageStarted, cached: false });
    cacheMisses++;
    remember(prefix, image);
  });
  const pipelineMs = performance.now() - pipelineStarted;
  const totalMs = performance.now() - started;
  const response: RenderResponse = {
    requestId: request.requestId,
    revision: request.revision,
    image,
    renderMs: totalMs,
    quality: request.quality,
    metrics: { totalMs, resizeMs, pipelineMs, stages: stageMetrics, cacheHits, cacheMisses, cacheBytes },
  };
  self.postMessage(response, [response.image.data.buffer]);
};
