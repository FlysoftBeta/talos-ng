import { AppError } from "@talos/base";
import type { RuntimeSessionPort } from "../../../core/runtime-port.ts";
import { sanitizeHandle } from "../../auth/model.ts";
import { StateStore } from "../../../core/controller-state.ts";

export interface ProfileUser {
  handle: string;
  name: string;
}
export interface ProfileState {
  handle: string;
  name: string;
  busy: boolean;
  message: string | undefined;
}
export type ProfilePort = Pick<RuntimeSessionPort, "updateProfile">;

/** Saving is offered only with permission, complete fields and a real change. */
export function canSaveProfile(
  state: ProfileState,
  user: ProfileUser | undefined,
  permitted: boolean,
): boolean {
  return (
    permitted &&
    !state.busy &&
    !!state.handle &&
    !!state.name.trim() &&
    !(state.handle === user?.handle && state.name.trim() === user?.name)
  );
}

export class ProfileController extends StateStore<ProfileState> {
  constructor(
    private readonly port: ProfilePort,
    user: ProfileUser | undefined,
  ) {
    super({
      handle: user?.handle ?? "",
      name: user?.name ?? "",
      busy: false,
      message: undefined,
    });
  }
  setHandle = (value: string): void =>
    this.patch({ handle: sanitizeHandle(value) });
  setName = (value: string): void => this.patch({ name: value });
  save = async (): Promise<void> => {
    this.patch({ busy: true, message: undefined });
    try {
      await this.port.updateProfile({
        handle: this.state.handle,
        name: this.state.name.trim(),
      });
      this.patch({ message: "个人资料已保存" });
    } catch (error) {
      this.patch({
        message: error instanceof AppError ? error.message : "无法保存，请重试",
      });
    } finally {
      this.patch({ busy: false });
    }
  };
}
