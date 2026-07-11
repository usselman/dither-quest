import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Download,
  FileImage,
  Lock,
  LockOpen,
  Plus,
  Redo2,
  Shuffle,
  Upload,
  Wand2,
  Undo2,
} from "lucide-react";
import { builtInPresets } from "../core/presets";
import {
  defaultParams,
  makeStage,
  processorRegistry,
} from "../core/processors";
import {
  cacheKeyFor,
  normalizePipeline,
  randomizeUnlocked,
  runPipeline,
  validatePresetStages,
} from "../core/pipeline";
import { extractPalette } from "../core/color";
import { fileToImageData, imageDataToBlob } from "../core/image";
import type { PipelineStage, Preset, PreviewQuality, RenderMetrics, RenderRequest, RenderResponse } from "../core/types";
import "./styles.css";

interface Checkpoint {
  id: string;
  name: string;
  image?: ImageData;
  blob?: Blob;
  url?: string;
  width: number;
  height: number;
  createdAt: number;
}

interface HistoryEntry {
  pipeline: PipelineStage[];
  seed: number;
}

const MAX_STAGE_COUNT = 64;
const MAX_MEGAPIXELS = 32;
const MAX_CHECKPOINT_MEMORY = 512 * 1024 * 1024;

function bytesOf(image?: ImageData): number {
  return image ? image.width * image.height * 4 : 0;
}

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function cloneStage(stage: PipelineStage): PipelineStage {
  return JSON.parse(JSON.stringify(stage)) as PipelineStage;
}

