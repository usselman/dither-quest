import { applyDither, type DitherParams } from "./dither";
import { cloneImage, sample, writePixel } from "./image";
import { clamp, clampInt, mulberry32, randRange } from "./rng";
import { hexToRgba, luminance } from "./color";
import type { ProcessorType } from "./types";
import type { PipelineStage, ProcessorDefinition, StageParams } from "./types";

const num = (v: unknown, d: number, min = -Infinity, max = Infinity) =>
  clamp(Number(v ?? d), min, max);
const bool = (v: unknown, d = false) => (typeof v === "boolean" ? v : d);
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);

interface ToneParams extends StageParams {
  brightness: number;
  contrast: number;
  exposure: number;
  gamma: number;
  blackPoint: number;
  whitePoint: number;
  posterize: number;
  grayscale: boolean;
  invert: boolean;
  saturation: number;
  hue: number;
  redGain: number;
  greenGain: number;
  blueGain: number;
  redOffset: number;
  greenOffset: number;
  blueOffset: number;
  channelSwap: string;
}

function hueRotate(
  r: number,
  g: number,
  b: number,
  deg: number,
): [number, number, number] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a),
    sin = Math.sin(a);
  return [
    (0.213 + cos * 0.787 - sin * 0.213) * r +
      (0.715 - cos * 0.715 - sin * 0.715) * g +
      (0.072 - cos * 0.072 + sin * 0.928) * b,
    (0.213 - cos * 0.213 + sin * 0.143) * r +
      (0.715 + cos * 0.285 + sin * 0.14) * g +
      (0.072 - cos * 0.072 - sin * 0.283) * b,
    (0.213 - cos * 0.213 - sin * 0.787) * r +
      (0.715 - cos * 0.715 + sin * 0.715) * g +
      (0.072 + cos * 0.928 + sin * 0.072) * b,
  ];
}

