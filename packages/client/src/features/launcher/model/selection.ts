/** What the floating launcher can open. */
export interface LauncherItem {
  id: string;
  /** Shortcuts to the app's areas, or recently opened content. */
  group: "app" | "recent";
  title: string;
  hint: string;
}

/**
 * The launcher's highlighted entry. It cycles through the items in order and wraps
 * around; a refreshed item list keeps the highlight on the same id while it exists.
 */
export class LauncherSelection {
  private list: readonly LauncherItem[] = [];
  private current: string | undefined;

  get items(): readonly LauncherItem[] {
    return this.list;
  }
  get selectedId(): string | undefined {
    return this.current;
  }
  selected(): LauncherItem | undefined {
    return this.list.find((item) => item.id === this.current);
  }
  setItems(items: readonly LauncherItem[]): void {
    this.list = items;
    if (!items.some((item) => item.id === this.current))
      this.current = items[0]?.id;
  }
  /** Moves the highlight by one entry, wrapping at both ends. */
  step(delta: 1 | -1): void {
    const count = this.list.length;
    if (!count) return;
    const at = this.list.findIndex((item) => item.id === this.current);
    this.current = this.list[(Math.max(at, 0) + delta + count) % count]!.id;
  }
}
