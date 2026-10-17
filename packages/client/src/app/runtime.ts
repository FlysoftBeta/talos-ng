import { ApplicationController } from "../core/lifecycle/application.ts";
import type { RuntimePort } from "../core/runtime-port.ts";
import type { RuntimeOptions } from "./runtime-options.ts";
import { browserEnvironment } from "../platform/browser/lifecycle.ts";
import { openAppDb } from "../platform/storage/database.ts";
import { createFiles } from "../platform/storage/files.ts";
import { rebuildAppData } from "../platform/storage/reset.ts";
import { createAppLink } from "../platform/transport/link.ts";
import { clientModules } from "./registry.ts";
/** Wires core controllers to browser adapters and model-only feature registrations. */
export class ClientRuntime implements RuntimePort {
  readonly getSnapshot: RuntimePort["getSnapshot"];
  readonly subscribe: RuntimePort["subscribe"];
  readonly isDebugOffline: RuntimePort["isDebugOffline"];
  readonly setDebugOffline: RuntimePort["setDebugOffline"];
  readonly start: RuntimePort["start"];
  readonly stableGate: RuntimePort["stableGate"];
  readonly login: RuntimePort["login"];
  readonly reveal: RuntimePort["reveal"];
  readonly retryAdmission: RuntimePort["retryAdmission"];
  readonly lock: RuntimePort["lock"];
  readonly dispatch: RuntimePort["dispatch"];
  readonly gate: RuntimePort["gate"];
  readonly can: RuntimePort["can"];
  readonly command: RuntimePort["command"];
  readonly delay: RuntimePort["delay"];
  readonly clearDelay: RuntimePort["clearDelay"];
  readonly hasScope: RuntimePort["hasScope"];
  readonly time: RuntimePort["time"];
  readonly flush: RuntimePort["flush"];
  readonly sync: RuntimePort["sync"];
  readonly operation: RuntimePort["operation"];
  readonly outbox: RuntimePort["outbox"];
  readonly loadRows: RuntimePort["loadRows"];
  readonly holes: RuntimePort["holes"];
  readonly fetchBody: RuntimePort["fetchBody"];
  readonly readFile: RuntimePort["readFile"];
  readonly hasFile: RuntimePort["hasFile"];
  readonly readFileRange: RuntimePort["readFileRange"];
  readonly downloadFile: RuntimePort["downloadFile"];
  readonly collectFiles: RuntimePort["collectFiles"];
  readonly saveFile: RuntimePort["saveFile"];
  readonly retainFile: RuntimePort["retainFile"];
  readonly releaseFiles: RuntimePort["releaseFiles"];
  readonly getLocal: RuntimePort["getLocal"];
  readonly setLocal: RuntimePort["setLocal"];
  readonly setTransfer: RuntimePort["setTransfer"];
  readonly setSetting: RuntimePort["setSetting"];
  readonly setting: RuntimePort["setting"];
  readonly settingMark: RuntimePort["settingMark"];
  readonly onboard: RuntimePort["onboard"];
  readonly createInvitation: RuntimePort["createInvitation"];
  readonly updateProfile: RuntimePort["updateProfile"];
  readonly replacePins: RuntimePort["replacePins"];
  readonly logout: RuntimePort["logout"];
  readonly localOperationCount: RuntimePort["localOperationCount"];
  readonly resetLocalData: RuntimePort["resetLocalData"];
  readonly retry: RuntimePort["retry"];
  readonly discard: RuntimePort["discard"];
  readonly estimateStorage: RuntimePort["estimateStorage"];
  readonly close: RuntimePort["close"];
  readonly repositories: RuntimePort["repositories"];
  readonly navigationGuards: RuntimePort["navigationGuards"];
  constructor(options: RuntimeOptions = {}) {
    const build = options.build ?? __BUILD_ID__;
    const controller = new ApplicationController(
      clientModules,
      {
        ...options,
        build,
        production: options.production ?? __PRODUCTION__,
        link: options.link ?? ((device) => createAppLink(build, device)),
      },
      browserEnvironment(options.reload),
      {
        open: options.db ?? openAppDb,
        files: createFiles,
        reset:
          options.resetDatabase ??
          ((device, onBlocked) => rebuildAppData(device, undefined, onBlocked)),
      },
    );
    this.getSnapshot = controller.getSnapshot.bind(controller);
    this.subscribe = controller.subscribe.bind(controller);
    this.isDebugOffline = controller.isDebugOffline.bind(controller);
    this.setDebugOffline = controller.setDebugOffline.bind(controller);
    this.start = controller.start.bind(controller);
    this.stableGate = controller.stableGate.bind(controller);
    this.login = controller.login.bind(controller);
    this.reveal = controller.reveal.bind(controller);
    this.retryAdmission = controller.retryAdmission.bind(controller);
    this.lock = controller.lock.bind(controller);
    this.dispatch = controller.dispatch.bind(controller);
    this.gate = controller.gate.bind(controller);
    this.can = controller.can.bind(controller);
    this.command = controller.command.bind(controller);
    this.delay = controller.delay.bind(controller);
    this.clearDelay = controller.clearDelay.bind(controller);
    this.hasScope = controller.hasScope.bind(controller);
    this.time = controller.time.bind(controller);
    this.flush = controller.flush.bind(controller);
    this.sync = controller.sync.bind(controller);
    this.operation = controller.operation.bind(controller);
    this.outbox = controller.outbox.bind(controller);
    this.loadRows = controller.loadRows.bind(controller);
    this.holes = controller.holes.bind(controller);
    this.fetchBody = controller.fetchBody.bind(controller);
    this.readFile = controller.readFile.bind(controller);
    this.hasFile = controller.hasFile.bind(controller);
    this.readFileRange = controller.readFileRange.bind(controller);
    this.downloadFile = controller.downloadFile.bind(controller);
    this.collectFiles = controller.collectFiles.bind(controller);
    this.saveFile = controller.saveFile.bind(controller);
    this.retainFile = controller.retainFile.bind(controller);
    this.releaseFiles = controller.releaseFiles.bind(controller);
    this.getLocal = controller.getLocal.bind(controller);
    this.setLocal = controller.setLocal.bind(controller);
    this.setTransfer = controller.setTransfer.bind(controller);
    this.setSetting = controller.setSetting.bind(controller);
    this.setting = controller.setting.bind(controller);
    this.settingMark = controller.settingMark.bind(controller);
    this.onboard = controller.onboard.bind(controller);
    this.createInvitation = controller.createInvitation.bind(controller);
    this.updateProfile = controller.updateProfile.bind(controller);
    this.replacePins = controller.replacePins.bind(controller);
    this.logout = controller.logout.bind(controller);
    this.localOperationCount = controller.localOperationCount.bind(controller);
    this.resetLocalData = controller.resetLocalData.bind(controller);
    this.retry = controller.retry.bind(controller);
    this.discard = controller.discard.bind(controller);
    this.estimateStorage = controller.estimateStorage.bind(controller);
    this.close = controller.close.bind(controller);
    this.repositories = controller.repositories;
    this.navigationGuards = controller.navigationGuards;
  }
}
export function createClientRuntime(
  options: RuntimeOptions = {},
): ClientRuntime {
  return new ClientRuntime(options);
}