const tone: ProcessorDefinition<ToneParams> = {
  type: "tone",
  name: "Tone and Color",
  description:
    "Brightness, contrast, gamma, posterization, grayscale, invert, saturation, hue, RGB gain/offset, and channel swap.",
  params: {
    brightness: {
      label: "Brightness",
      description: "Linear channel offset.",
      type: "number",
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      randomize: [-24, 24],
    },
    contrast: {
      label: "Contrast",
      description: "Contrast around middle gray.",
      type: "number",
      default: 0,
      min: -100,
      max: 100,
      step: 1,
      randomize: [-35, 45],
    },
    exposure: {
      label: "Exposure",
      description: "Multiplicative exposure stops.",
      type: "number",
      default: 0,
      min: -3,
      max: 3,
      step: 0.05,
      randomize: [-0.7, 0.7],
    },
    gamma: {
      label: "Gamma",
      description: "Gamma correction.",
      type: "number",
      default: 1,
      min: 0.1,
      max: 4,
      step: 0.05,
      randomize: [0.55, 1.8],
    },
    blackPoint: {
      label: "Black",
      description: "Input black point.",
      type: "number",
      default: 0,
      min: 0,
      max: 240,
      step: 1,
      advanced: "Levels",
    },
    whitePoint: {
      label: "White",
      description: "Input white point.",
      type: "number",
      default: 255,
      min: 15,
      max: 255,
      step: 1,
      advanced: "Levels",
    },
    posterize: {
      label: "Posterize",
      description: "Channel levels. 0 disables.",
      type: "number",
      default: 0,
      min: 0,
      max: 16,
      step: 1,
      randomize: [0, 8],
    },
    grayscale: {
      label: "Gray",
      description: "Convert to luminance.",
      type: "boolean",
      default: false,
    },
    invert: {
      label: "Invert",
      description: "Invert RGB channels.",
      type: "boolean",
      default: false,
    },
    saturation: {
      label: "Saturation",
      description: "Saturation amount.",
      type: "number",
      default: 1,
      min: 0,
      max: 3,
      step: 0.05,
      randomize: [0, 2.2],
    },
    hue: {
      label: "Hue",
      description: "Hue rotation degrees.",
      type: "number",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      randomize: [-45, 45],
    },
    redGain: {
      label: "R Gain",
      description: "Red gain.",
      type: "number",
      default: 1,
      min: 0,
      max: 4,
      step: 0.05,
      advanced: "RGB",
    },
    greenGain: {
      label: "G Gain",
      description: "Green gain.",
      type: "number",
      default: 1,
      min: 0,
      max: 4,
      step: 0.05,
      advanced: "RGB",
    },
    blueGain: {
      label: "B Gain",
      description: "Blue gain.",
      type: "number",
      default: 1,
      min: 0,
      max: 4,
      step: 0.05,
      advanced: "RGB",
    },
    redOffset: {
      label: "R Offset",
      description: "Red offset.",
      type: "number",
      default: 0,
      min: -255,
      max: 255,
      step: 1,
      advanced: "RGB",
    },
    greenOffset: {
      label: "G Offset",
      description: "Green offset.",
      type: "number",
      default: 0,
      min: -255,
      max: 255,
      step: 1,
      advanced: "RGB",
    },
    blueOffset: {
      label: "B Offset",
      description: "Blue offset.",
      type: "number",
      default: 0,
      min: -255,
      max: 255,
      step: 1,
      advanced: "RGB",
    },
    channelSwap: {
      label: "Swap",
      description: "Channel order.",
      type: "select",
      default: "rgb",
      options: ["rgb", "rbg", "grb", "gbr", "brg", "bgr"].map((v) => ({
        label: v.toUpperCase(),
        value: v,
      })),
    },
  },
  process(image, stage) {
    const p = stage.params;
    const out = cloneImage(image);
    const contrast =
      (259 * (num(p.contrast, 0) + 255)) / (255 * (259 - num(p.contrast, 0)));
    const exposure = 2 ** num(p.exposure, 0, -3, 3);
    const gamma = num(p.gamma, 1, 0.1, 4);
    const black = num(p.blackPoint, 0, 0, 254);
    const white = Math.max(black + 1, num(p.whitePoint, 255, 1, 255));
    for (let i = 0; i < out.data.length; i += 4) {
      let r = out.data[i],
        g = out.data[i + 1],
        b = out.data[i + 2];
      [r, g, b] = [r, g, b]
        .map(
          (v) =>
            ((v - black) / (white - black)) * 255 * exposure +
            num(p.brightness, 0),
        )
        .map((v) => contrast * (v - 128) + 128);
      r = 255 * (clamp(r) / 255) ** (1 / gamma);
      g = 255 * (clamp(g) / 255) ** (1 / gamma);
      b = 255 * (clamp(b) / 255) ** (1 / gamma);
      if (bool(p.grayscale)) r = g = b = luminance(r, g, b);
      const lum = luminance(r, g, b);
      const sat = num(p.saturation, 1, 0, 3);
      r = lum + (r - lum) * sat;
      g = lum + (g - lum) * sat;
      b = lum + (b - lum) * sat;
      [r, g, b] = hueRotate(r, g, b, num(p.hue, 0));
      const order = str(p.channelSwap, "rgb");
      const map: Record<string, number> = { r, g, b };
      r = map[order[0]];
      g = map[order[1]];
      b = map[order[2]];
      r = r * num(p.redGain, 1) + num(p.redOffset, 0);
      g = g * num(p.greenGain, 1) + num(p.greenOffset, 0);
      b = b * num(p.blueGain, 1) + num(p.blueOffset, 0);
      const levels = Math.round(num(p.posterize, 0, 0, 16));
      if (levels > 1)
        [r, g, b] = [r, g, b].map(
          (v) =>
            Math.round((clamp(v) / 255) * (levels - 1)) * (255 / (levels - 1)),
        );
      if (bool(p.invert)) [r, g, b] = [255 - r, 255 - g, 255 - b];
      writePixel(out.data, i, r, g, b, out.data[i + 3]);
    }
    return out;
  },
};

