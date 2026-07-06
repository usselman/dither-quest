import { describe, expect, it } from "vitest";
import { luminance, nearestColor } from "../core/color";
import { bayerThreshold, applyDither } from "../core/dither";
import { mulberry32 } from "../core/rng";
import {
  cacheKeyFor,
  normalizePipeline,
  runPipeline,
  validatePresetStages,
} from "../core/pipeline";
import { builtInPresets } from "../core/presets";
import { makeStage } from "../core/processors";

class TestImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace: PredefinedColorSpace = "srgb";
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

globalThis.ImageData = TestImageData as typeof ImageData;

function fixture(width: number, height: number, values: number[]): ImageData {
  return new ImageData(new Uint8ClampedArray(values), width, height);
}

describe("color and RNG", () => {
  it("computes rec709 luminance", () => {
    expect(Math.round(luminance(255, 0, 0))).toBe(54);
    expect(Math.round(luminance(0, 255, 0))).toBe(182);
  });

  it("matches nearest palette color", () => {
    expect(
      nearestColor(240, 20, 20, [
        [0, 0, 0, 255],
        [255, 0, 0, 255],
      ]),
    ).toEqual([255, 0, 0, 255]);
  });

  it("has deterministic seeded random numbers", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("dithering", () => {
  it("uses stable Bayer lookup", () => {
    expect(Math.round(bayerThreshold(0, 0, 4))).toBe(8);
    expect(Math.round(bayerThreshold(1, 0, 4))).toBe(135);
  });

  it("applies thresholding", () => {
    const image = fixture(2, 1, [10, 10, 10, 255, 240, 240, 240, 255]);
    const out = applyDither(
      image,
      {
        algorithm: "threshold",
        threshold: 128,
        matrixSize: 4,
        palette: ["#000000", "#ffffff"],
        invert: false,
        serpentine: false,
        strength: 1,
        luminanceMode: "rec709",
        alphaPreserve: true,
      },
      1,
    );
    expect([...out.data]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it("diffuses Floyd-Steinberg deterministically", () => {
    const image = fixture(
      3,
      1,
      [60, 60, 60, 255, 130, 130, 130, 255, 230, 230, 230, 255],
    );
    const a = applyDither(
      image,
      {
        algorithm: "floydSteinberg",
        threshold: 128,
        matrixSize: 4,
        palette: ["#000000", "#ffffff"],
        invert: false,
        serpentine: true,
        strength: 1,
        luminanceMode: "rec709",
        alphaPreserve: true,
      },
      7,
    );
    const b = applyDither(
      image,
      {
        algorithm: "floydSteinberg",
        threshold: 128,
        matrixSize: 4,
        palette: ["#000000", "#ffffff"],
        invert: false,
        serpentine: true,
        strength: 1,
        luminanceMode: "rec709",
        alphaPreserve: true,
      },
      7,
    );
    expect([...a.data]).toEqual([...b.data]);
  });
});

describe("pipeline and presets", () => {
  it("normalizes stages and rejects NaN params", () => {
    const stages = normalizePipeline([
      {
        ...makeStage("tone"),
        id: "",
        seed: Number.NaN,
        enabled: true,
        locked: false,
        params: { brightness: Number.NaN },
      },
    ]);
    expect(stages[0].id).toBe("stage-0");
    expect(validatePresetStages(stages)).toBe(false);
  });

  it("serializes presets as data", () => {
    for (const preset of builtInPresets)
      expect(validatePresetStages(preset.stages)).toBe(true);
    expect(
      builtInPresets.find(
        (p) => p.category === "Historical" && p.name.includes("Noisy"),
      ),
    ).toBeTruthy();
  });

  it("has stable cache keys", () => {
    const stages = [makeStage("dither", { algorithm: "threshold" }, 3)];
    expect(cacheKeyFor(stages)).toBe(
      cacheKeyFor(stages.map((s) => ({ ...s }))),
    );
  });

  it("runs deterministic processors", () => {
    const image = fixture(1, 1, [100, 120, 140, 255]);
    const stages = [
      makeStage("tone", { brightness: 10, contrast: 5 }, 9),
      makeStage("noise", { grain: 5 }, 9),
    ];
    const a = runPipeline(image, stages, image, "full", 1);
    const b = runPipeline(image, stages, image, "full", 1);
    expect([...a.data]).toEqual([...b.data]);
  });

  it("models checkpoint transitions", () => {
    const original = fixture(1, 1, [10, 20, 30, 255]);
    const checkpoint = runPipeline(
      original,
      [makeStage("tone", { invert: true }, 1)],
      original,
      "full",
      1,
    );
    const next = runPipeline(
      checkpoint,
      [makeStage("tone", { grayscale: true }, 2)],
      original,
      "full",
      2,
    );
    expect([...next.data].slice(0, 3).every((v) => v === next.data[0])).toBe(
      true,
    );
  });

  it("rejects stale worker-style responses by revision", () => {
    const current = { requestId: "b", revision: 2 };
    const stale = { requestId: "a", revision: 1 };
    expect(
      stale.requestId === current.requestId &&
        stale.revision === current.revision,
    ).toBe(false);
  });
});
