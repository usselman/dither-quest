import { luminance, nearestColor, parsePalette } from "./color";
import { clamp, clampInt, mulberry32 } from "./rng";

const matrices: Record<number, number[]> = {
  2: [0, 2, 3, 1],
  4: [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5],
  8: [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36,
    14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55,
    23, 61, 29, 53, 21,
  ],
};

export function bayerThreshold(x: number, y: number, size: 2 | 4 | 8): number {
  const matrix = matrices[size];
  return ((matrix[(y % size) * size + (x % size)] + 0.5) / (size * size)) * 255;
}

export const diffusionKernels = {
  floydSteinberg: [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ],
  atkinson: [
    [1, 0, 1 / 8],
    [2, 0, 1 / 8],
    [-1, 1, 1 / 8],
    [0, 1, 1 / 8],
    [1, 1, 1 / 8],
    [0, 2, 1 / 8],
  ],
  jarvis: [
    [1, 0, 7 / 48],
    [2, 0, 5 / 48],
    [-2, 1, 3 / 48],
    [-1, 1, 5 / 48],
    [0, 1, 7 / 48],
    [1, 1, 5 / 48],
    [2, 1, 3 / 48],
    [-2, 2, 1 / 48],
    [-1, 2, 3 / 48],
    [0, 2, 5 / 48],
    [1, 2, 3 / 48],
    [2, 2, 1 / 48],
  ],
  stucki: [
    [1, 0, 8 / 42],
    [2, 0, 4 / 42],
    [-2, 1, 2 / 42],
    [-1, 1, 4 / 42],
    [0, 1, 8 / 42],
    [1, 1, 4 / 42],
    [2, 1, 2 / 42],
    [-2, 2, 1 / 42],
    [-1, 2, 2 / 42],
    [0, 2, 4 / 42],
    [1, 2, 2 / 42],
    [2, 2, 1 / 42],
  ],
  sierraLite: [
    [1, 0, 2 / 4],
    [-1, 1, 1 / 4],
    [0, 1, 1 / 4],
  ],
} as const;

export type DitherAlgorithm =
  "threshold" | "random" | "bayer" | keyof typeof diffusionKernels;

export interface DitherParams {
  algorithm: DitherAlgorithm;
  threshold: number;
  matrixSize: 2 | 4 | 8;
  palette: string[];
  invert: boolean;
  serpentine: boolean;
  strength: number;
  luminanceMode: "rec601" | "rec709" | "average";
  alphaPreserve: boolean;
}

export function applyDither(
  image: ImageData,
  params: DitherParams,
  seed = 1,
): ImageData {
  const out = new ImageData(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
  );
  const palette = parsePalette(params.palette);
  const rng = mulberry32(seed);
  const data = out.data;
  if (params.algorithm in diffusionKernels) {
    const float = Float32Array.from(data);
    const kernel =
      diffusionKernels[params.algorithm as keyof typeof diffusionKernels];
    for (let y = 0; y < out.height; y++) {
      const reverse = params.serpentine && y % 2 === 1;
      for (let sx = 0; sx < out.width; sx++) {
        const x = reverse ? out.width - 1 - sx : sx;
        const idx = (y * out.width + x) * 4;
        const old = [float[idx], float[idx + 1], float[idx + 2]];
        const next = nearestColor(old[0], old[1], old[2], palette);
        data[idx] = params.invert ? 255 - next[0] : next[0];
        data[idx + 1] = params.invert ? 255 - next[1] : next[1];
        data[idx + 2] = params.invert ? 255 - next[2] : next[2];
        if (!params.alphaPreserve) data[idx + 3] = next[3];
        const err = [old[0] - next[0], old[1] - next[1], old[2] - next[2]];
        for (const [kxRaw, ky, amount] of kernel) {
          const kx = reverse ? -kxRaw : kxRaw;
          const nx = x + kx;
          const ny = y + ky;
          if (nx < 0 || ny < 0 || nx >= out.width || ny >= out.height) continue;
          const ni = (ny * out.width + nx) * 4;
          for (let c = 0; c < 3; c++)
            float[ni + c] = clamp(
              float[ni + c] + err[c] * amount * params.strength,
            );
        }
      }
    }
    return out;
  }
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const idx = (y * out.width + x) * 4;
      let threshold = params.threshold;
      if (params.algorithm === "random") threshold = rng() * 255;
      if (params.algorithm === "bayer")
        threshold = bayerThreshold(x, y, params.matrixSize);
      const lum = luminance(
        data[idx],
        data[idx + 1],
        data[idx + 2],
        params.luminanceMode,
      );
      const color =
        palette[
          (params.invert ? lum < threshold : lum >= threshold)
            ? palette.length - 1
            : 0
        ] ?? palette[0];
      data[idx] = clampInt(color[0]);
      data[idx + 1] = clampInt(color[1]);
      data[idx + 2] = clampInt(color[2]);
      if (!params.alphaPreserve) data[idx + 3] = clampInt(color[3]);
    }
  }
  return out;
}
