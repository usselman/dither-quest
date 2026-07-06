import { clamp, clampInt } from "./rng";

export type Rgba = [number, number, number, number];

export function luminance(
  r: number,
  g: number,
  b: number,
  mode: "rec601" | "rec709" | "average" = "rec709",
): number {
  if (mode === "average") return (r + g + b) / 3;
  if (mode === "rec601") return 0.299 * r + 0.587 * g + 0.114 * b;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hexToRgba(hex: string, alpha = 255): Rgba {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized.padEnd(6, "0").slice(0, 6);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    alpha,
  ];
}

export function rgbaToHex([r, g, b]: Rgba): string {
  return `#${[r, g, b].map((v) => clampInt(v).toString(16).padStart(2, "0")).join("")}`;
}

export function nearestColor(
  r: number,
  g: number,
  b: number,
  palette: Rgba[],
): Rgba {
  let best = palette[0] ?? [0, 0, 0, 255];
  let bestDist = Infinity;
  for (const color of palette) {
    const dr = r - color[0];
    const dg = g - color[1];
    const db = b - color[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = color;
    }
  }
  return best;
}

export function parsePalette(value: unknown): Rgba[] {
  if (!Array.isArray(value))
    return [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ];
  return value.slice(0, 32).map((entry) => {
    if (typeof entry === "string") return hexToRgba(entry);
    if (Array.isArray(entry))
      return [
        clamp(entry[0]),
        clamp(entry[1]),
        clamp(entry[2]),
        clamp(entry[3] ?? 255),
      ] as Rgba;
    return [0, 0, 0, 255] as Rgba;
  });
}

export function extractPalette(image: ImageData, count = 6): string[] {
  const buckets = new Map<
    string,
    { r: number; g: number; b: number; n: number }
  >();
  for (let i = 0; i < image.data.length; i += 16) {
    const key = `${image.data[i] >> 5}-${image.data[i + 1] >> 5}-${image.data[i + 2] >> 5}`;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += image.data[i];
    bucket.g += image.data[i + 1];
    bucket.b += image.data[i + 2];
    bucket.n++;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((b) => rgbaToHex([b.r / b.n, b.g / b.n, b.b / b.n, 255]));
}
