import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Group, GroupRow, Tag } from "../../../ui/layout/index.ts";
import type { HttpsController, HttpsModel } from "../model/https.ts";
import { PanelView } from "./panel.tsx";

export function HttpsView({
  model,
  actions,
}: {
  model: HttpsModel;
  actions: Pick<HttpsController, "press" | "confirm" | "dismiss">;
}): ReactElement {
  const { details } = model;
  return (
    <PanelView frame={model.frame} handlers={actions}>
      {details && (
        <>
          <Group title="访问配置">
            <GroupRow label="访问域名">{details.domain}</GroupRow>
            <GroupRow label="证书到期">{details.expiry}</GroupRow>
            <GroupRow label="HTTP 重定向">{details.redirect}</GroupRow>
          </Group>
          <Group title="监听端口">
            {details.listeners.map((row, i) => (
              <GroupRow key={i} label={row.title} hint={row.hint}>
                <Tag>{row.tag}</Tag>
              </GroupRow>
            ))}
          </Group>
          <Group title="根证书">
            <GroupRow
              label="平板信任证书"
              hint="将域名的 DNS 记录指向此服务器。平板需要信任根证书后才能使用 HTTPS 和离线安装。"
              stacked
            >
              {details.ca ? (
                <Button href="/ca.crt" icon="download">
                  下载根证书
                </Button>
              ) : (
                <Tag>尚未配置根证书下载</Tag>
              )}
            </GroupRow>
          </Group>
        </>
      )}
    </PanelView>
  );
}
