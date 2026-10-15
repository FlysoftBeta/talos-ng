import { useState } from "react";
import type { ReactElement } from "react";
import { TalosProvider } from "../ui/theme/theme.tsx";
import { Button, IconButton } from "../ui/actions/button.tsx";
import { SelectField } from "../ui/inputs/select-field.tsx";
import { Dialog, Sheet } from "../ui/overlays/overlays.tsx";
import { Menu } from "../ui/overlays/menu.tsx";
import { HelpTip } from "../ui/feedback/help-tip.tsx";

/** Adversarial layout composed from production primitives; no feature models. */
export function OverlayBench({
  dark = false,
}: {
  dark?: boolean;
}): ReactElement {
  const [modal, setModal] = useState<"dialog" | "sheet" | null>(null);
  const [nested, setNested] = useState(false);
  const [value, setValue] = useState("0");
  const content = (
    <>
      <div
        data-testid="dev.overlay.clip"
        style={{
          height: 100,
          overflow: "auto",
          transform: "translateX(0)",
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ height: 400, padding: 8 }}>
          <div data-testid="dev.overlay.anchor" style={{ width: 160 }}>
            <SelectField
              label="共享范围"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            >
              {Array.from({ length: 30 }, (_, i) => (
                <option key={i} value={String(i)} disabled={i === 1}>
                  范围 {i}
                </option>
              ))}
            </SelectField>
          </div>
          <IconButton label="图标说明" icon="info" />
        </div>
      </div>
      <div
        data-testid="dev.overlay.tools"
        style={{
          height: 44,
          overflow: "hidden",
          transform: "translateX(0)",
          marginTop: 8,
        }}
      >
        <IconButton label="被裁切的图标说明" icon="info" />
        <HelpTip text="这段详细说明应当完整显示在滚动区域外，保持可读。" />
        <Menu
          label="操作菜单"
          items={[
            { label: "打开子对话框", onSelect: () => setNested(true) },
            {
              label: "不可用的操作",
              disabledReason: "当前不可用",
              onSelect: () => {},
            },
            ...Array.from({ length: 18 }, (_, i) => ({
              label: `操作 ${i}`,
              onSelect: () => setValue(String(i)),
            })),
          ]}
        />
      </div>
      <Button
        data-testid="dev.overlay.next"
        style={{ float: "right", width: 70, padding: 4 }}
      >
        后续操作
      </Button>
      <output data-testid="dev.overlay.value">{value}</output>
    </>
  );
  const Modal = modal === "sheet" ? Sheet : Dialog;
  return (
    <TalosProvider mode={dark ? "dark" : "light"}>
      <div style={{ padding: 24 }}>
        <Button onClick={() => setModal("dialog")}>打开对话框</Button>
        <Button onClick={() => setModal("sheet")}>打开侧栏</Button>
        {!modal && (
          <div
            data-testid="dev.overlay.page"
            style={{ position: "absolute", right: 8, bottom: 8, width: 180 }}
          >
            {content}
          </div>
        )}
      </div>
      <Modal
        open={!!modal}
        title="浮层验证"
        onClose={() => setModal(null)}
        footer={
          <Menu
            label="页脚操作"
            items={[{ label: "页脚选项", onSelect: () => {} }]}
          />
        }
      >
        {content}
      </Modal>
      <Dialog open={nested} title="子对话框" onClose={() => setNested(false)}>
        <Button>子操作</Button>
      </Dialog>
    </TalosProvider>
  );
}
