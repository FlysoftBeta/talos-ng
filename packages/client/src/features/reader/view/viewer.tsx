import { characterAt, characterTop } from "../adapters/anchor.ts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { Unit } from "@talos/docpack";
import { ArraySource, Scroller } from "@talos/virtual";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import { VirtualScroller } from "../../../ui/virtual/index.ts";
import { estimateUnit } from "../model/resources.ts";
import type { DocumentResources } from "../model/resources.ts";
import type { ReaderPosition } from "../model/reading-session.ts";
import { FRAME_DOCUMENT, sanitizePage } from "../adapters/page-frame.ts";
function ReaderUnit({
  unit,
  resources,
  width,
  zoom,
  onScroll,
  onReady,
}: {
  unit: Unit;
  resources: DocumentResources;
  width: number;
  zoom: string;
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
    const flow = host.current?.querySelector<HTMLElement>(".reader-flow");
    if (flow) onReady(flow);
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
/** One unit with its size estimate for the current width and zoom. */
interface Page {
  unit: Unit;
  ordinal: number;
  size: number;
}
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
  const stage = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(800),
    [current, setCurrent] = useState(0),
    [jump, setJump] = useState<string>();
  const manifest = resources.document.manifest;
  const units = manifest.units;
  const pages = useMemo(
    () =>
      units.map((unit, ordinal) => ({
        unit,
        ordinal,
        size: estimateUnit(manifest, unit, width, zoom),
      })),
    [manifest, units, width, zoom],
  );
  const { source, scroller } = useMemo(() => {
    const source = new ArraySource<Page>(
      {
        key: (page) => page.unit.id,
        size: (page) => page.size,
        equals: (a, b) => a.size === b.size,
      },
      pages,
    );
    return {
      source,
      scroller: new Scroller<Page>(source, { estimate: 1000, overscan: 600 }),
    };
    // A new document gets a new scroller; later sizes arrive through `source.set`.
  }, [resources]);
  const callback = useRef(onPosition);
  callback.current = onPosition;
  /** A saved position still to be refined to its character once the text is laid out. */
  const restore = useRef<ReaderPosition & { unitId: string }>(undefined);
  const scrollElement = () =>
    stage.current?.querySelector<HTMLElement>('[data-testid="reader.scroll"]');
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(100, node.clientWidth));
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
    if (!units.length) return;
    const anchored = units.findIndex((unit) => unit.id === initial.unitId);
    const ordinal = Math.min(
      units.length - 1,
      anchored >= 0 ? anchored : Math.max(0, initial.unit),
    );
    const unitId = units[ordinal]!.id;
    restore.current = { ...initial, unit: ordinal, unitId };
    setCurrent(ordinal);
    void scroller.start({ id: unitId, offset: -initial.offset });
    return () => scroller.dispose();
    // The saved position is read once per document.
  }, [scroller]);
  // New estimates (width or zoom) keep the first visible unit at the same relative depth.
  const shown = useRef(pages);
  useLayoutEffect(() => {
    const previous = shown.current;
    if (previous === pages) return;
    shown.current = pages;
    const at = scroller.position();
    source.set(pages);
    if (!at || restore.current) return;
    const before = previous.find((page) => page.unit.id === at.id)?.size;
    const after = pages.find((page) => page.unit.id === at.id)?.size;
    if (before && after && before !== after)
      void scroller.jump({ id: at.id, offset: (at.offset * after) / before });
  }, [pages, scroller, source]);
  useEffect(
    () =>
      scroller.observe(() => {
        // Placements (opening, jumping, zooming) are ours; only reading moves the position.
        if (scroller.placing()) return;
        const at = scroller.position();
        const page = at && pages.find((value) => value.unit.id === at.id);
        if (!at || !page) return;
        const position: ReaderPosition = {
          unit: page.ordinal,
          offset: Math.round(-at.offset),
          unitId: at.id,
        };
        const view = scrollElement();
        const flow = view?.querySelector<HTMLElement>(
          `[data-reader-unit="${page.ordinal}"] .reader-flow`,
        );
        if (view && flow)
          position.charOffset = characterAt(
            flow,
            view.getBoundingClientRect().top - flow.getBoundingClientRect().top,
          );
        setCurrent(page.ordinal);
        callback.current(position);
      }),
    [scroller, pages],
  );
  const go = (page: number) => {
    const value = Math.min(units.length - 1, Math.max(0, page - 1));
    if (Number.isInteger(value) && units[value])
      void scroller.jump({ id: units[value]!.id, align: "start" });
  };
  const paged = manifest.kind === "paged",
    fit = Math.max(100, width - 32) / (units[0]?.w ?? 750),
    scale = zoom === "fit" ? fit : Number(zoom),
    larger = ZOOM_STEPS.filter((step) => step > scale + 0.01),
    smaller = ZOOM_STEPS.filter((step) => step < scale - 0.01);
  return (
    <div ref={stage} className={`reader-stage${paged ? " is-paged" : ""}`}>
      <VirtualScroller
        scroller={scroller}
        className="reader-scroll"
        testId="reader.scroll"
        role="region"
        itemRole="presentation"
        label="文档阅读区"
        renderItem={(page) => (
          <ReaderUnit
            unit={page.unit}
            resources={resources}
            width={width}
            zoom={zoom}
            onScroll={(delta) => scroller.scrollBy(delta)}
            onReady={(element) => {
              const pending = restore.current;
              if (!pending || pending.unitId !== page.unit.id) return;
              restore.current = undefined;
              // Legacy pixel positions migrate once their text has been laid out.
              const charOffset =
                pending.charOffset ?? characterAt(element, pending.offset);
              const offset = Math.round(
                element.getBoundingClientRect().top -
                  element.parentElement!.getBoundingClientRect().top +
                  characterTop(element, charOffset),
              );
              void scroller.jump({ id: page.unit.id, offset: -offset });
              callback.current({
                unit: page.ordinal,
                offset,
                unitId: page.unit.id,
                charOffset,
              });
            }}
          />
        )}
        renderEdge={(direction, edge) =>
          direction === "after" && !edge.more && units.length ? (
            <div className="reader-end">
              <span className="reader-end-mark">
                <Icon name="check" size={18} />
              </span>
              <strong>已读完</strong>
              <span>阅读 {readingTime}</span>
            </div>
          ) : null
        }
      />
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
            value={jump ?? String(Math.min(units.length, current + 1))}
            onFocus={(e) => {
              setJump(String(Math.min(units.length, current + 1)));
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
