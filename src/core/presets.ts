import { makeStage } from "./processors";
import type { Preset } from "./types";

const stage = makeStage;

export const builtInPresets: Preset[] = [
  {
    id: "traditional-1bit-clean",
    name: "1-Bit Clean",
    category: "Traditional",
    description: "Straight monochrome threshold, faithful and sharp.",
    stages: [
      stage(
        "dither",
        {
          algorithm: "threshold",
          threshold: 128,
          palette: ["#000000", "#ffffff"],
          serpentine: false,
        },
        101,
      ),
    ],
  },
  {
    id: "traditional-bayer-4",
    name: "Bayer 4x4",
    category: "Traditional",
    description: "Accurate ordered dithering with a 4x4 Bayer matrix.",
    stages: [
      stage(
        "dither",
        {
          algorithm: "bayer",
          matrixSize: 4,
          palette: ["#000000", "#ffffff"],
          serpentine: false,
        },
        102,
      ),
    ],
  },
  {
    id: "traditional-floyd",
    name: "Floyd-Steinberg",
    category: "Traditional",
    description: "Classic serpentine error diffusion.",
    stages: [
      stage(
        "dither",
        {
          algorithm: "floydSteinberg",
          palette: ["#000000", "#ffffff"],
          serpentine: true,
          strength: 1,
        },
        103,
      ),
    ],
  },
  {
    id: "traditional-atkinson",
    name: "Atkinson",
    category: "Traditional",
    description: "Soft Macintosh-style diffusion.",
    stages: [
      stage(
        "dither",
        {
          algorithm: "atkinson",
          palette: ["#000000", "#ffffff"],
          serpentine: false,
          strength: 1,
        },
        104,
      ),
    ],
  },
  {
    id: "traditional-newspaper",
    name: "Newspaper",
    category: "Traditional",
    description: "Ordered halftone print with mild paper degradation.",
    stages: [
      stage(
        "halftone",
        {
          shape: "circle",
          cellWidth: 8,
          cellHeight: 8,
          minSize: 1,
          maxSize: 8,
          invert: true,
          fill: "#111111",
          background: "#f2efe3",
        },
        105,
      ),
      stage(
        "noise",
        { grain: 10, mono: true, dust: 0.015, paper: "#f2efe3" },
        106,
      ),
    ],
  },
  {
    id: "traditional-limited-color-print",
    name: "Limited Color Print",
    category: "Traditional",
    description: "Nearest-color diffusion into a restrained print palette.",
    stages: [
      stage("tone", { contrast: 12, saturation: 0.9, posterize: 0 }, 107),
      stage(
        "dither",
        {
          algorithm: "stucki",
          palette: ["#151515", "#faf4df", "#d24b35", "#246a73", "#e0aa2f"],
          serpentine: true,
          strength: 0.82,
        },
        108,
      ),
    ],
  },
  {
    id: "historical-circle-dither",
    name: "Historical Circular Grayscale",
    category: "Historical",
    description:
      "The circle-dither branch: white background, grayscale filled circles sized by inverse luminance.",
    stages: [
      stage(
        "halftone",
        {
          shape: "circle",
          cellWidth: 12,
          cellHeight: 12,
          minSize: 0,
          maxSize: 12,
          invert: true,
          fill: "#7f7f7f",
          strokeWidth: 0,
          background: "#ffffff",
        },
        201,
      ),
    ],
  },
  {
    id: "historical-noisy-outline-ellipse",
    name: "Historical Noisy Outlines",
    category: "Historical",
    description:
      "The main/new-main WEBGL experiment: black field, tiny white outlined ellipses with deterministic jitter.",
    stages: [
      stage(
        "halftone",
        {
          shape: "ellipse",
          cellWidth: 8,
          cellHeight: 8,
          minSize: 0,
          maxSize: 5,
          invert: false,
          fill: "#000000",
          stroke: "#ffffff",
          strokeWidth: 1,
          background: "#000000",
          jitter: 0.5,
        },
        202,
      ),
    ],
  },
  {
    id: "historical-threshold-black-color",
    name: "Historical Black Threshold",
    category: "Historical",
    description:
      "The personal-tool black-and-color threshold treatment with hard rectangular disruption.",
    stages: [
      stage(
        "tone",
        { contrast: 38, posterize: 3, blackPoint: 12, whitePoint: 190 },
        203,
      ),
      stage(
        "pixelate",
        {
          blockWidth: 5,
          blockHeight: 5,
          mode: "maximum",
          checker: false,
          scanlines: 0.1,
        },
        204,
      ),
      stage(
        "dither",
        {
          algorithm: "threshold",
          threshold: 128,
          palette: ["#000000", "#4f392b"],
          invert: false,
        },
        205,
      ),
      stage("noise", { scratches: 12, dropout: 0.015, grain: 8 }, 206),
    ],
  },
  {
    id: "historical-rgb-random",
    name: "Historical Random RGB Palette",
    category: "Historical",
    description:
      "The early random RGB branch: threshold into black and a seeded saturated RGB color.",
    stages: [
      stage("tone", { saturation: 1.3, contrast: 18 }, 207),
      stage(
        "dither",
        {
          algorithm: "threshold",
          threshold: 128,
          palette: ["#000000", "#d75cff"],
          invert: false,
        },
        208,
      ),
      stage("noise", { grain: 18, mono: false }, 209),
    ],
  },
  {
    id: "historical-insanity",
    name: "Historical Insanity",
    category: "Historical",
    description:
      "The personal-tool-2 branch reconstructed safely: random color marks, bright-line bursts, and aggressive distortion.",
    stages: [
      stage(
        "halftone",
        {
          shape: "circle",
          cellWidth: 5,
          cellHeight: 5,
          maxSize: 10,
          fill: "#ff4ee8",
          background: "#000000",
          jitter: 0.25,
        },
        210,
      ),
      stage(
        "displace",
        {
          rowDrift: 18,
          wave: 22,
          frequency: 9,
          rgbSplit: 8,
          tear: 0.08,
          edge: "wrap",
        },
        211,
      ),
      stage(
        "noise",
        { grain: 35, mono: false, scratches: 18, dropout: 0.025 },
        212,
      ),
    ],
  },
  {
    id: "halftone-glyph-field",
    name: "Glyph Field",
    category: "Halftone",
    description: "Dense glyph marks sampled from luminance.",
    stages: [
      stage(
        "halftone",
        {
          shape: "glyph",
          glyph: "*",
          cellWidth: 9,
          cellHeight: 9,
          maxSize: 16,
          fill: "#d7fff3",
          background: "#090909",
          rotation: -12,
        },
        301,
      ),
    ],
  },
  {
    id: "pixel-line-removal",
    name: "Line Removal Grid",
    category: "Pixel",
    description: "Block averages with vertical erasure and scanline pressure.",
    stages: [
      stage(
        "pixelate",
        {
          blockWidth: 10,
          blockHeight: 6,
          mode: "average",
          removeLines: "vertical",
          scanlines: 0.35,
          gap: 1,
        },
        401,
      ),
    ],
  },
  {
    id: "print-photocopy",
    name: "Photocopy Decay",
    category: "Print",
    description:
      "High contrast threshold with dust, scratches, dropout, and paper tone.",
    stages: [
      stage(
        "tone",
        { contrast: 62, blackPoint: 30, whitePoint: 205, grayscale: true },
        501,
      ),
      stage(
        "dither",
        {
          algorithm: "threshold",
          threshold: 142,
          palette: ["#050505", "#f5f0de"],
        },
        502,
      ),
      stage(
        "noise",
        { grain: 28, dust: 0.04, dropout: 0.03, scratches: 30 },
        503,
      ),
    ],
  },
  {
    id: "glitch-registration",
    name: "Registration Error",
    category: "Glitch",
    description: "Print registration drift and RGB channel misalignment.",
    stages: [
      stage(
        "displace",
        {
          rowDrift: 10,
          columnDrift: 4,
          rgbSplit: 13,
          wave: 8,
          frequency: 4,
          tear: 0.04,
        },
        601,
      ),
      stage("tone", { saturation: 1.45, contrast: 16 }, 602),
    ],
  },
  {
    id: "entropic-feedback-shred",
    name: "Entropy Shred",
    category: "Entropic",
    description:
      "Controlled chaos stack for destructive-looking image manipulation.",
    stages: [
      stage(
        "pixelate",
        {
          blockWidth: 14,
          blockHeight: 4,
          mode: "mosaic",
          checker: true,
          gap: 1,
        },
        701,
      ),
      stage(
        "displace",
        {
          rowDrift: 44,
          columnDrift: 20,
          wave: 35,
          frequency: 17,
          rgbSplit: 18,
          tear: 0.18,
          edge: "wrap",
        },
        702,
      ),
      stage(
        "noise",
        { grain: 45, mono: false, dropout: 0.04, dust: 0.02 },
        703,
      ),
    ],
  },
];