async function checkpointImage(cp: Checkpoint): Promise<ImageData> {
  if (cp.image) return cp.image;
  if (!cp.blob) throw new Error("Checkpoint image is unavailable.");
  const bitmap = await createImageBitmap(cp.blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D unavailable.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  cp.image = ctx.getImageData(0, 0, cp.width, cp.height);
  return cp.image;
}

export function App(): React.ReactElement {
  const [original, setOriginal] = useState<ImageData | undefined>();
  const [sourceId, setSourceId] = useState("original");
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [source, setSource] = useState<ImageData | undefined>();
  const [pipeline, setPipeline] = useState<PipelineStage[]>(
    builtInPresets[2].stages.map(cloneStage),
  );
  const [selectedStageId, setSelectedStageId] = useState(pipeline[0]?.id);
  const [preview, setPreview] = useState<ImageData | undefined>();
  const [renderMs, setRenderMs] = useState(0);
  const [seed, setSeed] = useState(12345);
  const [quality, setQuality] = useState<PreviewQuality>("balanced");
  const [isInteracting, setIsInteracting] = useState(false);
  const [renderState, setRenderState] = useState<"ready" | "rendering" | "stale" | "error">("ready");
  const [metrics, setMetrics] = useState<RenderMetrics>();
  const [sourceName, setSourceName] = useState("NO SOURCE");
  const [presetName, setPresetName] = useState(builtInPresets[2].name);
  const [presetSearch, setPresetSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [compare, setCompare] = useState(false);
  const [status, setStatus] = useState("Drop, paste, or upload an image.");
  const [undo, setUndo] = useState<HistoryEntry[]>([]);
  const [redo, setRedo] = useState<HistoryEntry[]>([]);
  const [userPresets, setUserPresets] = useState<Preset[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("dq:userPresets") ?? "[]",
      ) as Preset[];
    } catch {
      return [];
    }
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef({ id: "", revision: 0 });
  const workerRef = useRef<Worker | undefined>(undefined);
  const inFlightRef = useRef(false);
  const pendingRef = useRef<RenderRequest | undefined>(undefined);
  const settleRef = useRef<number | undefined>(undefined);

  const previewEdge = useCallback((mode: PreviewQuality) => {
    const viewport = document.querySelector<HTMLElement>(".viewport");
    const visibleEdge = Math.max(viewport?.clientWidth ?? 900, viewport?.clientHeight ?? 700);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const multiplier = mode === "draft" ? 0.45 : mode === "balanced" ? 0.85 : 1.35;
    return Math.round(Math.min(mode === "draft" ? 520 : mode === "balanced" ? 1200 : 2000, Math.max(320, visibleEdge * dpr * multiplier)));
  }, []);

  const dispatchNext = useCallback(() => {
    if (inFlightRef.current || !pendingRef.current || !workerRef.current) return;
    const request = pendingRef.current;
    pendingRef.current = undefined;
    inFlightRef.current = true;
    workerRef.current.postMessage(request);
  }, []);

  const presets = useMemo(
    () => [...builtInPresets, ...userPresets],
    [userPresets],
  );
  const selectedStage =
    pipeline.find((stage) => stage.id === selectedStageId) ?? pipeline[0];
  const memory =
    bytesOf(original) +
    checkpoints.reduce((sum, cp) => sum + bytesOf(cp.image), 0) +
    bytesOf(preview);
  const sourceSize = source ? `${source.width} x ${source.height}` : "-";
  const previewSize = preview ? `${preview.width} x ${preview.height}` : "-";

  useEffect(() => {
    workerRef.current = new Worker(
      new URL("../workers/renderWorker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current.onmessage = (event: MessageEvent<RenderResponse>) => {
      inFlightRef.current = false;
      if (
        event.data.requestId !== requestRef.current.id ||
        event.data.revision !== requestRef.current.revision
      ) {
        dispatchNext();
        return;
      }
      setPreview(event.data.image);
      setRenderMs(event.data.renderMs);
      setMetrics(event.data.metrics);
      setRenderState("ready");
      requestAnimationFrame(() => dispatchNext());
    };
    workerRef.current.onerror = () => {
      inFlightRef.current = false;
      setRenderState("error");
      setStatus("Preview worker failed. Full-resolution actions remain available.");
    };
    return () => workerRef.current?.terminate();
  }, [dispatchNext]);

  useEffect(() => {
    localStorage.setItem("dq:userPresets", JSON.stringify(userPresets));
  }, [userPresets]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>(event.shiftKey ? "[data-action=redo]" : "[data-action=undo]")?.click();
      } else if (event.key === "+" || event.key === "=") setZoom((z) => Math.min(8, z + 0.1));
      else if (event.key === "-") setZoom((z) => Math.max(0.1, z - 0.1));
      else if (event.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = preview ?? source;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.style.width = `${image.width * zoom}px`;
    canvas.style.height = `${image.height * zoom}px`;
    canvas
      .getContext("2d")
      ?.putImageData(compare && source ? source : image, 0, 0);
  }, [preview, source, zoom, compare]);

  useEffect(() => {
    if (!source) return;
    const revision = requestRef.current.revision + 1;
    const requestId = crypto.randomUUID();
    requestRef.current = { id: requestId, revision };
    const normalized = normalizePipeline(pipeline);
    const renderQuality: PreviewQuality = isInteracting ? "draft" : quality;
    setRenderState("stale");
    if (workerRef.current) {
      pendingRef.current = {
        requestId,
        revision,
        source,
        original,
        pipeline: normalized,
        mode: "preview",
        maxPreviewEdge: previewEdge(renderQuality),
        quality: renderQuality,
        sourceId,
      };
      dispatchNext();
    } else {
      const result = runPipeline(
        source,
        normalized,
        original,
        "preview",
        revision,
      );
      setPreview(result);
    }
  }, [source, original, pipeline, quality, isInteracting, sourceId, previewEdge, dispatchNext]);

  const pushHistory = useCallback(() => {
    setUndo((items) => [
      ...items.slice(-80),
      { pipeline: pipeline.map(cloneStage), seed },
    ]);
    setRedo([]);
  }, [pipeline, seed]);

  const updatePipeline = useCallback(
    (next: PipelineStage[]) => {
      pushHistory();
      setPipeline(normalizePipeline(next));
    },
    [pushHistory],
  );

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const image = await fileToImageData(file);
    if ((image.width * image.height) / 1_000_000 > MAX_MEGAPIXELS) {
      setStatus(`Image exceeds ${MAX_MEGAPIXELS} MP safety limit.`);
      return;
    }
    setOriginal(image);
    setSource(image);
    setSourceId("original");
    setCheckpoints([]);
    setPreview(undefined);
    setStatus(`${file.name} loaded.`);
    setSourceName(file.name);
  }, []);

  const applyPreset = (preset: Preset, mode: "replace" | "append") => {
    if (!validatePresetStages(preset.stages)) return;
    const stages = preset.stages.map((stage) => ({
      ...cloneStage(stage),
      id: crypto.randomUUID(),
    }));
    updatePipeline(
      mode === "replace"
        ? stages
        : [...pipeline, ...stages].slice(0, MAX_STAGE_COUNT),
    );
    setSelectedStageId(stages[0]?.id);
    setPresetName(preset.name);
  };

  const commit = async () => {
    if (!source) return;
    setStatus("Printing full-resolution checkpoint...");
    const image = runPipeline(
      source,
      pipeline,
      original,
      "full",
      requestRef.current.revision + 1,
    );
    const blob = await imageDataToBlob(image, "image/png");
    const url = URL.createObjectURL(blob);
    const checkpoint: Checkpoint = {
      id: crypto.randomUUID(),
      name: `Print ${checkpoints.length + 1}`,
      image,
      blob,
      url,
      width: image.width,
      height: image.height,
      createdAt: Date.now(),
    };
    const next = [...checkpoints, checkpoint];
    let decodedBytes = next.reduce((sum, cp) => sum + bytesOf(cp.image), 0);
    for (const cp of next) {
      if (decodedBytes <= MAX_CHECKPOINT_MEMORY || cp.id === checkpoint.id)
        continue;
      if (cp.image && cp.blob) {
        decodedBytes -= bytesOf(cp.image);
        cp.image = undefined;
      }
    }
    setCheckpoints(next);
    setSource(image);
    setSourceId(checkpoint.id);
    setStatus(`Committed ${checkpoint.name}.`);
  };

  const exportImage = async (
    type: "image/png" | "image/jpeg" | "image/webp",
  ) => {
    if (!source) return;
    const image = runPipeline(
      source,
      pipeline,
      original,
      "full",
      requestRef.current.revision + 1,
    );
    const blob = await imageDataToBlob(image, type, 0.92);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dither-quest.${type.split("/")[1]}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  const copyImage = async () => {
    if (!preview || !("ClipboardItem" in window)) return;
    const blob = await imageDataToBlob(preview, "image/png");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    setStatus("Preview copied as PNG.");
  };

  const savePreset = () => {
    const name = prompt("Preset name", "User Ritual");
    if (!name) return;
    setUserPresets((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        name,
        category: "User",
        description: "Saved local stack.",
        stages: pipeline.map(cloneStage),
      },
    ]);
  };

  const importPreset = async (file: File) => {
    const imported = JSON.parse(await file.text()) as Preset;
    if (validatePresetStages(imported.stages))
      setUserPresets((items) => [
        ...items,
        { ...imported, id: crypto.randomUUID(), category: "User" },
      ]);
  };

  const exportPresetJson = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { pipeline, seed, cacheKey: cacheKeyFor(pipeline) },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "dither-quest-preset.json";
    a.click();
  };

  const selectCheckpoint = async (id: string) => {
    if (id === "original" && original) {
      setSource(original);
      setSourceId("original");
      setSourceName("ORIGINAL ROOT");
      return;
    }
    const cp = checkpoints.find((item) => item.id === id);
    if (!cp) return;
    const image = await checkpointImage(cp);
    setSource(image);
    setSourceId(id);
    setSourceName(cp.name.toUpperCase());
  };

  const updateStageParam = (stageId: string, key: string, value: unknown) => {
    updatePipeline(
      pipeline.map((stage) =>
        stage.id === stageId
          ? { ...stage, params: { ...stage.params, [key]: value } }
          : stage,
      ),
    );
  };

  const beginInteraction = () => {
    window.clearTimeout(settleRef.current);
    setIsInteracting(true);
  };

  const endInteraction = () => {
    window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => setIsInteracting(false), 140);
  };

  const lockParam = (stageId: string, key: string) => {
    updatePipeline(
      pipeline.map((stage) =>
        stage.id === stageId
          ? { ...stage, locks: { ...stage.locks, [key]: !stage.locks?.[key] } }
          : stage,
      ),
    );
  };

  const moveStage = (id: string, delta: number) => {
    const index = pipeline.findIndex((stage) => stage.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= pipeline.length) return;
    const next = [...pipeline];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    updatePipeline(next);
  };

  return (
    <main
      className="shell"
      onDrop={(e) => {
        e.preventDefault();
        void handleFile(e.dataTransfer.files[0]);
      }}
      onDragOver={(e) => e.preventDefault()}
      onPaste={(e) => {
        const file = [...e.clipboardData.files][0];
        if (file) void handleFile(file);
      }}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brandIndex">DQ—01</span>
          <strong>DITHER<br />QUEST</strong>
          <span>arcane<br />image instrument</span>
        </div>
        <div className="headerMeta"><small>SOURCE</small><b>{sourceName}</b></div>
        <div className="headerMeta"><small>CHECKPOINT</small><b>{sourceId === "original" ? "ROOT" : `PRINT ${checkpoints.findIndex((cp) => cp.id === sourceId) + 1}`}</b></div>
        <div className="headerMeta"><small>PRESET</small><b>{presetName}</b></div>
        <div className={`renderBadge ${renderState}`} aria-live="polite">{renderState === "ready" ? (metrics?.cacheHits ? "CACHED / READY" : "READY") : renderState.toUpperCase()}</div>
        <label className="tool">
          <Upload size={15} />
          <input
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) =>
              e.target.files?.[0] && void handleFile(e.target.files[0])
            }
          />
          Upload
        </label>
        <button
          data-action="undo"
          aria-label="Undo"
          onClick={() => {
            const last = undo.at(-1);
            if (!last) return;
            setRedo((r) => [...r, { pipeline, seed }]);
            setUndo((u) => u.slice(0, -1));
            setPipeline(last.pipeline);
            setSeed(last.seed);
          }}
        >
          <Undo2 size={15} />
        </button>
        <button
          data-action="redo"
          aria-label="Redo"
          onClick={() => {
            const next = redo.at(-1);
            if (!next) return;
            setUndo((u) => [...u, { pipeline, seed }]);
            setRedo((r) => r.slice(0, -1));
            setPipeline(next.pipeline);
            setSeed(next.seed);
          }}
        >
          <Redo2 size={15} />
        </button>
        <button aria-pressed={compare} onClick={() => setCompare((v) => !v)}>Before / After</button>
        <label>QUALITY <select value={quality} onChange={(e) => setQuality(e.target.value as PreviewQuality)}><option value="draft">Draft</option><option value="balanced">Balanced</option><option value="full">Full</option></select></label>
        <label>
          Seed{" "}
          <input
            className="seed"
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value))}
          />
        </label>
        <button
          onClick={() => {
            const next = Math.floor(Math.random() * 1_000_000);
            setSeed(next);
            updatePipeline(
              pipeline.map((s) =>
                s.locked ? s : { ...s, seed: next + s.id.length },
              ),
            );
          }}
        >
          <Shuffle size={15} />
          Reroll
        </button>
        <button
          onClick={() => updatePipeline(randomizeUnlocked(pipeline, seed, 1))}
        >
          <Wand2 size={15} />
          Random
        </button>
        <button
          onClick={() =>
            updatePipeline(randomizeUnlocked(pipeline, seed + 99, 0.25))
          }
        >
          Mutate
        </button>
        <button className="primary" onClick={() => void commit()}>
          Print / Commit
        </button>
        <button onClick={() => void exportImage("image/png")}>
          <Download size={15} />
          PNG
        </button>
        <button onClick={() => void exportImage("image/jpeg")}>JPG</button>
        <button onClick={() => void exportImage("image/webp")}>WebP</button>
        <button onClick={() => void copyImage()}>Copy</button>
      </header>

      <aside className="left panel">
        <section>
          <h2><i>01</i> Preset matrix</h2>
          <input className="search" type="search" placeholder="SEARCH PRESETS" aria-label="Search presets" value={presetSearch} onChange={(e) => setPresetSearch(e.target.value)} />
          {(
            [
              "Traditional",
              "Historical",
              "Halftone",
              "Pixel",
              "Print",
              "Glitch",
              "Entropic",
              "User",
            ] as const
          ).map((cat) => (
            <details
              key={cat}
              open={cat === "Traditional" || cat === "Historical"}
            >
              <summary>{cat}</summary>
              {presets
                .filter((p) => p.category === cat && `${p.name} ${p.description}`.toLowerCase().includes(presetSearch.toLowerCase()))
                .map((preset) => (
                  <div
                    className="preset"
                    key={preset.id}
                    title={preset.description}
                  >
                    <button onClick={() => applyPreset(preset, "replace")}>
                      <span><b>{preset.name}</b><small>{preset.category} · {preset.stages.length} STG</small></span>
                    </button>
                    <button onClick={() => applyPreset(preset, "append")}>
                      <Plus size={13} />
                    </button>
                  </div>
                ))}
            </details>
          ))}
          <div className="row">
            <button onClick={savePreset}>Save</button>
            <button onClick={exportPresetJson}>Export JSON</button>
            <label className="tool">
              <FileImage size={14} />
              Import
              <input
                hidden
                type="file"
                accept="application/json"
                onChange={(e) =>
                  e.target.files?.[0] && void importPreset(e.target.files[0])
                }
              />
            </label>
          </div>
        </section>
        <section>
          <h2><i>02</i> Processor library</h2>
          {Object.values(processorRegistry).map((def) => (
            <button
              key={def.type}
              onClick={() =>
                updatePipeline(
                  [
                    ...pipeline,
                    makeStage(def.type, defaultParams(def.type), seed),
                  ].slice(0, MAX_STAGE_COUNT),
                )
              }
            >
              {def.name}
            </button>
          ))}
        </section>
        <section>
          <h2><i>03</i> Checkpoint archive</h2>
          {original && (
            <button
              className={sourceId === "original" ? "active" : ""}
              onClick={() => void selectCheckpoint("original")}
            >
              Original root
            </button>
          )}
          {checkpoints.map((cp) => (
            <div className="checkpoint" key={cp.id}>
              {cp.url && <img src={cp.url} alt="" />}
              <button
                className={sourceId === cp.id ? "active" : ""}
                onClick={() => void selectCheckpoint(cp.id)}
              >
                {cp.name}
              </button>
              <button
                onClick={() =>
                  cp.url &&
                  Object.assign(document.createElement("a"), {
                    href: cp.url,
                    download: `${cp.name}.png`,
                  }).click()
                }
              >
                Down
              </button>
              <button
                onClick={() =>
                  setCheckpoints((items) =>
                    items.filter((item) => item.id !== cp.id),
                  )
                }
              >
                Del
              </button>
            </div>
          ))}
        </section>
      </aside>

      <section className="viewport">
        <div className="viewportLabel">VISUAL OUTPUT / PREVIEW MATRIX</div>
        {!source && (
          <div className="dropzone">
            Drop an image, paste from clipboard, or use Upload.
          </div>
        )}
        <div className={`canvasWrap ${renderState === "stale" ? "isStale" : ""}`}>
          <canvas ref={canvasRef} />
          {renderState === "stale" && <span className="staleFlag">STALE PREVIEW / RENDERING {isInteracting ? "DRAFT" : quality.toUpperCase()}</span>}
        </div>
        <div className="readout">{previewSize} · {(zoom * 100).toFixed(0)}% · {isInteracting ? "DRAFT" : quality.toUpperCase()} · {renderMs.toFixed(1)} MS</div>
        <div className="viewtools">
          <button onClick={() => setZoom(1)}>100%</button>
          <button onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}>
            -
          </button>
          <button onClick={() => setZoom((z) => Math.min(8, z + 0.1))}>
            +
          </button>
          <button
            onClick={() =>
              setZoom(
                Math.min(
                  1,
                  900 / Math.max(preview?.width ?? 900, preview?.height ?? 900),
                ),
              )
            }
          >
            Fit
          </button>
        </div>
      </section>

      <aside className="right panel">
        <section>
          <h2><i>04</i> Ordered stage stack</h2>
          {pipeline.map((stage, index) => (
            <div
              className={`stage ${selectedStage?.id === stage.id ? "active" : ""}`}
              key={stage.id}
              onClick={() => setSelectedStageId(stage.id)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updatePipeline(
                    pipeline.map((s) =>
                      s.id === stage.id ? { ...s, enabled: !s.enabled } : s,
                    ),
                  );
                }}
              >
                {stage.enabled ? "on" : "off"}
              </button>
              <span>
                {index + 1}. {processorRegistry[stage.type].name}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updatePipeline(
                    pipeline.map((s) =>
                      s.id === stage.id ? { ...s, locked: !s.locked } : s,
                    ),
                  );
                }}
              >
                {stage.locked ? <Lock size={13} /> : <LockOpen size={13} />}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  moveStage(stage.id, -1);
                }}
              >
                Up
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  moveStage(stage.id, 1);
                }}
              >
                Dn
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updatePipeline([
                    ...pipeline.slice(0, index + 1),
                    { ...cloneStage(stage), id: crypto.randomUUID() },
                    ...pipeline.slice(index + 1),
                  ]);
                }}
              >
                Dup
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updatePipeline(pipeline.filter((s) => s.id !== stage.id));
                }}
              >
                Del
              </button>
            </div>
          ))}
        </section>
        {selectedStage && (
          <section>
            <h2>{processorRegistry[selectedStage.type].name}</h2>
            <p className="desc">
              {processorRegistry[selectedStage.type].description}
            </p>
            {Object.entries(processorRegistry[selectedStage.type].params).map(
              ([key, meta]) => {
                const value = selectedStage.params[key] ?? meta.default;
                return (
                  <label className="control" key={key} title={meta.description}>
                    <span>
                      {meta.label}
                      <button onClick={() => lockParam(selectedStage.id, key)}>
                        {selectedStage.locks?.[key] ? (
                          <Lock size={11} />
                        ) : (
                          <LockOpen size={11} />
                        )}
                      </button>
                    </span>
                    {meta.type === "number" && (
                      <>
                        <input
                          type="range"
                          min={meta.min}
                          max={meta.max}
                          step={meta.step}
                          value={Number(value)}
                          onPointerDown={beginInteraction}
                          onPointerUp={endInteraction}
                          onPointerCancel={endInteraction}
                          onKeyDown={beginInteraction}
                          onKeyUp={endInteraction}
                          onChange={(e) =>
                            updateStageParam(
                              selectedStage.id,
                              key,
                              Number(e.target.value),
                            )
                          }
                        />
                        <input
                          type="number"
                          value={Number(value)}
                          onChange={(e) =>
                            updateStageParam(
                              selectedStage.id,
                              key,
                              Number(e.target.value),
                            )
                          }
                        />
                      </>
                    )}
                    {meta.type === "boolean" && (
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) =>
                          updateStageParam(
                            selectedStage.id,
                            key,
                            e.target.checked,
                          )
                        }
                      />
                    )}
                    {meta.type === "color" && (
                      <input
                        type="color"
                        value={String(value)}
                        onChange={(e) =>
                          updateStageParam(
                            selectedStage.id,
                            key,
                            e.target.value,
                          )
                        }
                      />
                    )}
                    {meta.type === "text" && (
                      <input
                        value={String(value)}
                        onChange={(e) =>
                          updateStageParam(
                            selectedStage.id,
                            key,
                            e.target.value,
                          )
                        }
                      />
                    )}
                    {meta.type === "select" && (
                      <select
                        value={String(value)}
                        onChange={(e) =>
                          updateStageParam(
                            selectedStage.id,
                            key,
                            Number.isFinite(Number(e.target.value))
                              ? Number(e.target.value)
                              : e.target.value,
                          )
                        }
                      >
                        {meta.options?.map((o) => (
                          <option key={String(o.value)} value={String(o.value)}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {meta.type === "palette" && (
                      <textarea
                        value={(value as string[]).join("\n")}
                        onChange={(e) =>
                          updateStageParam(
                            selectedStage.id,
                            key,
                            e.target.value.split(/\s+/).filter(Boolean),
                          )
                        }
                      />
                    )}
                  </label>
                );
              },
            )}
            <button
              onClick={() =>
                updatePipeline(
                  pipeline.map((s) =>
                    s.id === selectedStage.id
                      ? { ...s, params: defaultParams(s.type) }
                      : s,
                  ),
                )
              }
            >
              Reset Stage
            </button>
            {source && (
              <button
                onClick={() =>
                  updateStageParam(
                    selectedStage.id,
                    "palette",
                    extractPalette(source, 6),
                  )
                }
              >
                Extract Palette
              </button>
            )}
          </section>
        )}
      </aside>

      <footer className="status">
        <span><b>SYS</b> {status}</span>
        <span>SRC {sourceSize}</span>
        <span>PREV {previewSize}</span>
        <span>EXPORT {sourceSize}</span>
        <span>RENDER {renderMs.toFixed(1)} MS</span>
        <span>MEM {formatBytes(memory + (metrics?.cacheBytes ?? 0))}</span>
        <span>ZOOM {(zoom * 100).toFixed(0)}%</span>
        <span>SEED {seed}</span>
        <span>CACHE {metrics ? `${metrics.cacheHits}H/${metrics.cacheMisses}M` : "COLD"}</span>
        <span>WORKER {renderState === "ready" ? "IDLE" : "ACTIVE"}</span>
        <span>
          {memory > MAX_CHECKPOINT_MEMORY ? "memory warning" : "stable"}
        </span>
      </footer>
    </main>
  );
}
