export async function crossTab(context, origin) {
  const a = await context.newPage();
  const b = await context.newPage();
  await Promise.all([a.goto(`${origin}/?peer`), b.goto(`${origin}/?peer`)]);
  for (const page of [a, b])
    await page.evaluate(async () => {
      const { openDb, FileStore, createFileStores } = window.storeApi;
      window.now = 1000;
      window.db = await openDb({
        name: "actual-tabs",
        schema: [
          {
            version: 1,
            upgrade: (tx) => {
              tx.db.createObjectStore("rows");
              createFileStores(tx);
            },
          },
        ],
      });
      window.files = new FileStore(window.db, {
        locks: null,
        clock: () => window.now,
        leaseMs: 10,
      });
    });
  await b.evaluate(() => {
    window.notification = new Promise((resolve) => {
      window.db.subscribe(["rows"], resolve);
    });
  });
  await a.evaluate(() => window.db.table("rows").put("cross-tab", "key"));
  const change = await b.evaluate(() => window.notification);
  if (JSON.stringify(change.tables) !== '["rows"]')
    throw new Error("Cross-tab notification missing");
  // SHA-256 of one zero byte, checked independently of the file engine.
  const rid =
    "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d";
  await a.evaluate(async (rid) => {
    window.writer = await window.files.begin(rid, 1);
  }, rid);
  const locked = await b.evaluate(async (rid) => {
    try {
      await window.files.begin(rid, 1);
      return false;
    } catch (error) {
      return error.code === "E_BUSY";
    }
  }, rid);
  if (!locked) throw new Error("Another tab acquired an active writer lease");
  const skipped = await b.evaluate(() =>
    window.files.gc({ incompleteOlderThanMs: 0 }),
  );
  if (skipped.files !== 0) throw new Error("GC collected active tab writer");
  await a.evaluate(() => {
    window.now = 1011;
  });
  await b.evaluate(() => {
    window.now = 1011;
  });
  await b.evaluate(async (rid) => {
    window.writer = await window.files.begin(rid, 1);
  }, rid);
  const fenced = await a.evaluate(async () => {
    try {
      await window.writer.append(new Uint8Array([0]));
      return false;
    } catch (error) {
      return error.code === "E_BUSY";
    }
  });
  if (!fenced) throw new Error("Expired tab writer was not fenced");
  await b.evaluate(async () => {
    await window.writer.append(new Uint8Array([0]));
    await window.writer.commit();
  });
  if (!(await a.evaluate((rid) => window.files.has(rid), rid)))
    throw new Error("Committed file not visible across tabs");
  await a.evaluate(() => window.db.close());
  await b.evaluate(() => window.db.close());
  await a.close();
  await b.close();
}
