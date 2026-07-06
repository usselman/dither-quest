import { clampInt } from "./rng";

export function cloneImage(image: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
  );
}

export function resizeImageData(image: ImageData, maxEdge: number): ImageData {
  if (Math.max(image.width, image.height) <= maxEdge) return cloneImage(image);
  const scale = maxEdge / Math.max(image.width, image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return cloneImage(image);
  const source = new OffscreenCanvas(image.width, image.height);
  source.getContext("2d")?.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function imageDataToCanvas(image: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")?.putImageData(image, 0, 0);
  return canvas;
}

export async function fileToImageData(file: File): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function imageDataToBlob(
  image: ImageData,
  type: string,
  quality?: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext("2d")?.putImageData(image, 0, 0);
  return canvas.convertToBlob({ type, quality });
}

export function sample(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  edge = "clamp",
): [number, number, number, number] {
  let sx = Math.round(x);
  let sy = Math.round(y);
  if (edge === "wrap") {
    sx = ((sx % width) + width) % width;
    sy = ((sy % height) + height) % height;
  } else if (edge === "mirror") {
    sx = Math.abs((((sx % (width * 2)) + width * 2) % (width * 2)) - width);
    sy = Math.abs((((sy % (height * 2)) + height * 2) % (height * 2)) - height);
    sx = Math.min(width - 1, sx);
    sy = Math.min(height - 1, sy);
  } else if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
    if (edge === "transparent") return [0, 0, 0, 0];
    sx = Math.min(width - 1, Math.max(0, sx));
    sy = Math.min(height - 1, Math.max(0, sy));
  }
  const i = (sy * width + sx) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

export function writePixel(
  data: Uint8ClampedArray,
  idx: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  data[idx] = clampInt(r);
  data[idx + 1] = clampInt(g);
  data[idx + 2] = clampInt(b);
  data[idx + 3] = clampInt(a);
}
