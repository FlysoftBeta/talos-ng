import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Sheet } from "../../../ui/overlays/index.ts";
import { DurationInput } from "../../../ui/inputs/index.ts";
import { Stack } from "../../../ui/layout/index.ts";
import type { DurationInputProps } from "../model/duration.ts";
import type { UsersController, UsersState } from "../model/users.ts";

/** Ban and mute sheets sharing one duration control. */
export function UserRestrictionSheets({
  state,
  duration,
  actions,
}: {
  state: UsersState;
  duration: DurationInputProps;
  actions: UsersController;
}): ReactElement {
  const { banning, muting } = state;
  return (
    <>
      <Sheet
        open={!!banning}
        title={`封禁：${banning?.name ?? ""}`}
        onClose={actions.closeRestriction}
        footer={
          <>
            <Button onClick={actions.closeRestriction}>取消</Button>
            <Button variant="contained" onClick={actions.confirmBan}>
              确认封禁
            </Button>
          </>
        }
      >
        <Stack>
          <DurationInput {...duration} />
        </Stack>
      </Sheet>
      <Sheet
        open={!!muting}
        title={`禁言：${muting?.name ?? ""}`}
        onClose={actions.closeRestriction}
        footer={
          <>
            <Button onClick={actions.closeRestriction}>取消</Button>
            <Button variant="contained" onClick={actions.confirmMute}>
              确认禁言
            </Button>
          </>
        }
      >
        <Stack>
          <DurationInput {...duration} />
        </Stack>
      </Sheet>
    </>
  );
}
