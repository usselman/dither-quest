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
import { Badge, Button, Dialog, Panel, TextField } from "@sheol/ui";
import { decodePreset } from "../core/presetIO";
import "@sheol/ui/styles.css";
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
import { fileToImageData, imageDataToBlob, resizeImageData } from "../core/image";
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
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedName, setSavedName] = useState("User Ritual");
  const [busy, setBusy] = useState(false);
  const [rootRevision, setRootRevision] = useState(0);
  const loadRevisionRef = useRef(0);
  const actionRef = useRef(false);
  const checkpointUrlsRef = useRef(new Set<string>());
  const imageInputRef = useRef<HTMLInputElement>(null);
  const presetInputRef = useRef<HTMLInputElement>(null);
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
      const stored: unknown = JSON.parse(localStorage.getItem("dq:userPresets") ?? "[]");
      return Array.isArray(stored) ? stored.map((item) => decodePreset(item)) : [];
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
    try {
      workerRef.current = new Worker(
        new URL("../workers/renderWorker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      setStatus("Preview worker is unavailable. Using the local renderer.");
      return;
    }
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
    workerRef.current.onerror = (event) => {
      event.preventDefault();
      inFlightRef.current = false;
      workerRef.current?.terminate();
      workerRef.current = undefined;
      pendingRef.current = undefined;
      setRenderState("error");
      setStatus("Preview worker failed. Full-resolution actions remain available.");
    };
    return () => workerRef.current?.terminate();
  }, [dispatchNext]);

  useEffect(() => {
    try { localStorage.setItem("dq:userPresets", JSON.stringify(userPresets)); }
    catch { setStatus("Presets could not be saved locally. Export JSON to keep a copy."); }
  }, [userPresets]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable || document.querySelector("dialog[open]")) return;
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
    const visible = compare && source ? source : image;
    canvas.width = visible.width;
    canvas.height = visible.height;
    canvas.style.width = `${visible.width * zoom}px`;
    canvas.style.height = `${visible.height * zoom}px`;
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
        sourceId: `${rootRevision}:${sourceId}`,
      };
      dispatchNext();
    } else {
      try {
        const edge = previewEdge(renderQuality);
        const result = runPipeline(
          resizeImageData(source, edge), normalized,
          original ? resizeImageData(original, edge) : undefined, "preview", revision,
        );
        setPreview(result);
        setRenderState("ready");
      } catch {
        setRenderState("error");
        setStatus("Preview could not render. Reset the stage or choose another preset.");
      }
    }
  }, [source, original, pipeline, quality, isInteracting, sourceId, rootRevision, previewEdge, dispatchNext]);

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
    if (!file || !file.type.startsWith("image/")) { setStatus("Choose a PNG, JPEG, or WebP image."); return; }
    const revision = ++loadRevisionRef.current;
    setStatus(`Loading ${file.name}…`);
    let image: ImageData;
    try { image = await fileToImageData(file); }
    catch { if (revision === loadRevisionRef.current) setStatus("Image could not be read. Try another PNG, JPEG, or WebP."); return; }
    if (revision !== loadRevisionRef.current) return;
    if ((image.width * image.height) / 1_000_000 > MAX_MEGAPIXELS) {
      setStatus(`Image exceeds ${MAX_MEGAPIXELS} MP safety limit.`);
      return;
    }
    requestRef.current = { id: "", revision: requestRef.current.revision + 1 };
    pendingRef.current = undefined;
    checkpointUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    checkpointUrlsRef.current.clear();
    setRootRevision((value) => value + 1);
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
    const loadRevision = loadRevisionRef.current;
    const image = runPipeline(
      source,
      pipeline,
      original,
      "full",
      requestRef.current.revision + 1,
    );
    const blob = await imageDataToBlob(image, "image/png");
    if (loadRevision !== loadRevisionRef.current) return;
    const url = URL.createObjectURL(blob);
    checkpointUrlsRef.current.add(url);
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
    setSourceName(checkpoint.name);
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
    setStatus(`${type.split("/")[1].toUpperCase()} exported at full resolution.`);
  };

  const copyImage = async () => {
    if (!preview) return;
    if (!("ClipboardItem" in window) || !navigator.clipboard?.write) throw new Error("Image clipboard is unavailable. Use PNG export.");
    const blob = await imageDataToBlob(preview, "image/png");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    setStatus("Preview copied as PNG.");
  };

  const savePreset = () => {
    if (!savedName.trim()) return;
    setUserPresets((items) => [...items, {
      id: crypto.randomUUID(), name: savedName.trim(), category: "User",
      description: "Saved local stack.", stages: pipeline.map(cloneStage),
    }]);
    setSaveOpen(false);
    setStatus(`Saved ${savedName.trim()}.`);
  };

  const importPreset = async (file: File) => {
    try {
      const imported = decodePreset(JSON.parse(await file.text()), file.name);
      setUserPresets((items) => [...items, imported]);
      setStatus(`Imported ${imported.name}. Find it in User presets.`);
    } catch { setStatus("Invalid preset JSON. Use a Dither Quest preset export with valid stages."); }
  };

  const exportPresetJson = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { name: presetName, category: "User", description: "Exported Dither Quest stack.", stages: pipeline, pipeline, seed, cacheKey: cacheKeyFor(pipeline) },
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
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    setStatus("Preset JSON exported.");
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
    if (!checkpointUrlsRef.current.has(cp.url ?? "")) return;
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

  const perform = async (action: () => Promise<void>) => {
    if (actionRef.current) return;
    actionRef.current = true;
    setBusy(true);
    try { await action(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Action failed. Please try again."); }
    finally { actionRef.current = false; setBusy(false); }
  };

  const deleteCheckpoint = (cp: Checkpoint) => {
    if (cp.url) { URL.revokeObjectURL(cp.url); checkpointUrlsRef.current.delete(cp.url); }
    setCheckpoints((items) => items.filter((item) => item.id !== cp.id));
    if (sourceId === cp.id && original) { setSource(original); setSourceId("original"); setSourceName("ORIGINAL ROOT"); }
    setStatus(`Deleted ${cp.name}.`);
  };

  useEffect(() => () => {
    checkpointUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    window.clearTimeout(settleRef.current);
  }, []);

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
        <Badge tone={renderState === "ready" ? "blue" : "yellow"} aria-live="polite">{renderState === "ready" ? (metrics?.cacheHits ? "CACHED / READY" : "READY") : renderState.toUpperCase()}</Badge>
        </header>
        <nav className="toolbar" aria-label="Image and pipeline actions">
        <Button size="sm" tone="orange" onClick={() => imageInputRef.current?.click()}>
          <Upload size={15} />
          Upload image
        </Button>
          <input
            ref={imageInputRef}
            hidden
            type="file"
            aria-label="Upload image file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) =>
              { const file = e.target.files?.[0]; e.target.value = ""; if (file) void handleFile(file); }
            }
          />
        <Button size="sm"
          data-action="undo"
          disabled={!undo.length}
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
        </Button>
        <Button size="sm"
          data-action="redo"
          disabled={!redo.length}
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
        </Button>
        <Button size="sm" disabled={!source} aria-pressed={compare} onClick={() => setCompare((v) => !v)}>Before / After</Button>
        <label className="quality">Quality <select className="sh-select" value={quality} onChange={(e) => setQuality(e.target.value as PreviewQuality)}><option value="draft">Draft</option><option value="balanced">Balanced</option><option value="full">Full</option></select></label>
        <TextField label="Seed" containerClassName="seedField" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
        <Button size="sm"
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
        </Button>
        <Button size="sm"
          onClick={() => updatePipeline(randomizeUnlocked(pipeline, seed, 1))}
        >
          <Wand2 size={15} />
          Random
        </Button>
        <Button size="sm"
          onClick={() =>
            updatePipeline(randomizeUnlocked(pipeline, seed + 99, 0.25))
          }
        >
          Mutate
        </Button>
        <Button size="sm" tone="orange" disabled={!source || busy} loading={busy} onClick={() => void perform(commit)}>
          Print / Commit
        </Button>
        <Button size="sm" disabled={!source || busy} onClick={() => void perform(() => exportImage("image/png"))}>
          <Download size={15} />
          PNG
        </Button>
        <Button size="sm" disabled={!source || busy} onClick={() => void perform(() => exportImage("image/jpeg"))}>JPG</Button>
        <Button size="sm" disabled={!source || busy} onClick={() => void perform(() => exportImage("image/webp"))}>WebP</Button>
        <Button size="sm" disabled={!preview || busy} onClick={() => void perform(copyImage)}>Copy</Button>
      </nav>

      <aside className="left panel">
        <Panel className="module">
          <h2><i>01</i> Preset matrix</h2>
          <TextField label="Search presets" type="search" placeholder="Name or description" value={presetSearch} onChange={(e) => setPresetSearch(e.target.value)} />
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
                    <Button size="sm" onClick={() => applyPreset(preset, "replace")}>
                      <span><b>{preset.name}</b><small>{preset.category} · {preset.stages.length} STG</small></span>
                    </Button>
                    <Button size="sm" aria-label={`Append ${preset.name}`} disabled={pipeline.length >= MAX_STAGE_COUNT} onClick={() => applyPreset(preset, "append")}>
                      <Plus size={13} />
                    </Button>
                  </div>
                ))}
            </details>
          ))}
          <div className="row">
            <Button size="sm" onClick={() => setSaveOpen(true)}>Save</Button>
            <Button size="sm" onClick={exportPresetJson}>Export JSON</Button>
            <Button size="sm" onClick={() => presetInputRef.current?.click()}>
              <FileImage size={14} />
              Import
            </Button>
              <input
                ref={presetInputRef}
                hidden
                type="file"
                aria-label="Import preset file"
                accept="application/json,.json"
                onChange={(e) =>
                  { const file = e.target.files?.[0]; e.target.value = ""; if (file) void importPreset(file); }
                }
              />
          </div>
        </Panel>
        <Panel className="module">
          <h2><i>02</i> Processor library</h2>
          {Object.values(processorRegistry).map((def) => (
            <Button size="sm"
              disabled={pipeline.length >= MAX_STAGE_COUNT}
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
            </Button>
          ))}
        </Panel>
        <Panel className="module">
          <h2><i>03</i> Checkpoint archive</h2>
          {original && (
            <Button size="sm"
              aria-pressed={sourceId === "original"} className={sourceId === "original" ? "active" : ""}
              onClick={() => void perform(() => selectCheckpoint("original"))}
            >
              Original root
            </Button>
          )}
          {checkpoints.map((cp) => (
            <div className="checkpoint" key={cp.id}>
              {cp.url && <img src={cp.url} alt="" />}
              <Button size="sm"
                aria-pressed={sourceId === cp.id} className={sourceId === cp.id ? "active" : ""}
                onClick={() => void perform(() => selectCheckpoint(cp.id))}
              >
                {cp.name}
              </Button>
              <Button size="sm"
                onClick={() =>
                  cp.url &&
                  Object.assign(document.createElement("a"), {
                    href: cp.url,
                    download: `${cp.name}.png`,
                  }).click()
                }
              >
                Down
              </Button>
              <Button size="sm" aria-label={`Delete ${cp.name}`} onClick={() => deleteCheckpoint(cp)}>Del</Button>
            </div>
          ))}
        </Panel>
      </aside>

      <section className="viewport" aria-label="Artwork workspace">
        <div className="viewportLabel">VISUAL OUTPUT / PREVIEW MATRIX</div>
        {!source && (
          <Panel className="dropzone">
            <Badge tone="yellow">Image instrument / 01</Badge>
            <h1>A little noise.<br />A new image.</h1>
            <p>Drop an image here, paste from your clipboard, or upload to begin. Build a stack. Make a print.</p>
            <Button tone="orange" onClick={() => imageInputRef.current?.click()}>Choose an image <Upload size={18} /></Button>
            <small>PNG / JPEG / WEBP · up to 32 megapixels</small>
          </Panel>
        )}
        <div hidden={!source} className={`canvasWrap ${renderState === "stale" ? "isStale" : ""}`}>
          <canvas ref={canvasRef} role="img" aria-label={compare ? "Original source image" : "Processed image preview"} />
          {renderState === "stale" && <span className="staleFlag">STALE PREVIEW / RENDERING {isInteracting ? "DRAFT" : quality.toUpperCase()}</span>}
        </div>
        <div className="readout">{previewSize} · {(zoom * 100).toFixed(0)}% · {isInteracting ? "DRAFT" : quality.toUpperCase()} · {renderMs.toFixed(1)} MS</div>
        <div className="viewtools" aria-label="Zoom controls">
          <Button size="sm" onClick={() => setZoom(1)}>100%</Button>
          <Button size="sm" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))} aria-label="Zoom out">
            −
          </Button>
          <Button size="sm" onClick={() => setZoom((z) => Math.min(8, z + 0.1))} aria-label="Zoom in">
            +
          </Button>
          <Button size="sm"
            onClick={() =>
              setZoom(
                Math.min(
                  1,
                  (document.querySelector<HTMLElement>(".viewport")!.clientWidth - 64) / (preview?.width ?? 900),
                  (document.querySelector<HTMLElement>(".viewport")!.clientHeight - 160) / (preview?.height ?? 900),
                ),
              )
            }
          >
            Fit
          </Button>
        </div>
      </section>

      <aside className="right panel">
        <Panel className="module">
          <h2><i>04</i> Ordered stage stack</h2>
          {pipeline.map((stage, index) => (
            <div
              className={`stage ${selectedStage?.id === stage.id ? "active" : ""}`}
              key={stage.id}
            >
              <Button size="sm" aria-label={`Toggle stage ${index + 1}`} aria-pressed={stage.enabled}
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
              </Button>
              <Button size="sm" className="stageSelect" aria-pressed={selectedStage?.id === stage.id} onClick={() => setSelectedStageId(stage.id)}>
                {index + 1}. {processorRegistry[stage.type].name}
              </Button>
              <Button size="sm" aria-label={`Lock stage ${index + 1}`} aria-pressed={stage.locked}
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
              </Button>
              <Button size="sm" aria-label={`Move stage ${index + 1} up`} disabled={index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  moveStage(stage.id, -1);
                }}
              >
                Up
              </Button>
              <Button size="sm" aria-label={`Move stage ${index + 1} down`} disabled={index === pipeline.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  moveStage(stage.id, 1);
                }}
              >
                Dn
              </Button>
              <Button size="sm" aria-label={`Duplicate stage ${index + 1}`} disabled={pipeline.length >= MAX_STAGE_COUNT}
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
              </Button>
              <Button size="sm" aria-label={`Delete stage ${index + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  updatePipeline(pipeline.filter((s) => s.id !== stage.id));
                }}
              >
                Del
              </Button>
            </div>
          ))}
        </Panel>
        {selectedStage && (
          <Panel className="module">
            <h2>{processorRegistry[selectedStage.type].name}</h2>
            <p className="desc">
              {processorRegistry[selectedStage.type].description}
            </p>
            {Object.entries(processorRegistry[selectedStage.type].params).map(
              ([key, meta]) => {
                const value = selectedStage.params[key] ?? meta.default;
                return (
                  <div className="control" key={key} title={meta.description}>
                    <span>
                      <label htmlFor={`param-${key}`}>{meta.label}</label>
                      <Button size="sm" aria-label={`Lock ${meta.label}`} aria-pressed={Boolean(selectedStage.locks?.[key])} onClick={() => lockParam(selectedStage.id, key)}>
                        {selectedStage.locks?.[key] ? (
                          <Lock size={11} />
                        ) : (
                          <LockOpen size={11} />
                        )}
                      </Button>
                    </span>
                    {meta.type === "number" && (
                      <>
                        <input
                          className="sh-range"
                          aria-label={`${meta.label} slider`}
                          type="range"
                          min={meta.min}
                          max={meta.max}
                          step={meta.step}
                          value={Number(value)}
                          onPointerDown={beginInteraction}
                          onPointerUp={endInteraction}
                          onPointerCancel={endInteraction}
                          onBlur={endInteraction}
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
                          className="sh-input"
                          id={`param-${key}`}
                          min={meta.min} max={meta.max} step={meta.step}
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
                        id={`param-${key}`}
                        className="sh-switch"
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
                        id={`param-${key}`}
                        className="sh-input"
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
                        id={`param-${key}`} className="sh-input"
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
                        id={`param-${key}`} className="sh-select"
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
                        id={`param-${key}`} className="sh-input"
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
                  </div>
                );
              },
            )}
            <Button size="sm"
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
            </Button>
            {source && (
              <Button size="sm"
                onClick={() =>
                  updateStageParam(
                    selectedStage.id,
                    "palette",
                    extractPalette(source, 6),
                  )
                }
              >
                Extract Palette
              </Button>
            )}
          </Panel>
        )}
      </aside>

      <footer className="status">
        <span role="status" aria-live="polite"><b>SYS</b> {status}</span>
        <span>SRC {sourceSize}</span>
        <span>PREV {previewSize}</span>
        <span>EXPORT {sourceSize}</span>
        <span>RENDER {renderMs.toFixed(1)} MS</span>
        <span>MEM {formatBytes(memory + (metrics?.cacheBytes ?? 0))}</span>
        <span>ZOOM {(zoom * 100).toFixed(0)}%</span>
        <span>SEED {seed}</span>
        <span>CACHE {metrics ? `${metrics.cacheHits}H/${metrics.cacheMisses}M` : "COLD"}</span>
        <span>WORKER {renderState === "error" ? "ERROR" : renderState === "ready" ? "IDLE" : "ACTIVE"}</span>
        <span>
          {memory > MAX_CHECKPOINT_MEMORY ? "memory warning" : "stable"}
        </span>
      </footer>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen} title="Save your stack" description="Keep this preset in this browser. Export JSON for a portable copy." footer={<Button tone="orange" disabled={!savedName.trim()} onClick={savePreset}>Save preset</Button>}>
        <form onSubmit={(event) => { event.preventDefault(); savePreset(); }}>
          <TextField label="Preset name" autoFocus value={savedName} onChange={(event) => setSavedName(event.target.value)} />
        </form>
      </Dialog>
    </main>
  );
}
