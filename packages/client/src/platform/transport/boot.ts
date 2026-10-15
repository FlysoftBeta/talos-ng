import { createInstaller } from "@talos/shell";
import { createBoot as boot } from "../../core/lifecycle/boot.ts";
import type { BootHandle, BootOptions } from "../../core/lifecycle/boot.ts";
export type BrowserBootOptions = Omit<BootOptions, "environment"> & {
  environment?: Partial<BootOptions["environment"]>;
};
/** Supplies the browser and shell installer to the platform-independent boot protocol. */
export function createBoot(options: BrowserBootOptions): BootHandle {
  const environment = options.environment ?? {};
  const fetchRequest =
    environment.fetch ??
    ((input: string | Request, init?: RequestInit) => fetch(input, init));
  return boot({
    ...options,
    environment: {
      ...environment,
      navigator: environment.navigator ?? navigator,
      fetch: fetchRequest,
      createInstaller:
        environment.createInstaller ??
        ((onState) => createInstaller({ onState, fetch: fetchRequest })),
    },
  });
}
