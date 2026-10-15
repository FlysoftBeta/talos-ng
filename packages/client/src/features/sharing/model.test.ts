import { describe, expect, it, vi } from "vitest";
import { GrantController, filterPrincipals, principalName } from "./model.ts";
import type { Principal, ShareGrant, SharingAdapter } from "./model.ts";

const people: Principal[] = [
  { id: "u1", type: "user", name: "甲" },
  { id: "g1", type: "group", name: "乙组" },
];
const grant: ShareGrant = {
  id: "x",
  principalType: "user",
  principal: "u1",
  level: "read",
  delegate: false,
};
function adapter(patch: Partial<SharingAdapter> = {}): SharingAdapter {
  return {
    principals: async () => people,
    list: async () => ({ grants: [grant], canShare: true }),
    set: vi.fn(async () => {}),
    ...patch,
  };
}
describe("grant controller", () => {
  it("surfaces a denied principal lookup and recovers on retry", async () => {
    let deny = true;
    const c = new GrantController(
      adapter({
        principals: async () => {
          if (deny) throw new Error("没有权限");
          return people;
        },
      }),
    );
    await c.refresh();
    expect(c.getState()).toMatchObject({ error: "没有权限", loading: false });
    deny = false;
    await c.refresh();
    expect(c.getState()).toMatchObject({ error: "", canShare: true });
  });

  it("grants the selected principal at the chosen level and clears the draft", async () => {
    const a = adapter();
    const c = new GrantController(a);
    await c.refresh();
    c.select("group:g1");
    c.setLevel("write");
    c.setDelegate(true);
    await c.grant();
    expect(a.set).toHaveBeenCalledWith({
      principalType: "group",
      principal: "g1",
      level: "write",
      delegate: true,
    });
    expect(c.getState()).toMatchObject({ selected: "", busy: false });
  });

  it("keeps the revoke confirmation open when saving fails", async () => {
    const set = vi.fn().mockRejectedValueOnce(new Error("撤销失败"));
    const c = new GrantController(adapter({ set }));
    await c.refresh();
    c.askRevoke(grant);
    await c.confirmRevoke();
    expect(c.getState().revoke).toBe(grant);
    expect(c.getState().error).toBe("撤销失败");
    await c.confirmRevoke();
    expect(set).toHaveBeenLastCalledWith({ ...grant, level: null });
    expect(c.getState().revoke).toBeUndefined();
  });

  it("names grants by principal and filters by search text", () => {
    expect(principalName(people, grant)).toBe("甲");
    expect(principalName([], grant)).toBe("u1");
    expect(filterPrincipals(people, "组")).toEqual([people[1]]);
  });
});
