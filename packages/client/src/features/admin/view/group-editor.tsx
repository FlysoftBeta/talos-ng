import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Sheet } from "../../../ui/overlays/index.ts";
import { Field } from "../../../ui/inputs/index.ts";
import { Group, Inline, Stack } from "../../../ui/layout/index.ts";
import { GROUP_FLAGS } from "../model/groups.ts";
import type { GroupsController, GroupsState } from "../model/groups.ts";

/** Create / edit sheet for one group, including parent lookup for ordinary groups. */
export function GroupEditorSheet({
  state,
  kind,
  canSave,
  actions,
}: {
  state: GroupsState;
  kind: "normal" | "system";
  canSave: boolean;
  actions: GroupsController;
}): ReactElement {
  const { editor, parentOptions } = state;
  return (
    <Sheet
      open={!!editor}
      title={editor?.id ? `编辑群组 · ${editor.name}` : "创建群组"}
      onClose={actions.closeEditor}
      footer={
        <>
          <Button onClick={actions.closeEditor}>取消</Button>
          <Button
            variant="contained"
            onClick={actions.save}
            disabled={!canSave}
          >
            保存
          </Button>
        </>
      }
    >
      <Group title="群组信息" className="admin-form">
        <Stack>
          {editor && (
            <>
              <Field
                label="名称"
                value={editor.name}
                onChange={(event) =>
                  actions.change({ name: event.target.value })
                }
              />
              <Field
                label="标识"
                value={editor.handle}
                onChange={(event) =>
                  actions.change({ handle: event.target.value })
                }
              />
              <Field
                label="新密码（留空保持现状）"
                type="password"
                value={editor.password}
                disabled={editor.clearPassword}
                onChange={(event) =>
                  actions.change({ password: event.target.value })
                }
              />
              {editor.id && (
                <Field
                  label="清除群组密码"
                  type="checkbox"
                  checked={editor.clearPassword}
                  onChange={(event) =>
                    actions.change({ clearPassword: event.target.checked })
                  }
                />
              )}
              <div>类型：{kind === "normal" ? "普通群组" : "系统群组"}</div>
              {kind === "normal" && (
                <div>
                  <Field
                    label="查找父级群组"
                    value={state.parentQuery}
                    onChange={(event) =>
                      actions.setParentQuery(event.target.value)
                    }
                  />
                  父级群组 {editor.parent ? `已选 ${editor.parent}` : "无"}{" "}
                  <Inline>
                    <Button
                      onClick={() => actions.change({ parent: null })}
                      aria-pressed={editor.parent === null}
                    >
                      无
                    </Button>
                    {parentOptions.data?.items
                      .filter((item) => item.id !== editor.id)
                      .map((item) => (
                        <Button
                          key={item.id}
                          onClick={() => actions.change({ parent: item.id })}
                          aria-pressed={editor.parent === item.id}
                        >
                          {item.name}
                        </Button>
                      ))}
                  </Inline>
                </div>
              )}
              {GROUP_FLAGS.map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  type="checkbox"
                  checked={editor[key]}
                  onChange={(event) =>
                    actions.change({ [key]: event.target.checked })
                  }
                />
              ))}
            </>
          )}
        </Stack>
      </Group>
    </Sheet>
  );
}