interface PixelParams extends StageParams {
  blockWidth: number;
  blockHeight: number;
  mode: string;
  scanlines: number;
  checker: boolean;
  gap: number;
  phaseX: number;
  phaseY: number;
  removeLines: string;
}
const pixelate: ProcessorDefinition<PixelParams> = {
  type: "pixelate",
  name: "Pixel and Grid",
  description:
    "Block average/min/max, mosaic, scanlines, checker masks, gaps, line removal, and phase.",
  params: {
    blockWidth: {
      label: "Block W",
      description: "Horizontal block size.",
      type: "number",
      default: 6,
      min: 1,
      max: 160,
      step: 1,
      randomize: [2, 28],
    },
    blockHeight: {
      label: "Block H",
      description: "Vertical block size.",
      type: "number",
      default: 6,
      min: 1,
      max: 160,
      step: 1,
      randomize: [2, 28],
    },
    mode: {
      label: "Mode",
      description: "Block sampling method.",
      type: "select",
      default: "average",
      options: ["average", "minimum", "maximum", "mosaic"].map((v) => ({
        label: v,
        value: v,
      })),
    },
    scanlines: {
      label: "Scanlines",
      description: "Darken alternating rows.",
      type: "number",
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      randomize: [0, 0.65],
    },
    checker: {
      label: "Checker",
      description: "Apply checker mask.",
      type: "boolean",
      default: false,
    },
    gap: {
      label: "Gap",
      description: "Cell gap in pixels.",
      type: "number",
      default: 0,
      min: 0,
      max: 20,
      step: 1,
      randomize: [0, 4],
    },
    phaseX: {
      label: "Phase X",
      description: "Grid horizontal phase.",
      type: "number",
      default: 0,
      min: -80,
      max: 80,
      step: 1,
    },
    phaseY: {
      label: "Phase Y",
      description: "Grid vertical phase.",
      type: "number",
      default: 0,
      min: -80,
      max: 80,
      step: 1,
    },
    removeLines: {
      label: "Remove",
      description: "Drop horizontal or vertical lines.",
      type: "select",
      default: "none",
      options: ["none", "horizontal", "vertical"].map((v) => ({
        label: v,
        value: v,
      })),
    },
  },
  process(image, stage) {
    const p = stage.params;
    const bw = Math.max(1, Math.round(num(p.blockWidth, 6, 1)));
    const bh = Math.max(1, Math.round(num(p.blockHeight, 6, 1)));
    const out = cloneImage(image);
    out.data.fill(0);
    for (let y = -num(p.phaseY, 0); y < image.height; y += bh)
      for (let x = -num(p.phaseX, 0); x < image.width; x += bw) {
        let r = 0,
          g = 0,
          b = 0,
          a = 0,
          n = 0;
        let min = 255,
          max = 0;
        for (let yy = Math.max(0, y); yy < Math.min(image.height, y + bh); yy++)
          for (
            let xx = Math.max(0, x);
            xx < Math.min(image.width, x + bw);
            xx++
          ) {
            const i = (yy * image.width + xx) * 4;
            const lum = luminance(
              image.data[i],
              image.data[i + 1],
              image.data[i + 2],
            );
            min = Math.min(min, lum);
            max = Math.max(max, lum);
            r += image.data[i];
            g += image.data[i + 1];
            b += image.data[i + 2];
            a += image.data[i + 3];
            n++;
          }
        if (!n) continue;
        r /= n;
        g /= n;
        b /= n;
        a /= n;
        if (p.mode === "minimum") r = g = b = min;
        if (p.mode === "maximum") r = g = b = max;
        if (p.mode === "mosaic") {
          const c = sample(
            image.data,
            image.width,
            image.height,
            x + bw / 2,
            y + bh / 2,
          );
          [r, g, b, a] = c;
        }
        for (
          let yy = Math.max(0, y);
          yy < Math.min(image.height, y + bh - num(p.gap, 0));
          yy++
        )
          for (
            let xx = Math.max(0, x);
            xx < Math.min(image.width, x + bw - num(p.gap, 0));
            xx++
          ) {
            const masked =
              bool(p.checker) &&
              (Math.floor(xx / bw) + Math.floor(yy / bh)) % 2 === 1;
            const remove =
              (p.removeLines === "horizontal" && yy % (bh * 2) < bh / 2) ||
              (p.removeLines === "vertical" && xx % (bw * 2) < bw / 2);
            const scan = yy % 2 === 1 ? 1 - num(p.scanlines, 0, 0, 1) : 1;
            const i = (yy * image.width + xx) * 4;
            writePixel(
              out.data,
              i,
              masked || remove ? 0 : r * scan,
              masked || remove ? 0 : g * scan,
              masked || remove ? 0 : b * scan,
              a,
            );
          }
      }
    return out;
  },
};

