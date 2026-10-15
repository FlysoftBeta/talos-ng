import type { CancellationSignal } from "@talos/base";
import type { Netbook } from "@talos/contract";
export interface Chapter {
  id: string;
  title: string;
}
export interface Catalog {
  title: string;
  chapters: Chapter[];
}
export interface NetbooksProvider {
  search(query: string, signal: CancellationSignal): Promise<Netbook[]>;
  catalog(book: string, signal: CancellationSignal): Promise<Catalog>;
  chapter(id: string, signal: CancellationSignal): Promise<string>;
}
export class FakeNetbooksProvider implements NetbooksProvider {
  async search(query: string): Promise<Netbook[]> {
    return "星河漫游 测试作者".includes(query)
      ? [
          {
            id: "10001",
            title: "星河漫游",
            author: "测试作者",
            abstract: "少年与星空的故事。",
          },
        ]
      : [];
  }
  async catalog(): Promise<Catalog> {
    return {
      title: "星河漫游",
      chapters: Array.from({ length: 8 }, (_, i) => ({
        id: String(20001 + i),
        title: `第${i + 1}章 星河`,
      })),
    };
  }
  async chapter(id: string): Promise<string> {
    return `星空之下，少年开始了旅程。章节 ${id}。`;
  }
}
