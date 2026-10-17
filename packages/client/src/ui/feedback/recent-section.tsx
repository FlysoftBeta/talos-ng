import type { ReactElement, ReactNode } from "react";
import { SectionHeader } from "../layout/index.ts";
import { ListRow } from "./feedback.tsx";

export interface RecentItemView {
  id: string;
  title: string;
  hint?: string;
  leading?: ReactNode;
  selected?: boolean;
  onOpen(): void;
}
/** A titled run of rows (recent or frequently opened items); renders nothing when empty. */
export function RecentSection({
  title,
  items,
}: {
  title: string;
  items: readonly RecentItemView[];
}): ReactElement | null {
  if (!items.length) return null;
  return (
    <section aria-label={title}>
      <SectionHeader title={title} />
      {items.map((item) => (
        <ListRow
          key={item.id}
          title={item.title}
          hint={item.hint}
          selected={item.selected}
          leading={item.leading}
          onClick={item.onOpen}
        />
      ))}
    </section>
  );
}