interface DitherStageParams extends StageParams, DitherParams {}
const dither: ProcessorDefinition<DitherStageParams> = {
  type: "dither",
  name: "Traditional Dither",
  description:
    "Threshold, random threshold, Bayer, Floyd-Steinberg, Atkinson, Jarvis-Judice-Ninke, Stucki, and Sierra Lite.",
  params: {
    algorithm: {
      label: "Algorithm",
      description: "Dithering method.",
      type: "select",
      default: "floydSteinberg",
      options: [
        "threshold",
        "random",
        "bayer",
        "floydSteinberg",
        "atkinson",
        "jarvis",
        "stucki",
        "sierraLite",
      ].map((v) => ({ label: v, value: v })),
    },
    threshold: {
      label: "Threshold",
      description: "Threshold level.",
      type: "number",
      default: 128,
      min: 0,
      max: 255,
      step: 1,
      randomize: [70, 190],
    },
    matrixSize: {
      label: "Matrix",
      description: "Bayer matrix size.",
      type: "select",
      default: 4,
      options: [2, 4, 8].map((v) => ({ label: `${v}x${v}`, value: v })),
    },
    palette: {
      label: "Palette",
      description: "Output colors.",
      type: "palette",
      default: ["#000000", "#ffffff"],
    },
    invert: {
      label: "Invert",
      description: "Invert threshold mapping.",
      type: "boolean",
      default: false,
    },
    serpentine: {
      label: "Serpentine",
      description: "Alternate diffusion direction.",
      type: "boolean",
      default: true,
    },
    strength: {
      label: "Strength",
      description: "Diffusion strength.",
      type: "number",
      default: 1,
      min: 0,
      max: 2,
      step: 0.05,
      randomize: [0.55, 1.25],
    },
    luminanceMode: {
      label: "Luma",
      description: "Luminance formula.",
      type: "select",
      default: "rec709",
      options: ["rec709", "rec601", "average"].map((v) => ({
        label: v,
        value: v,
      })),
    },
    alphaPreserve: {
      label: "Alpha",
      description: "Preserve original alpha.",
      type: "boolean",
      default: true,
    },
  },
  process: (image, stage) => applyDither(image, stage.params, stage.seed),
};

interface NoiseParams extends StageParams {
  grain: number;
  mono: boolean;
  dropout: number;
  dust: number;
  scratches: number;
  inkSpread: number;
  paper: string;
}
const noise: ProcessorDefinition<NoiseParams> = {
  type: "noise",
  name: "Print Degradation",
  description:
    "Seeded grain, colored noise, dust, scratches, dropout, ink spread, and paper tone.",
  params: {
    grain: {
      label: "Grain",
      description: "Noise amount.",
      type: "number",
      default: 0,
      min: 0,
      max: 120,
      step: 1,
      randomize: [5, 55],
    },
    mono: {
      label: "Mono",
      description: "Monochrome noise.",
      type: "boolean",
      default: true,
    },
    dropout: {
      label: "Dropout",
      description: "White speck dropout.",
      type: "number",
      default: 0,
      min: 0,
      max: 0.25,
      step: 0.005,
      randomize: [0, 0.08],
    },
    dust: {
      label: "Dust",
      description: "Dark dust specks.",
      type: "number",
      default: 0,
      min: 0,
      max: 0.25,
      step: 0.005,
      randomize: [0, 0.08],
    },
    scratches: {
      label: "Scratches",
      description: "Vertical scratch count.",
      type: "number",
      default: 0,
      min: 0,
      max: 80,
      step: 1,
      randomize: [0, 18],
    },
    inkSpread: {
      label: "Ink Spread",
      description: "Dark channel spread.",
      type: "number",
      default: 0,
      min: 0,
      max: 4,
      step: 1,
      randomize: [0, 2],
    },
    paper: {
      label: "Paper",
      description: "Paper/background tone.",
      type: "color",
      default: "#000000",
    },
  },
  process(image, stage) {
    const rng = mulberry32(stage.seed);
    const out = cloneImage(image);
    const grain = num(stage.params.grain, 0, 0, 120);
    for (let i = 0; i < out.data.length; i += 4) {
      const n = randRange(rng, -grain, grain);
      const nr = bool(stage.params.mono) ? n : randRange(rng, -grain, grain);
      const ng = bool(stage.params.mono) ? n : randRange(rng, -grain, grain);
      const nb = bool(stage.params.mono) ? n : randRange(rng, -grain, grain);
      if (rng() < num(stage.params.dropout, 0))
        writePixel(out.data, i, 255, 255, 255, out.data[i + 3]);
      else if (rng() < num(stage.params.dust, 0))
        writePixel(out.data, i, 0, 0, 0, out.data[i + 3]);
      else
        writePixel(
          out.data,
          i,
          out.data[i] + nr,
          out.data[i + 1] + ng,
          out.data[i + 2] + nb,
          out.data[i + 3],
        );
    }
    const scratchCount = Math.round(num(stage.params.scratches, 0, 0, 80));
    for (let s = 0; s < scratchCount; s++) {
      const x = Math.floor(rng() * out.width);
      for (let y = 0; y < out.height; y++) {
        const i = (y * out.width + x) * 4;
        writePixel(out.data, i, 230, 230, 220, out.data[i + 3]);
      }
    }
    return out;
  },
};

