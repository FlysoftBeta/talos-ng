import { useMemo, useState } from "react";
import { DataGrid, SelectionActionBar } from "../ui/data-grid/index.ts";
import type { DataGridColumn } from "../ui/data-grid/index.ts";
import { DurationInput } from "../ui/inputs/index.ts";
import { HelpTip } from "../ui/feedback/index.ts";
import { TalosProvider } from "../ui/theme/index.ts";

interface DemoRow {
  id: string;
  name: string;
  status: string;
  note: string;
}
const rows: readonly DemoRow[] = Array.from(
  { length: 100_000 },
  (_, index) => ({
    id: String(index + 1),
    name: `${index % 4 === 0 ? "一段比较长的中文用户姓名" : "用户"}${index + 1}`,
    status: index % 7 === 0 ? "已停用" : "正常",
    note: `第 ${index + 1} 位用户的完整资料。这里展示较长的中文内容，以检验省略与展开。`,
  }),
);
const columns: readonly DataGridColumn<DemoRow>[] = [
  {
    id: "id",
    label: "编号",
    width: 100,
    render: (row) => row.id,
    sortable: true,
    pinned: "start",
  },
  {
    id: "name",
    label: "姓名",
    width: 180,
    render: (row) => row.name,
    sortable: true,
  },
  { id: "status", label: "状态", width: 100, render: (row) => row.status },
  {
    id: "note",
    label: "备注",
    width: 320,
    render: (row) => row.note,
    longText: (row) => row.note,
  },
  {
    id: "actions",
    label: "操作",
    width: 90,
    render: () => "查看",
    pinned: "end",
  },
];
export function DataGridGallery({ mode }: { mode: "light" | "dark" }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{
    columnId: string;
    direction: "asc" | "desc";
  }>({ columnId: "id", direction: "asc" });
  const [minutes, setMinutes] = useState(1440);
  const filtered = useMemo(() => {
    const matches = query
      ? rows.filter((row) => row.name.includes(query) || row.id.includes(query))
      : rows;
    if (sort.columnId === "id" && sort.direction === "asc") return matches;
    const ordered = [...matches];
    ordered.sort((a, b) => {
      const value =
        sort.columnId === "name"
          ? a.name.localeCompare(b.name, "zh-CN")
          : Number(a.id) - Number(b.id);
      return sort.direction === "asc" ? value : -value;
    });
    return ordered;
  }, [query, sort]);
  return (
    <TalosProvider mode={mode}>
      <main style={{ maxWidth: 1120, margin: "20px auto", padding: "0 16px" }}>
        <h1>管理数据表</h1>
        <p>100 000 行虚拟列表 · 36 px 紧凑行</p>
        <DataGrid
          rows={filtered}
          columns={columns}
          rowKey={(row) => row.id}
          height={540}
          search={{ value: query, onChange: setQuery }}
          sort={{
            ...sort,
            onChange: (columnId, direction) => setSort({ columnId, direction }),
          }}
          selection={{ selectedKeys: selected, onChange: setSelected }}
        />
        <div style={{ marginTop: 16 }}>
          <SelectionActionBar
            count={selected.size}
            onClear={() => setSelected(new Set())}
          >
            <span>批量操作</span>
          </SelectionActionBar>
        </div>
        <div style={{ marginTop: 16 }}>
          <DurationInput
            minutes={minutes}
            onChange={setMinutes}
            units={["days", "hours", "minutes"]}
            max={31 * 1440 - 1}
          />{" "}
          <HelpTip text="最长 30 天 23 小时 59 分钟。" />
        </div>
      </main>
    </TalosProvider>
  );
}
