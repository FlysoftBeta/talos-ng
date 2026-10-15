import type { RuntimeSessionPort } from "../../../core/runtime-port.ts";
import { StateStore } from "../../../core/controller-state.ts";

export interface Invitation {
  id: string;
  pin: string;
  expires: number;
}
export interface InvitationState {
  invitation: Invitation | undefined;
  busy: boolean;
  error: string;
}
export type InvitationPort = Pick<RuntimeSessionPort, "createInvitation">;

export const formatInvitationExpiry = (expires: number): string =>
  new Date(expires).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

/** Creates a one-time invitation; failure keeps the previous result and offers retry. */
export class InvitationController extends StateStore<InvitationState> {
  constructor(private readonly port: InvitationPort) {
    super({ invitation: undefined, busy: false, error: "" });
  }
  create = async (): Promise<void> => {
    this.patch({ busy: true, error: "" });
    try {
      this.patch({ invitation: await this.port.createInvitation() });
    } catch {
      this.patch({ error: "无法创建邀请，请重试" });
    } finally {
      this.patch({ busy: false });
    }
  };
}
