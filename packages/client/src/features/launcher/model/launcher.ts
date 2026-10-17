import { LauncherSelection } from "./selection.ts";
import type { LauncherItem } from "./selection.ts";

export interface LauncherView {
  items: readonly LauncherItem[];
  selectedId: string | undefined;
}
/** The floating window: a picture-in-picture video fed from a canvas. */
export interface LauncherSurface {
  /** Opens the window; must run inside the user gesture that asked for it. */
  enter(): Promise<void>;
  leave(): void;
  render(view: LauncherView): void;
  /** Registers the callback for the user closing the window; returns a remover. */
  onLeave(callback: () => void): () => void;
  /** Registers the callback for the window's play/pause control (a click). */
  onClick(callback: () => void): () => void;
}
/** Transport controls (Media Session) mapped to launcher actions; returns the unbinder. */
export interface LauncherActions {
  bind(handlers: { click(): void; next(): void; previous(): void }): () => void;
  describe(item: LauncherItem | undefined): void;
}

/** Owns the open/closed state, the selection and the redraw; the browser is behind ports. */
export class LauncherController {
  readonly selection = new LauncherSelection();
  private active = false;
  private listeners = new Set<() => void>();
  private teardown: (() => void)[] = [];
  constructor(
    private readonly surface: LauncherSurface,
    private readonly actions: LauncherActions,
    private readonly open: (item: LauncherItem) => void,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  isActive = (): boolean => this.active;

  setItems(items: readonly LauncherItem[]): void {
    this.selection.setItems(items);
    this.refresh();
  }
  async start(): Promise<void> {
    if (this.active) return;
    await this.surface.enter();
    this.active = true;
    this.teardown = [
      this.surface.onLeave(() => this.stop()),
      this.surface.onClick(() => this.click()),
      this.actions.bind({
        click: () => this.click(),
        next: () => this.step(1),
        previous: () => this.step(-1),
      }),
    ];
    this.refresh();
    this.emit();
  }
  stop(): void {
    if (!this.active) return;
    this.active = false;
    for (const undo of this.teardown) undo();
    this.teardown = [];
    this.surface.leave();
    this.actions.describe(undefined);
    this.emit();
  }
  step(delta: 1 | -1): void {
    this.selection.step(delta);
    this.refresh();
  }
  /** Opens the highlighted entry. */
  click(): void {
    const item = this.selection.selected();
    if (item) this.open(item);
  }
  private refresh(): void {
    if (!this.active) return;
    this.surface.render({
      items: this.selection.items,
      selectedId: this.selection.selectedId,
    });
    this.actions.describe(this.selection.selected());
  }
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
