import { resizeImageData } from "../core/image";
import { runPipeline } from "../core/pipeline";
import type { RenderRequest, RenderResponse } from "../core/types";

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const started = performance.now();
  const request = event.data;
  const source =
    request.mode === "preview"
      ? resizeImageData(request.source, request.maxPreviewEdge)
      : request.source;
  const original =
    request.original && request.mode === "preview"
      ? resizeImageData(request.original, request.maxPreviewEdge)
      : request.original;
  const image = runPipeline(
    source,
    request.pipeline,
    original,
    request.mode,
    request.revision,
  );
  const response: RenderResponse = {
    requestId: request.requestId,
    revision: request.revision,
    image,
    renderMs: performance.now() - started,
  };
  self.postMessage(response, [response.image.data.buffer]);
};