interface DisplaceParams extends StageParams {
  rowDrift: number;
  columnDrift: number;
  wave: number;
  frequency: number;
  rgbSplit: number;
  blockShuffle: number;
  tear: number;
  edge: string;
}
const displace: ProcessorDefinition<DisplaceParams> = {
  type: "displace",
  name: "Distortion and Entropy",
  description:
    "Seeded row drift, column drift, wave displacement, RGB separation, block shuffle, tearing, and edge modes.",
  params: {
    rowDrift: {
      label: "Row Drift",
      description: "Horizontal row displacement.",
      type: "number",
      default: 0,
      min: -160,
      max: 160,
      step: 1,
      randomize: [-36, 36],
    },
    columnDrift: {
      label: "Col Drift",
      description: "Vertical column displacement.",
      type: "number",
      default: 0,
      min: -160,
      max: 160,
      step: 1,
      randomize: [-28, 28],
    },
    wave: {
      label: "Wave",
      description: "Wave displacement.",
      type: "number",
      default: 0,
      min: -140,
      max: 140,
      step: 1,
      randomize: [-30, 30],
    },
    frequency: {
      label: "Freq",
      description: "Wave/noise frequency.",
      type: "number",
      default: 6,
      min: 0.1,
      max: 60,
      step: 0.1,
      randomize: [2, 18],
    },
    rgbSplit: {
      label: "RGB Split",
      description: "Channel separation.",
      type: "number",
      default: 0,
      min: 0,
      max: 80,
      step: 1,
      randomize: [0, 18],
    },
    blockShuffle: {
      label: "Shuffle",
      description: "Block shuffle amount.",
      type: "number",
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      randomize: [0, 0.35],
    },
    tear: {
      label: "Tear",
      description: "Scanline tearing probability.",
      type: "number",
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      randomize: [0, 0.25],
    },
    edge: {
      label: "Edge",
      description: "Edge sampling mode.",
      type: "select",
      default: "wrap",
      options: ["clamp", "wrap", "mirror", "transparent"].map((v) => ({
        label: v,
        value: v,
      })),
    },
  },
  process(image, stage) {
    const rng = mulberry32(stage.seed);
    const out = cloneImage(image);
    const edge = str(stage.params.edge, "wrap");
    const rowOffsets = Array.from({ length: image.height }, () =>
      randRange(
        rng,
        -num(stage.params.rowDrift, 0),
        num(stage.params.rowDrift, 0),
      ),
    );
    const colOffsets = Array.from({ length: image.width }, () =>
      randRange(
        rng,
        -num(stage.params.columnDrift, 0),
        num(stage.params.columnDrift, 0),
      ),
    );
    for (let y = 0; y < image.height; y++) {
      const tear =
        rng() < num(stage.params.tear, 0)
          ? randRange(rng, -image.width * 0.25, image.width * 0.25)
          : 0;
      for (let x = 0; x < image.width; x++) {
        const wave =
          Math.sin(
            (y / image.height) * Math.PI * 2 * num(stage.params.frequency, 6),
          ) * num(stage.params.wave, 0);
        const dx = rowOffsets[y] + wave + tear;
        const dy = colOffsets[x];
        const split = num(stage.params.rgbSplit, 0);
        const r = sample(
          image.data,
          image.width,
          image.height,
          x + dx + split,
          y + dy,
          edge,
        )[0];
        const g = sample(
          image.data,
          image.width,
          image.height,
          x + dx,
          y + dy,
          edge,
        )[1];
        const b = sample(
          image.data,
          image.width,
          image.height,
          x + dx - split,
          y + dy,
          edge,
        )[2];
        const a = sample(
          image.data,
          image.width,
          image.height,
          x + dx,
          y + dy,
          edge,
        )[3];
        writePixel(out.data, (y * image.width + x) * 4, r, g, b, a);
      }
    }
    return out;
  },
};

