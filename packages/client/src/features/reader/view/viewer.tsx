import { characterAt, characterTop } from "../adapters/anchor.ts";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ReactElement } from "react";
import type { Unit } from "@talos/docpack";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import { VirtualListCore } from "../../../ui/virtual/index.ts";
import { estimateUnit } from "../model/resources.ts";
import type { DocumentResources } from "../model/resources.ts";
import type { ReaderPosition } from "../model/reading-session.ts";
import { FRAME_DOCUMENT, sanitizePage } from "../adapters/page-frame.ts";
function ReaderUnit({
  unit,
  resources,
  width,
  zoom,
  onMeasure,
  onScroll,
  onReady,
}: {
  unit: Unit;
  resources: DocumentResources;
  width: number;
  zoom: string;
  onMeasure: (height: number) => void;
  onScroll: (delta: number) => void;
  onReady: (element: HTMLElement) => void;
}): ReactElement {
  const [value, setValue] =
      useState<Awaited<ReturnType<DocumentResources["unit"]>>>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [ready, setReady] = useState(false);
  const host = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLIFrameElement>(null);
  const paged = resources.document.manifest.kind === "paged",
    scale =
      zoom === "fit"
        ? Math.max(100, width - 32) / (unit.w ?? 750)
        : Number(zoom);
  useEffect(() => {
    let closed = false;
    const controller = new AbortController();
    void resources
      .unit(unit, controller.signal)
      .then((result) => {
        if (!closed) {
          setValue(result);
          setError("");
        }
      })
      .catch((e) => {
        if (!closed) setError(e instanceof Error ? e.message : "读取失败");
      });
    return () => {
      closed = true;
      controller.abort();
    };
  }, [resources, unit, retry]);
  useLayoutEffect(() => {
    if (host.current) {
      onMeasure(host.current.getBoundingClientRect().height);
      const flow = host.current.querySelector<HTMLElement>(".reader-flow");
      if (flow) onReady(flow);
    }
  }, [value, error, width, zoom]);
  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as {
        type?: string;
        y?: number;
        message?: string;
      };
      if (data?.type === "talos-frame-ready" && value) {
        try {
          const html = sanitizePage(
            value.text,
            new Map(value.resources.map((r) => [r.rid, { mime: r.mime }])),
          );
          const buffers = value.resources.map((r) => ({
            ...r,
            bytes: r.bytes.slice(0),
          }));
          frame.current!.contentWindow!.postMessage(
            { type: "talos-page", html, resources: buffers },
            "*",
            buffers.map((r) => r.bytes),
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : "页面格式错误");
        }
      }
      if (data?.type === "talos-page-ready") setReady(true);
      if (data?.type === "talos-page-error")
        setError(data.message ?? "页面载入失败");
      if (
        data?.type === "talos-scroll" &&
        typeof data.y === "number" &&
        Number.isFinite(data.y)
      )
        onScroll(Math.max(-2000, Math.min(2000, data.y)));
    };
    window.addEventListener("message", message);
    return () => window.removeEventListener("message", message);
  }, [value, onScroll]);
  const height = paged ? Math.ceil((unit.h ?? 1000) * scale) : undefined,
    pageWidth = (unit.w ?? 750) * scale;
  return (
    <div
      ref={host}
      data-reader-unit={unit.ordinal}
      className={paged ? "reader-unit is-paged" : "reader-unit"}
      style={paged ? { height: (height ?? 0) + 24 } : undefined}
    >
      {error === "离线未缓存" ? (
        <div
          className="reader-missing"
          style={paged ? { width: pageWidth, height } : undefined}
        >
          <Icon name="cloud-alert" size={18} />
          <span>未下载</span>
        </div>
      ) : error ? (
        <div
          className="reader-missing is-error"
          style={paged ? { width: pageWidth, height } : undefined}
        >
          <Icon name="error" size={18} />
          <span>{error}</span>
          <Button
            variant="ghost"
            size="small"
            onClick={() => setRetry(retry + 1)}
          >
            重试
          </Button>
        </div>
      ) : !value ? (
        paged ? (
          <div
            className="reader-page is-loading"
            style={{ width: pageWidth, height }}
          />
        ) : (
          <div
            style={{
              height: estimateUnit(
                resources.document.manifest,
                unit,
                width,
                zoom,
              ),
            }}
          >
            <StatePanel state="loading" />
          </div>
        )
      ) : paged ? (
        <div className="reader-page" style={{ width: pageWidth, height }}>
          <iframe
            ref={frame}
            title={`文档第 ${unit.ordinal + 1} 页`}
            sandbox="allow-scripts"
            srcDoc={FRAME_DOCUMENT}
            data-page-ready={ready ? "true" : "false"}
            scrolling="no"
            style={{
              width: unit.w ?? 750,
              height: unit.h ?? 1000,
              transform: `scale(${scale})`,
            }}
          />
        </div>
      ) : (
        <div className="reader-flow" data-testid="reader.flow">
          {value.text}
        </div>
      )}
    </div>
  );
}
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
export function ReaderViewer({
  resources,
  initial,
  zoom,
  onZoom,
  onPosition,
  readingTime,
}: {
  resources: DocumentResources;
  initial: ReaderPosition;
  zoom: string;
  onZoom: (zoom: string) => void;
  onPosition: (position: ReaderPosition) => void;
  /** Total reading time, shown in the completion footer. */
  readingTime: string;
}): ReactElement {
  const viewport = useRef<HTMLDivElement>(null),
    [size, setSize] = useState({ width: 800, height: 600 }),
    [, refresh] = useReducer((n: number) => n + 1, 0),
    [jump, setJump] = useState<string>();
  const units = resources.document.manifest.units;
  const core = useMemo(
    () =>
      new VirtualListCore<number>({ estimatedItemHeight: 1000, overscan: 600 }),
    [resources],
  );
  const position = useRef(initial),
    restored = useRef(false),
    restoring = useRef<number | undefined>(undefined),
    callback = useRef(onPosition);
  callback.current = onPosition;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const measure = () =>
      setSize({
        width: Math.max(100, node.clientWidth),
        height: Math.max(200, node.clientHeight),
      });
    measure();
    window.addEventListener("resize", measure);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : undefined;
    observer?.observe(node);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    core.setItems(units.map((unit) => unit.ordinal));
    core.setViewport(0, size.height);
    units.forEach((unit, i) =>
      core.measure(
        i,
        estimateUnit(resources.document.manifest, unit, size.width, zoom),
      ),
    );
    const anchored = units.findIndex(
      (unit) => unit.id === position.current.unitId,
    );
    const target = Math.min(
      units.length - 1,
      anchored >= 0 ? anchored : position.current.unit,
    );
    position.current.unit = target;
    if (target >= 0)
      core.setViewport(
        core.offsetOf(target) + position.current.offset,
        size.height,
      );
    if (viewport.current) {
      restoring.current = core.offset;
      viewport.current.scrollTop = core.offset;
    }
    restored.current = true;
    refresh();
  }, [core, resources, size.width, size.height, zoom]);
  const scroll = (delta: number) => {
    if (viewport.current) viewport.current.scrollTop += delta;
  };
  const go = (page: number) => {
    const value = Math.min(units.length - 1, Math.max(0, page - 1));
    if (Number.isInteger(value) && viewport.current) {
      core.scrollToIndex(value, "start");
      viewport.current.scrollTop = core.offset;
      refresh();
    }
  };
  const paged = resources.document.manifest.kind === "paged",
    fit = Math.max(100, size.width - 32) / (units[0]?.w ?? 750),
    scale = zoom === "fit" ? fit : Number(zoom),
    larger = ZOOM_STEPS.filter((step) => step > scale + 0.01),
    smaller = ZOOM_STEPS.filter((step) => step < scale - 0.01);
  const range = core.range();
  const rows: ReactElement[] = [];
  for (let i = range.start; i < Math.min(range.end, units.length); i++)
    rows.push(
      <ReaderUnit
        key={units[i]!.id}
        unit={units[i]!}
        resources={resources}
        width={size.width}
        zoom={zoom}
        onScroll={scroll}
        onReady={(element) => {
          if (i !== position.current.unit || !viewport.current) return;
          // Legacy pixel positions migrate once their text has been laid out.
          const charOffset =
            position.current.charOffset ??
            characterAt(element, position.current.offset);
          position.current = {
            ...position.current,
            unitId: units[i]!.id,
            charOffset,
          };
          const offset =
            element.getBoundingClientRect().top -
            element.parentElement!.getBoundingClientRect().top +
            characterTop(element, charOffset);
          position.current.offset = Math.round(offset);
          core.setViewport(core.offsetOf(i) + offset, size.height);
          restoring.current = core.offset;
          viewport.current.scrollTop = core.offset;
          callback.current(position.current);
        }}
        onMeasure={(height) => {
          if (height > 0 && core.sizeOf(i) !== height) {
            core.measure(i, height);
            if (viewport.current) viewport.current.scrollTop = core.offset;
            refresh();
          }
        }}
      />,
    );
  return (
    <div className={`reader-stage${paged ? " is-paged" : ""}`}>
      <div
        ref={viewport}
        className="reader-scroll"
        data-testid="reader.scroll"
        tabIndex={0}
        role="region"
        aria-label="文档阅读区"
        onScroll={(event) => {
          if (!restored.current) return;
          if (
            restoring.current !== undefined &&
            Math.abs(event.currentTarget.scrollTop - restoring.current) < 1
          ) {
            restoring.current = undefined;
            refresh();
            return;
          }
          restoring.current = undefined;
          core.setViewport(event.currentTarget.scrollTop, size.height);
          const unit = core.range(0).start;
          position.current = {
            unit,
            offset: Math.round(core.offset - core.offsetOf(unit)),
          };
          const flow = event.currentTarget.querySelector<HTMLElement>(
            `[data-reader-unit="${unit}"] .reader-flow`,
          );
          if (flow) {
            position.current.unitId = units[unit]!.id;
            position.current.charOffset = characterAt(
              flow,
              event.currentTarget.getBoundingClientRect().top -
                flow.getBoundingClientRect().top,
            );
          }
          callback.current(position.current);
          refresh();
        }}
      >
        <div style={{ height: range.total, position: "relative" }}>
          <div
            style={{ position: "absolute", left: 0, right: 0, top: range.top }}
          >
            {rows}
            {range.end >= units.length && (
              <div className="reader-end">
                <span className="reader-end-mark">
                  <Icon name="check" size={18} />
                </span>
                <strong>已读完</strong>
                <span>阅读 {readingTime}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      {paged && (
        <div className="reader-controls" role="toolbar" aria-label="页面控制">
          <IconButton
            label="缩小"
            icon="zoom-out"
            disabled={!smaller.length}
            onClick={() => onZoom(String(smaller[smaller.length - 1]))}
          />
          <span className="reader-zoom">{Math.round(scale * 100)}%</span>
          <IconButton
            label="放大"
            icon="zoom"
            disabled={!larger.length}
            onClick={() => onZoom(String(larger[0]))}
          />
          {zoom !== "fit" && (
            <IconButton
              label="适合宽度"
              icon="expand"
              onClick={() => onZoom("fit")}
            />
          )}
          <span className="reader-controls-sep" aria-hidden="true" />
          <input
            className="reader-page-input"
            aria-label="跳转页码"
            type="number"
            min={1}
            max={units.length}
            value={
              jump ?? String(Math.min(units.length, position.current.unit + 1))
            }
            onFocus={(e) => {
              setJump(
                String(Math.min(units.length, position.current.unit + 1)),
              );
              e.currentTarget.select();
            }}
            onChange={(e) => setJump(e.target.value)}
            onBlur={() => {
              if (jump) go(Number(jump));
              setJump(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                go(Number(jump));
                setJump(undefined);
                e.currentTarget.blur();
              }
            }}
          />
          <span className="reader-position" data-testid="reader.position">
            / {units.length}
          </span>
        </div>
      )}
    </div>
  );
}
