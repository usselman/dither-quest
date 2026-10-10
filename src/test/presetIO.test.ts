import { describe, expect, it } from "vitest";
import { decodePreset } from "../core/presetIO";
import { builtInPresets } from "../core/presets";

describe("portable preset imports", () => {
  it("accepts every existing preset without changing its stages", () => {
    for (const preset of builtInPresets)
      expect(decodePreset(JSON.parse(JSON.stringify(preset))).stages).toEqual(preset.stages);
  });
  it("round trips both named and legacy exports", () => {
    const stages = builtInPresets[2].stages;
    expect(decodePreset({ name: "Study", stages }).name).toBe("Study");
    expect(decodePreset({ pipeline: stages, seed: 12345 }).stages).toEqual(stages);
    expect(decodePreset({ stages: [] }).stages).toEqual([]);
  });
  it("rejects malformed or oversized stage data", () => {
    for (const value of [null, [], {}, { stages: null }, { stages: [{}] },
      { stages: [{ type: "__proto__", params: {} }] },
      { stages: Array(65).fill(builtInPresets[0].stages[0]) }])
      expect(() => decodePreset(value)).toThrow();
  });
  it("rejects unsafe parameter types before they reach a renderer", () => {
    for (const params of [{ brightness: "abc" }, { brightness: Infinity }, { invert: "yes" }])
      expect(() => decodePreset({ stages: [{ type: "tone", params }] })).toThrow();
    expect(() => decodePreset({ stages: [{ type: "dither", params: { palette: "bad" } }] })).toThrow();
    expect(() => decodePreset({ stages: [{ type: "dither", params: { algorithm: "missing" } }] })).toThrow();
  });
});
