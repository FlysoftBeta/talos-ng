import { contract } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type { RuntimeQueryPort } from "../../../core/runtime-port.ts";
import { localDate } from "./format.ts";
import {
  PAGE_SIZE,
  QueryResource,
  adminCall,
  failureText,
  sameValue,
} from "./query.ts";
import type { AdminCommandPort, LoadState } from "./query.ts";

export type AnnouncementsPort = AdminCommandPort &
  Pick<RuntimeQueryPort, "subscribe">;
export type AnnouncementPage = ResultOf<
  typeof contract.admin.announcement.list
>;
export type AnnouncementRevision = AnnouncementPage["items"][number];

export const TITLE_LIMIT = 120;
export const TEXT_LIMIT = 10000;

export interface AnnouncementDraft {
  title: string;
  text: string;
}
/** Publishing needs both a title and a body with visible content. */
export function canPublishDraft(draft: AnnouncementDraft): boolean {
  return !!draft.title.trim() && !!draft.text.trim();
}
export const publishedAt = (revision: AnnouncementRevision): string =>
  localDate(revision.published);
/** Acknowledged members out of the audience the revision applies to. */
export const acknowledgement = (revision: AnnouncementRevision): string =>
  `${revision.acknowledged} / ${revision.audience}`;
export function sheetTitle(viewingHistory: boolean, preview: boolean): string {
  return viewingHistory ? "历史公告" : preview ? "公告预览" : "发布公告";
}

export interface AnnouncementsState {
  history: LoadState<AnnouncementPage>;
  list: Capability;
  publish: Capability;
  page: number;
  draft: AnnouncementDraft | undefined;
  preview: boolean;
  viewingHistory: boolean;
  confirm: boolean;
  error: string;
}

/** Announcement revisions: paged history, draft/preview and a confirmed publication. */
export class AnnouncementsController extends StateStore<AnnouncementsState> {
  private cleanup: (() => void) | undefined;
  private readonly history = new QueryResource<AnnouncementPage>((history) =>
    this.patch({ history }),
  );
  constructor(private readonly port: AnnouncementsPort) {
    super({
      history: { data: undefined, loading: true, error: "" },
      list: port.can(contract.admin.announcement.list),
      publish: port.can(contract.admin.announcement.publish),
      page: 0,
      draft: undefined,
      preview: false,
      viewingHistory: false,
      confirm: false,
      error: "",
    });
  }
  attach(): void {
    this.cleanup = this.port.subscribe(() => {
      const list = this.port.can(contract.admin.announcement.list);
      const publish = this.port.can(contract.admin.announcement.publish);
      if (!sameValue([list, publish], [this.state.list, this.state.publish]))
        this.patch({ list, publish });
    });
    this.load();
  }
  detach(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    this.history.cancel();
  }
  reload = (): void => this.history.reload();
  setPage = (page: number): void => {
    this.patch({ page });
    this.load();
  };
  newDraft = (): void =>
    this.patch({ viewingHistory: false, draft: { title: "", text: "" } });
  viewRevision = (revision: AnnouncementRevision): void =>
    this.patch({
      viewingHistory: true,
      draft: { title: revision.title, text: revision.text },
      preview: true,
    });
  closeSheet = (): void => this.patch({ draft: undefined, preview: false });
  setTitle = (title: string): void => this.change({ title });
  setText = (text: string): void => this.change({ text });
  togglePreview = (): void => this.patch({ preview: !this.state.preview });
  canPublish(): boolean {
    const { draft, publish } = this.state;
    return !!draft && canPublishDraft(draft) && publish.ok;
  }
  askPublish = (): void => this.patch({ confirm: true });
  dismissConfirm = (): void => this.patch({ confirm: false });
  runConfirmed = (): void => {
    this.patch({ confirm: false });
    void this.publishDraft();
  };

  private async publishDraft(): Promise<void> {
    const { draft } = this.state;
    if (!draft) return;
    try {
      await adminCall(this.port, contract.admin.announcement.publish, draft);
      this.patch({ draft: undefined, preview: false, error: "" });
      this.history.reload();
    } catch (failure) {
      this.patch({ error: failureText(failure, "发布失败") });
    }
  }
  private change(change: Partial<AnnouncementDraft>): void {
    const { draft } = this.state;
    if (draft) this.patch({ draft: { ...draft, ...change } });
  }
  private load(): void {
    this.history.run(() =>
      adminCall(this.port, contract.admin.announcement.list, {
        offset: this.state.page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    );
  }
}
