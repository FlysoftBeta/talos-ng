import { aiModule } from "../features/ai/module.ts";
import { tasksModule } from "../features/activity/module.ts";
import { chatModule } from "../features/chat/model/module.ts";
import { opsModule } from "../features/ops/module.ts";
import { ModuleRegistry } from "../core/data/modules.ts";
import { settingsModule } from "../features/settings/module.ts";
import { authModule } from "../features/auth/module.ts";
import { libraryModule } from "../features/library/module.ts";
import { mediaModule } from "../features/media/module.ts";
import { adminModule } from "../features/admin/module.ts";
/** Application assembly of model-only feature registrations. Modules never import each other. */
export const clientModules = new ModuleRegistry([
  settingsModule,
  authModule,
  libraryModule,
  mediaModule,
  chatModule,
  opsModule,
  tasksModule,
  adminModule,
  aiModule,
]);