interface HalftoneParams extends StageParams {
  shape: string;
  cellWidth: number;
  cellHeight: number;
  minSize: number;
  maxSize: number;
  invert: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  rotation: number;
  stagger: number;
  jitter: number;
  background: string;
  transparent: boolean;
  glyph: string;
}
const halftone: ProcessorDefinition<HalftoneParams> = {
  type: "halftone",
  name: "Sampled Marks",
  description:
    "Generalized historical ellipse renderer with circles, rectangles, lines, rings, crosses, triangles, glyphs, jitter, opacity, and background.",
  params: {
    shape: {
      label: "Shape",
      description: "Rendered mark shape.",
      type: "select",
      default: "circle",
      options: [
        "circle",
        "ellipse",
        "square",
        "rectangle",
        "diamond",
        "line",
        "cross",
        "ring",
        "point",
        "triangle",
        "glyph",
      ].map((v) => ({ label: v, value: v })),
    },
    cellWidth: {
      label: "Cell W",
      description: "Sample cell width.",
      type: "number",
      default: 10,
      min: 1,
      max: 180,
      step: 1,
      randomize: [4, 28],
    },
    cellHeight: {
      label: "Cell H",
      description: "Sample cell height.",
      type: "number",
      default: 10,
      min: 1,
      max: 180,
      step: 1,
      randomize: [4, 28],
    },
    minSize: {
      label: "Min",
      description: "Minimum mark size.",
      type: "number",
      default: 0,
      min: 0,
      max: 180,
      step: 1,
    },
    maxSize: {
      label: "Max",
      description: "Maximum mark size.",
      type: "number",
      default: 12,
      min: 0,
      max: 240,
      step: 1,
      randomize: [4, 50],
    },
    invert: {
      label: "Invert Map",
      description: "Dark pixels create larger marks.",
      type: "boolean",
      default: true,
    },
    fill: {
      label: "Fill",
      description: "Fill color.",
      type: "color",
      default: "#ffffff",
    },
    stroke: {
      label: "Stroke",
      description: "Stroke color.",
      type: "color",
      default: "#000000",
    },
    strokeWidth: {
      label: "Stroke W",
      description: "Stroke width.",
      type: "number",
      default: 0,
      min: 0,
      max: 20,
      step: 0.1,
    },
    opacity: {
      label: "Opacity",
      description: "Mark opacity.",
      type: "number",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
    rotation: {
      label: "Rotation",
      description: "Mark rotation.",
      type: "number",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      randomize: [-45, 45],
    },
    stagger: {
      label: "Stagger",
      description: "Stagger alternate rows.",
      type: "number",
      default: 0,
      min: -1,
      max: 1,
      step: 0.05,
    },
    jitter: {
      label: "Jitter",
      description: "Seeded cell jitter.",
      type: "number",
      default: 0,
      min: 0,
      max: 1,
      step: 0.01,
      randomize: [0, 0.8],
    },
    background: {
      label: "Bg",
      description: "Background color.",
      type: "color",
      default: "#000000",
    },
    transparent: {
      label: "Transparent",
      description: "Transparent background.",
      type: "boolean",
      default: false,
    },
    glyph: {
      label: "Glyph",
      description: "Glyph shape text.",
      type: "text",
      default: "*",
    },
  },
  process(image, stage) {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return cloneImage(image);
    const p = stage.params;
    const bg = hexToRgba(str(p.background, "#000000"));
    ctx.clearRect(0, 0, image.width, image.height);
    if (!bool(p.transparent)) {
      ctx.fillStyle = `rgb(${bg[0]} ${bg[1]} ${bg[2]})`;
      ctx.fillRect(0, 0, image.width, image.height);
    }
    const rng = mulberry32(stage.seed);
    const cw = Math.max(1, Math.round(num(p.cellWidth, 10, 1)));
    const ch = Math.max(1, Math.round(num(p.cellHeight, 10, 1)));
    const fill = hexToRgba(str(p.fill, "#ffffff"));
    const stroke = hexToRgba(str(p.stroke, "#000000"));
    ctx.globalAlpha = num(p.opacity, 1, 0, 1);
    ctx.lineWidth = num(p.strokeWidth, 0, 0, 20);
    ctx.fillStyle = `rgb(${fill[0]} ${fill[1]} ${fill[2]})`;
    ctx.strokeStyle = `rgb(${stroke[0]} ${stroke[1]} ${stroke[2]})`;
    for (let y = 0; y < image.height; y += ch)
      for (let x = 0; x < image.width; x += cw) {
        const c = sample(
          image.data,
          image.width,
          image.height,
          x + cw / 2,
          y + ch / 2,
        );
        const lum = luminance(c[0], c[1], c[2]) / 255;
        const t = bool(p.invert, true) ? 1 - lum : lum;
        const size =
          num(p.minSize, 0) + (num(p.maxSize, 12) - num(p.minSize, 0)) * t;
        const cx =
          x +
          cw / 2 +
          ((y / ch) % 2 ? cw * num(p.stagger, 0) : 0) +
          randRange(rng, -cw, cw) * num(p.jitter, 0);
        const cy = y + ch / 2 + randRange(rng, -ch, ch) * num(p.jitter, 0);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((num(p.rotation, 0) * Math.PI) / 180);
        ctx.beginPath();
        const shape = str(p.shape, "circle");
        if (shape === "square" || shape === "rectangle")
          ctx.rect(
            -size / 2,
            -size / 2,
            shape === "square" ? size : size * 1.6,
            size,
          );
        else if (shape === "diamond") {
          ctx.moveTo(0, -size / 2);
          ctx.lineTo(size / 2, 0);
          ctx.lineTo(0, size / 2);
          ctx.lineTo(-size / 2, 0);
          ctx.closePath();
        } else if (shape === "line") {
          ctx.moveTo(-size / 2, 0);
          ctx.lineTo(size / 2, 0);
        } else if (shape === "cross") {
          ctx.moveTo(-size / 2, 0);
          ctx.lineTo(size / 2, 0);
          ctx.moveTo(0, -size / 2);
          ctx.lineTo(0, size / 2);
        } else if (shape === "triangle") {
          ctx.moveTo(0, -size / 2);
          ctx.lineTo(size / 2, size / 2);
          ctx.lineTo(-size / 2, size / 2);
          ctx.closePath();
        } else if (shape === "glyph") {
          ctx.font = `${Math.max(1, size)}px serif`;
          ctx.fillText(str(p.glyph, "*"), -size / 2, size / 2);
          ctx.restore();
          continue;
        } else
          ctx.ellipse(
            0,
            0,
            shape === "ellipse" ? size * 0.7 : size / 2,
            size / 2,
            0,
            0,
            Math.PI * 2,
          );
        if (shape !== "ring" && shape !== "point") ctx.fill();
        if (num(p.strokeWidth, 0) > 0 || shape === "ring" || shape === "point")
          ctx.stroke();
        ctx.restore();
      }
    return ctx.getImageData(0, 0, image.width, image.height);
  },
};

interface GeometryParams extends StageParams {
  flipX: boolean;
  flipY: boolean;
  translateX: number;
  translateY: number;
  rotate: number;
  scale: number;
  repeat: boolean;
  border: number;
  background: string;
}
const geometry: ProcessorDefinition<GeometryParams> = {
  type: "geometry",
  name: "Geometry and Composition",
  description:
    "Flip, scale, rotate, translate, repeat, border, and background color.",
  params: {
    flipX: {
      label: "Flip X",
      description: "Horizontal flip.",
      type: "boolean",
      default: false,
    },
    flipY: {
      label: "Flip Y",
      description: "Vertical flip.",
      type: "boolean",
      default: false,
    },
    translateX: {
      label: "Move X",
      description: "Horizontal translation.",
      type: "number",
      default: 0,
      min: -1000,
      max: 1000,
      step: 1,
    },
    translateY: {
      label: "Move Y",
      description: "Vertical translation.",
      type: "number",
      default: 0,
      min: -1000,
      max: 1000,
      step: 1,
    },
    rotate: {
      label: "Rotate",
      description: "Rotation degrees.",
      type: "number",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
    },
    scale: {
      label: "Scale",
      description: "Scale multiplier.",
      type: "number",
      default: 1,
      min: 0.05,
      max: 6,
      step: 0.01,
    },
    repeat: {
      label: "Repeat",
      description: "Tile image to fill canvas.",
      type: "boolean",
      default: false,
    },
    border: {
      label: "Border",
      description: "Border width.",
      type: "number",
      default: 0,
      min: 0,
      max: 400,
      step: 1,
    },
    background: {
      label: "Bg",
      description: "Background color.",
      type: "color",
      default: "#000000",
    },
  },
  process(image, stage) {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return image;
    const bg = hexToRgba(str(stage.params.background, "#000000"));
    ctx.fillStyle = `rgb(${bg[0]} ${bg[1]} ${bg[2]})`;
    ctx.fillRect(0, 0, image.width, image.height);
    const src = new OffscreenCanvas(image.width, image.height);
    src.getContext("2d")?.putImageData(image, 0, 0);
    ctx.save();
    ctx.translate(
      image.width / 2 + num(stage.params.translateX, 0),
      image.height / 2 + num(stage.params.translateY, 0),
    );
    ctx.rotate((num(stage.params.rotate, 0) * Math.PI) / 180);
    ctx.scale(
      (bool(stage.params.flipX) ? -1 : 1) * num(stage.params.scale, 1, 0.05, 6),
      (bool(stage.params.flipY) ? -1 : 1) * num(stage.params.scale, 1, 0.05, 6),
    );
    ctx.drawImage(src, -image.width / 2, -image.height / 2);
    ctx.restore();
    const border = num(stage.params.border, 0, 0, 400);
    if (border) {
      ctx.lineWidth = border;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.strokeRect(
        border / 2,
        border / 2,
        image.width - border,
        image.height - border,
      );
    }
    return ctx.getImageData(0, 0, image.width, image.height);
  },
};

interface BlendParams extends StageParams {
  amount: number;
  mode: string;
}
const blendOriginal: ProcessorDefinition<BlendParams> = {
  type: "blendOriginal",
  name: "Blend Original",
  description: "Blend current stack with the immutable root image.",
  params: {
    amount: {
      label: "Amount",
      description: "Original blend amount.",
      type: "number",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
    },
    mode: {
      label: "Mode",
      description: "Blend mode.",
      type: "select",
      default: "normal",
      options: ["normal", "multiply", "screen", "difference"].map((v) => ({
        label: v,
        value: v,
      })),
    },
  },
  process(image, stage, ctx) {
    if (
      !ctx.original ||
      ctx.original.width !== image.width ||
      ctx.original.height !== image.height
    )
      return image;
    const out = cloneImage(image);
    const amount = num(stage.params.amount, 0.5, 0, 1);
    for (let i = 0; i < out.data.length; i += 4)
      for (let c = 0; c < 3; c++)
        out.data[i + c] = clampInt(
          out.data[i + c] * (1 - amount) + ctx.original.data[i + c] * amount,
        );
    return out;
  },
};

export const processorRegistry = {
  tone,
  dither,
  pixelate,
  halftone,
  displace,
  noise,
  geometry,
  blendOriginal,
} as unknown as Record<string, ProcessorDefinition>;

export function defaultParams(
  type: keyof typeof processorRegistry,
): StageParams {
  return Object.fromEntries(
    Object.entries(processorRegistry[type].params).map(([key, meta]) => [
      key,
      meta.default,
    ]),
  );
}

export function makeStage(
  type: keyof typeof processorRegistry,
  params: StageParams = {},
  seed = Date.now(),
): PipelineStage {
  return {
    id: crypto.randomUUID(),
    type: type as ProcessorType,
    enabled: true,
    locked: false,
    seed,
    params: { ...defaultParams(type), ...params },
    locks: {},
  };
}

export function normalizePipeline(stages: PipelineStage[]): PipelineStage[] {
  return stages.slice(0, 64).map((stage, index) => {
    const definition = processorRegistry[stage.type];
    const params = definition
      ? { ...defaultParams(stage.type), ...stage.params }
      : stage.params;
    return {
      ...stage,
      id: stage.id || `stage-${index}`,
      seed: Number.isFinite(stage.seed) ? stage.seed : index + 1,
      enabled: stage.enabled !== false,
      locked: stage.locked === true,
      params,
    };
  });
}

export function runPipeline(
  source: ImageData,
  pipeline: PipelineStage[],
  original: ImageData | undefined,
  mode: "preview" | "full",
  revision: number,
): ImageData {
  return normalizePipeline(pipeline).reduce((image, stage) => {
    if (!stage.enabled) return image;
    const processor = processorRegistry[stage.type];
    return processor
      ? processor.process(image, stage, { original, mode, revision })
      : image;
  }, cloneImage(source));
}
