import { NumPad } from "../features/auth/index.ts";
import type { StatusViewModel } from "../core/status/model.ts";
import { useMemo, useReducer, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createNav, navReducer, AREA_IDS } from "../core/navigation/index.ts";
import type { AreaId } from "../core/navigation/index.ts";
import {
  AppFrame,
  Pane,
  PaneHeader,
  Toolbar,
  SectionHeader,
  Stack,
  Inline,
  CompactToolbar,
  KeyValue,
  Tag,
} from "../ui/layout/index.ts";
import { Rail, RailItem, Segmented, Tabs } from "../ui/navigation/index.ts";
import { Icon } from "../ui/icon/index.ts";
import { Button, IconButton } from "../ui/actions/index.ts";
import {
  FileButton,
  SharedComposer,
  Field,
  TextArea,
  SelectField,
} from "../ui/inputs/index.ts";
import {
  ListRow,
  StatePanel,
  StatusPill,
  StatusCenter,
  Skeleton,
  OfflineHint,
  Mark,
  Toast,
  BannerHost,
} from "../ui/feedback/index.ts";
import { Sheet, Dialog, ConfirmDialog } from "../ui/overlays/index.ts";
import { VirtualList } from "../ui/virtual/index.ts";
import { TalosProvider } from "../ui/theme/index.ts";
import type { ColorMode } from "../ui/theme/index.ts";
import type { VirtualListHandle } from "../ui/virtual/index.ts";
import type { PanelState } from "../ui/feedback/index.ts";
const areaNames: Record<AreaId, string> = {
  chat: "对话",
  library: "阅读",
  learning: "学习",
  media: "音乐",
  ai: "AI",
};
const rows = Array.from({ length: 50000 }, (_, index) => ({
  id: index,
  title: `${String(index + 1).padStart(5, "0")} · 给未来的一封信`,
  hint:
    index % 7 === 0
      ? "在长长的中文标题中寻找清晰的节奏，让每一条内容都有自己的位置。"
      : "本机内容 · 随时可读",
}));
const keyOf = (item: (typeof rows)[number]) => item.id;
export function Showcase({
  gallery = false,
  update,
}: {
  gallery?: boolean;
  update?: StatusViewModel["update"];
}) {
  const preferences = useMemo(
    () =>
      createStore<{ mode: ColorMode }>(() => ({
        mode:
          new URLSearchParams(location.search).get("theme") === "dark"
            ? "dark"
            : "light",
      })),
    [],
  );
  const mode = useStore(preferences, (state) => state.mode);
  const [nav, dispatch] = useReducer(navReducer, undefined, createNav);
  const [overlay, setOverlay] = useState<
    "status" | "sheet" | "dialog" | "confirm" | "announcement" | null
  >(null);
  const [updatePreview, setUpdatePreview] =
    useState<StatusViewModel["update"]["state"]>("none");
  const [toast, setToast] = useState(false);
  const [detail, setDetail] = useState(true);
  const [number, setNumber] = useState("");
  const virtual = useRef<VirtualListHandle>(null);
  const status: StatusViewModel = {
    connection: "connected",
    lastSync: "刚刚",
    pending: 2,
    failed: 1,
    operations: [
      {
        id: "1",
        title: "发送到「午后读书会」",
        state: "pending",
        discard: () => setToast(true),
      },
      {
        id: "2",
        title: "保存阅读笔记",
        state: "failed",
        retry: () => setToast(true),
        discard: () => setToast(true),
      },
    ],
    downloads: [{ id: "book", title: "给未来的一封信", progress: 0.68 }],
    storage: "128 MB / 2 GB",
    build: __BUILD_ID__,
    update: gallery
      ? {
          state: updatePreview,
          progress: 0.45,
          apply: updatePreview === "ready" ? () => setToast(true) : undefined,
        }
      : update || { state: "none" },
  };
  const close = () => setOverlay(null);
  const list = (
    <div id="talos-list">
      <div className="gallery-list-heading">
        <div className="gallery-eyebrow">TALOS II</div>
        <h2>{gallery ? "设计系统" : "我的空间"}</h2>
        <p>{gallery ? "安静的仪表盘 · 组件与状态" : "本机优先 · 随时继续"}</p>
      </div>
      <div className="gallery-list-section">工作空间</div>
      {[
        {
          title: "午后读书会",
          hint: "林同学：今天也有新的发现",
          selected: true,
        },
        { title: "班级公告", hint: "明天的课程安排已更新" },
        { title: "给自己的便笺", hint: "记录一个值得记住的瞬间" },
      ].map((item, index) => (
        <ListRow
          key={item.title}
          {...item}
          leading={<Icon name={index === 2 ? "library" : "chat"} />}
          trailing={index === 0 ? "12:48" : "昨天"}
          onClick={() => {
            dispatch({ type: "openConversation", id: String(index) });
            setDetail(true);
          }}
        />
      ))}
      <div className="gallery-list-section">本机内容</div>
      <ListRow
        title="最近阅读"
        hint="3 本书 · 已保存到本机"
        leading={<Icon name="library" />}
      />
      <ListRow
        title="学习记录"
        hint="今日已完成 24 个单词"
        leading={<Icon name="learning" />}
      />
      <div className="gallery-list-footer">
        <Stack>
          <StatusPill model={status} onClick={() => setOverlay("status")} />
          <p className="muted" style={{ fontSize: 12 }}>
            更改先保存在本机
            <br />
            连接恢复后继续同步
          </p>
        </Stack>
      </div>
    </div>
  );
  return (
    <TalosProvider mode={mode}>
      <div data-testid={gallery ? "dev.gallery" : "app.ready"}>
        <AppFrame
          rail={
            <Rail>
              <span
                style={{
                  fontSize: 20,
                  color: "var(--action)",
                  fontWeight: 700,
                  padding: "8px 0 16px",
                }}
              >
                T<span style={{ fontSize: 12 }}>Ⅱ</span>
              </span>
              {AREA_IDS.map((area) => (
                <RailItem
                  key={area}
                  label={areaNames[area]}
                  icon={<Icon name={area} />}
                  selected={nav.area === area}
                  badge={area === "chat" ? 3 : undefined}
                  onClick={() => dispatch({ type: "switchArea", area })}
                />
              ))}
              <div style={{ height: 24 }} />
              <RailItem
                label="任务"
                icon={<Icon name="tasks" />}
                onClick={() => setToast(true)}
              />
              <RailItem
                label="状态"
                icon={<Icon name="clock" />}
                onClick={() => setOverlay("status")}
              />
              <RailItem
                label="设置"
                icon={<Icon name="settings" />}
                onClick={() => setOverlay("sheet")}
              />
              <RailItem
                label="管理"
                icon={<Icon name="admin" />}
                disabledReason="当前账号没有管理权限"
              />
              <RailItem
                label="锁定"
                icon={<Icon name="lock" />}
                onClick={() => setToast(true)}
              />
            </Rail>
          }
          list={list}
          detail={detail}
          onBack={() => setDetail(false)}
        >
          <PaneHeader title="组件展示" />
          <header className="gallery-top">
            <div>
              <div className="gallery-eyebrow">
                {gallery ? "界面基础 / 01" : "欢迎回来"}
              </div>
              <h1>
                {gallery ? "清晰、有序，安心使用。" : "从这里，继续你的今天。"}
              </h1>
              <p>
                {gallery
                  ? "紧凑的布局，明确的状态，为每一次触碰留出空间。"
                  : "离线也能打开；每一项更改都有迹可循。"}
              </p>
            </div>
            <Inline>
              <StatusPill model={status} onClick={() => setOverlay("status")} />
              <Button
                variant="outlined"
                onClick={() =>
                  preferences.setState({
                    mode: mode === "light" ? "dark" : "light",
                  })
                }
              >
                {mode === "light" ? "深色" : "浅色"}
              </Button>
            </Inline>
          </header>
          <div className="gallery-body">
            <Pane>
              <div className="gallery-hero">
                <Inline>
                  <Tag>本机已保存</Tag>
                  <span className="muted" style={{ fontSize: 12 }}>
                    最后阅读 · 今天 12:30
                  </span>
                </Inline>
                <h2 style={{ marginTop: 16 }}>每一段阅读，都值得被记住</h2>
                <p>给未来的一封信 —— 在长长的文字里，留下一点自己的思考。</p>
                <div style={{ marginTop: 16 }}>
                  <Button
                    variant="contained"
                    onClick={() => setOverlay("dialog")}
                  >
                    继续阅读
                    <span style={{ marginLeft: 8 }}>
                      <Icon name="arrow" size={16} />
                    </span>
                  </Button>
                </div>
              </div>
              <div className="gallery-nav-demo">
                <Inline>
                  <button
                    data-testid="dev.nav-demo.open"
                    className="icon-button"
                    aria-label="打开导航示例"
                    onClick={() =>
                      dispatch({ type: "openDocument", id: "demo" })
                    }
                  >
                    <Icon name="library" />
                  </button>
                  <button
                    data-testid="dev.nav-demo.back"
                    className="icon-button"
                    aria-label="返回导航示例"
                    onClick={() => dispatch({ type: "back" })}
                  >
                    ←
                  </button>
                  <span className="muted">
                    当前区域：{areaNames[nav.area]} ·{" "}
                    {nav.areas[nav.area].stack.length} 层
                  </span>
                  <output
                    data-testid="dev.nav-demo.state"
                    style={{ display: "none" }}
                  >
                    {JSON.stringify(nav)}
                  </output>
                </Inline>
              </div>
            </Pane>
            <SectionHeader
              title="状态始终可见"
              hint="相同的视觉语言，让等待、离线和失败都有明确的下一步"
            />
            <Pane>
              <div className="gallery-states">
                {(
                  [
                    "loading",
                    "empty",
                    "offline",
                    "error",
                    "forbidden",
                  ] as PanelState[]
                ).map((state) => (
                  <StatePanel
                    key={state}
                    state={state}
                    action={
                      state === "error" ? (
                        <Button onClick={() => setToast(true)}>重试</Button>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </Pane>
            <div className="gallery-columns">
              <Pane>
                <Toolbar>
                  <strong>内容与操作</strong>
                  <Tag>44 px 行高</Tag>
                </Toolbar>
                <ListRow title="发给午后读书会的消息" mark="pending" />
                <ListRow
                  title="这是一段很长很长的中文标题，用来检验内容在有限空间内仍然保持清晰且不会挤压操作区域"
                  hint="完整内容在打开后显示"
                  mark="failed"
                />
                <ListRow title="今天的阅读进度" mark="confirmed" />
                <div className="gallery-card">
                  <Inline>
                    <Button
                      variant="outlined"
                      onClick={() => setOverlay("sheet")}
                    >
                      打开侧栏
                    </Button>
                    <Button onClick={() => setOverlay("announcement")}>
                      公告确认对话框
                    </Button>
                    <IconButton
                      label="设置"
                      icon="settings"
                      onClick={() => setOverlay("sheet")}
                    />
                    <OfflineHint label="上传图片" reason="连接后可上传图片">
                      <Button variant="outlined">上传图片</Button>
                    </OfflineHint>
                  </Inline>
                </div>
              </Pane>
              <Pane>
                <div className="gallery-card">
                  <Stack>
                    <SectionHeader
                      title="连接与同步"
                      hint="点击状态胶囊，查看进度与待处理操作"
                    />
                    {(
                      ["connected", "connecting", "offline", "syncing"] as const
                    ).map((connection) => (
                      <StatusPill
                        key={connection}
                        model={{ ...status, connection, syncingCount: 3 }}
                        onClick={() => setOverlay("status")}
                      />
                    ))}
                    <SectionHeader title="版本更新" />
                    {(
                      [
                        "none",
                        "installing",
                        "ready",
                        "applying",
                        "failed",
                      ] as const
                    ).map((state) => (
                      <Button
                        key={state}
                        onClick={() => {
                          setUpdatePreview(state);
                          setOverlay("status");
                        }}
                      >
                        {
                          {
                            none: "已是最新",
                            installing: "正在下载",
                            ready: "已就绪",
                            applying: "正在应用",
                            failed: "更新失败",
                          }[state]
                        }
                      </Button>
                    ))}
                  </Stack>
                </div>
              </Pane>
            </div>
            {gallery && (
              <>
                <SectionHeader
                  title="登录与锁定"
                  hint="PIN 登录、离线提示与设备准入状态"
                />
                <Pane>
                  <div className="gallery-card">
                    <Inline style={{ flexWrap: "wrap" }}>
                      {[
                        ["login", "登录"],
                        ["wrong-pin", "PIN 错误"],
                        ["throttled", "尝试过多"],
                        ["offline-unavailable", "离线不可用"],
                        ["lock", "已锁定"],
                        ["device-locked", "设备未准入"],
                      ].map(([key, label]) => (
                        <Button key={key} href={`?auth=${key}&theme=${mode}`}>
                          {label}
                        </Button>
                      ))}
                    </Inline>
                  </div>
                </Pane>
                <SectionHeader
                  title="输入与反馈"
                  hint="一致的触控尺寸，清楚的提示与可恢复的操作"
                />
                <div className="gallery-columns">
                  <Pane>
                    <div className="gallery-card">
                      <Stack>
                        <Field
                          label="名称"
                          defaultValue="午后读书会"
                          hint="一个大家都熟悉的名字"
                        />
                        <Field
                          label="阅读页码"
                          type="number"
                          defaultValue="0"
                          error="请输入大于 0 的页码"
                        />
                        <Field
                          label="允许发现群组"
                          type="checkbox"
                          defaultChecked
                          hint="已加入上级群组的成员可以发现"
                        />
                        <Segmented
                          label="主题选择示例"
                          value={mode}
                          options={[
                            { value: "light", label: "浅色" },
                            { value: "dark", label: "深色" },
                          ]}
                          onChange={(value) =>
                            preferences.setState({ mode: value })
                          }
                        />
                        <Tabs
                          label="内容分类示例"
                          value={mode}
                          options={[
                            { value: "light", label: "最近" },
                            { value: "dark", label: "收藏" },
                          ]}
                          onChange={(value) =>
                            preferences.setState({ mode: value })
                          }
                        />
                        <SelectField label="显示密度" defaultValue="compact">
                          <option value="compact">紧凑</option>
                          <option value="normal">舒适</option>
                        </SelectField>
                        <CompactToolbar>
                          <span>工具栏</span>
                          <IconButton
                            label="详情"
                            icon="info"
                            onClick={() => undefined}
                          />
                          <FileButton
                            label="添加图片"
                            accept="image/*"
                            onFile={() => undefined}
                          />
                        </CompactToolbar>
                        <SharedComposer
                          placeholder="发消息…"
                          onSend={() => undefined}
                          actions={
                            <IconButton
                              label="图片"
                              icon="image"
                              onClick={() => undefined}
                            />
                          }
                        />
                        <TextArea
                          label="便笺"
                          placeholder="记下一点想法"
                          rows={2}
                        />
                      </Stack>
                    </div>
                  </Pane>
                  <Pane>
                    <div className="gallery-card">
                      <Stack>
                        <Field label="数字键盘" value={number} readOnly />
                        <NumPad
                          onKey={(key) =>
                            setNumber(
                              key === "清除"
                                ? ""
                                : key === "退格"
                                  ? number.slice(0, -1)
                                  : number + key,
                            )
                          }
                        />
                        <Inline>
                          <Mark state="pending" />
                          <Mark state="failed" onRetry={() => setToast(true)} />
                          <Mark state="confirmed" />
                        </Inline>
                        <Skeleton width="72%" />
                        <Skeleton width="48%" />
                        <KeyValue label="触控区域">40 × 40 px</KeyValue>
                        <Inline>
                          <Button
                            onClick={() => setOverlay("confirm")}
                            color="error"
                          >
                            删除便笺
                          </Button>
                          <Button onClick={() => setToast(true)}>
                            显示提示
                          </Button>
                        </Inline>
                      </Stack>
                    </div>
                  </Pane>
                </div>
                <BannerHost
                  notices={[
                    {
                      id: "offline",
                      text: "正在离线使用。已保存的内容仍可查看。",
                      tone: "info",
                    },
                  ]}
                />
                <SectionHeader
                  title="长列表，平稳浏览"
                  hint="50,000 条内容 · 可变行高 · 本机渲染"
                  action={
                    <Button
                      onClick={() =>
                        virtual.current?.scrollToIndex(49999, "end")
                      }
                    >
                      跳到末尾
                    </Button>
                  }
                />
                <Pane>
                  <VirtualList
                    ref={virtual}
                    items={rows}
                    getKey={keyOf}
                    height={360}
                    estimatedItemHeight={64}
                    renderItem={(item, index) => (
                      <ListRow
                        title={item.title}
                        hint={item.hint}
                        leading={<Icon name="library" />}
                        trailing={index % 7 === 0 ? "已读" : ""}
                      />
                    )}
                  />
                </Pane>
              </>
            )}
          </div>
        </AppFrame>
      </div>
      <StatusCenter
        open={overlay === "status"}
        model={status}
        onClose={close}
      />
      <Sheet open={overlay === "sheet"} title="显示设置" onClose={close}>
        <Stack>
          <p>选择适合当前环境的外观。</p>
          <Button
            variant="outlined"
            onClick={() =>
              preferences.setState({
                mode: mode === "light" ? "dark" : "light",
              })
            }
          >
            切换到{mode === "light" ? "深色" : "浅色"}
          </Button>
          <KeyValue label="界面密度">紧凑</KeyValue>
          <KeyValue label="语言">简体中文</KeyValue>
        </Stack>
      </Sheet>
      <Dialog
        open={overlay === "dialog"}
        title="给未来的一封信"
        onClose={close}
      >
        <Stack>
          <p>这是基础组件的静态演示。阅读功能将在后续模块接入。</p>
          <Button onClick={close}>知道了</Button>
        </Stack>
      </Dialog>
      <Dialog
        open={overlay === "announcement"}
        title="必须确认的公告"
        dismissible={false}
        onEscape={close}
        onClose={close}
      >
        <p>请确认阅读；Esc 可退出预览。</p>
        <Button onClick={close}>我已阅读并确认</Button>
      </Dialog>
      <ConfirmDialog
        open={overlay === "confirm"}
        objectName="给自己的便笺"
        destructive
        onClose={close}
        onConfirm={() => {
          close();
          setToast(true);
        }}
      />
      <Toast
        notice={
          toast
            ? { id: "saved", text: "操作已完成", tone: "success" }
            : undefined
        }
        onDismiss={() => setToast(false)}
      />
    </TalosProvider>
  );
}
