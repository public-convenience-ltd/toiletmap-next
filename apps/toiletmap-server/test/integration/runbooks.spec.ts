/**
 * Rehearses the SQL runbooks in docs/runbooks/sql against the local database,
 * exactly as an operator would run them with psql (dry run, then apply):
 * - revert-by-account.sql: one account's changes since T are reverted,
 *   toilets someone else changed since are skipped, its pending changes are
 *   rejected;
 * - erase-contributor.sql: one handle (and its Auth0 sub) is pseudonymised in
 *   toilets, the audit history and the moderation queue.
 *
 * psql meta-commands are stripped and its `:'var'` interpolation done here;
 * the SQL itself runs unchanged (as the postgres role, as in production).
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { getPrismaClient, getTestContext } from "./setup";
import { cleanupManager } from "./utils/cleanup";
import { getTestDatabaseUrl } from "./utils/env";
import { createFixtureFactory } from "./utils/fixtures";
import type { SavedLooBody } from "./utils/response-types";
import { callApi, jsonRequest, readJson } from "./utils/test-client";

const fixtures = createFixtureFactory();

const runbookSql = (name: string) =>
  readFileSync(new URL(`../../../../docs/runbooks/sql/${name}`, import.meta.url), "utf8");

/**
 * The file as psql would send it with `-v` variables: meta-commands dropped,
 * the closing `\if :apply COMMIT \else ROLLBACK \endif` resolved (see the
 * guard test below for that block itself).
 */
const asPlainSql = (sql: string, vars: Record<string, string>, apply: boolean): string => {
  const kept: string[] = [];
  let inIf = false;
  for (const line of sql.split("\n")) {
    if (line.startsWith("\\if")) inIf = true;
    else if (line.startsWith("\\endif")) inIf = false;
    else if (!inIf && !line.startsWith("\\")) kept.push(line);
  }
  return `${kept.join("\n")}\n${apply ? "COMMIT;" : "ROLLBACK;"}\n`.replace(
    /:'(\w+)'/g,
    (_, name: string) => {
      const value = vars[name];
      if (value === undefined) throw new Error(`No value for :'${name}'`);
      return `'${value.replaceAll("'", "''")}'`;
    },
  );
};

const runRunbook = async (name: string, vars: Record<string, string>, apply: boolean) => {
  const client = new Client({ connectionString: getTestDatabaseUrl() });
  await client.connect();
  try {
    await client.query(asPlainSql(runbookSql(name), vars, apply));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};

const dbNow = async () => {
  const [row] = await getPrismaClient().$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
  if (!row) throw new Error("no clock");
  return new Date(row.now.getTime() - 1000).toISOString();
};

const bearer = (sub: string, nickname?: string) => ({
  Authorization: `Bearer ${getTestContext().issueToken({
    sub,
    ...(nickname ? { app_metadata: { nickname } } : {}),
  })}`,
});

const freshSub = (label: string) => `auth0|runbook-${label}-${randomBytes(5).toString("hex")}`;

/** Somewhere in the Highlands, away from other tests' loos. */
const uniqueLocation = () => ({ lat: 56.5 + Math.random() * 1.5, lng: -5 + Math.random() * 1.5 });

const put = (id: string, body: unknown, headers: Record<string, string>) =>
  callApi(`/api/loos/${id}`, jsonRequest("PUT", body, headers));

const toilet = (id: string) => getPrismaClient().toilets.findUnique({ where: { id } });

const updatedBySub = async (id: string) => {
  const [row] = await getPrismaClient().$queryRaw<Array<{ sub: string | null }>>`
    SELECT updated_by_sub AS sub FROM toilets WHERE id = ${id}`;
  return row?.sub ?? null;
};

describe("runbook: revert-by-account.sql", () => {
  it("reverts the account's edits, removals, moves and additions; skips toilets others changed since", async () => {
    const vandal = freshSub("vandal");
    const other = freshSub("other");
    const since = await dbNow();

    const edited = await fixtures.loos.create({ name: "Good name", notes: "Good notes" });
    const placed = uniqueLocation();
    const moved = await fixtures.loos.create({ location: placed });
    const removed = await fixtures.loos.create();
    const fixedByOther = await fixtures.loos.create({ notes: "Original" });
    const verifiedAfter = await fixtures.loos.create({ notes: "Original" });

    expect((await put(edited.id, { name: "Vandal", notes: "Vandal" }, bearer(vandal))).status).toBe(
      200,
    );
    expect((await put(edited.id, { notes: "Vandal again" }, bearer(vandal))).status).toBe(200);
    expect(
      (
        await put(
          moved.id,
          { location: { lat: placed.lat + 0.0003, lng: placed.lng } },
          bearer(vandal),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await callApi(
          `/api/loos/${removed.id}/report`,
          jsonRequest("POST", { reason: "does_not_exist" }, bearer(vandal)),
        )
      ).status,
    ).toBe(200);
    expect((await put(fixedByOther.id, { notes: "Vandal" }, bearer(vandal))).status).toBe(200);
    expect((await put(fixedByOther.id, { notes: "Fixed" }, bearer(other))).status).toBe(200);
    // A verify after the account's edit, by someone else or anonymously, is not an edit.
    expect((await put(verifiedAfter.id, { notes: "Vandal" }, bearer(vandal))).status).toBe(200);
    const verifyBy = (headers: Record<string, string>) =>
      callApi(`/api/loos/${verifiedAfter.id}/verify`, { method: "POST", headers });
    expect((await verifyBy({})).status).toBe(200);
    expect((await verifyBy(bearer(other))).status).toBe(200);

    const created = await callApi(
      "/api/loos",
      jsonRequest("POST", { name: "Fake toilet", location: uniqueLocation() }, bearer(vandal)),
    );
    expect(created.status).toBe(201);
    const createdId = (await readJson<SavedLooBody>(created)).id;
    cleanupManager.trackLoo(createdId);

    const pending = await getPrismaClient().pending_change.create({
      data: {
        type: "update",
        loo_id: edited.id,
        payload: { notes: "More vandalism" },
        submitter_sub: vandal,
      },
    });
    cleanupManager.trackPendingChange(pending.id);

    // Dry run: nothing changes.
    await runRunbook("revert-by-account.sql", { sub: vandal, since }, false);
    expect((await toilet(edited.id))?.name).toBe("Vandal");
    expect((await toilet(removed.id))?.active).toBe(false);
    expect(
      (await getPrismaClient().pending_change.findUnique({ where: { id: pending.id } }))?.status,
    ).toBe("pending");

    await runRunbook("revert-by-account.sql", { sub: vandal, since }, true);

    const editedNow = await toilet(edited.id);
    expect(editedNow?.name).toBe("Good name");
    expect(editedNow?.notes).toBe("Good notes");
    expect(await updatedBySub(edited.id)).toBe("ops:revert-by-account");
    expect(editedNow?.updated_at?.getTime()).toBeGreaterThan(Date.parse(since));

    const movedNow = await callApi(`/api/loos/${moved.id}`);
    expect((await readJson<{ location: unknown }>(movedNow)).location).toEqual(moved.location);

    const removedNow = await toilet(removed.id);
    expect(removedNow?.active).toBe(true);
    expect(removedNow?.removal_category).toBeNull();

    expect((await toilet(fixedByOther.id))?.notes).toBe("Fixed");
    expect((await toilet(verifiedAfter.id))?.notes).toBe("Original");

    const createdNow = await toilet(createdId);
    expect(createdNow?.active).toBe(false);
    expect(createdNow?.removal_category).toBe("other");

    const pendingNow = await getPrismaClient().pending_change.findUnique({
      where: { id: pending.id },
    });
    expect(pendingNow?.status).toBe("rejected");
    expect(pendingNow?.reviewed_by).toBe("ops:revert-by-account");
  });
});

describe("runbook: erase-contributor.sql", () => {
  it("pseudonymises the handle and clears the sub everywhere, keeping other accounts' attribution", async () => {
    const handle = `Erase Me ${randomBytes(4).toString("hex")}`;
    const pseudonym = `erased-${randomBytes(4).toString("hex")}`;
    const sub = freshSub("erase");
    const otherSub = freshSub("keep");

    // Added by the person (fixture contributor), then edited by them.
    const theirs = await fixtures.loos.create({ contributor: handle, notes: "Before" });
    expect((await put(theirs.id, { notes: "By them" }, bearer(sub, handle))).status).toBe(200);
    // Edited by them, then by someone else, whose attribution must survive.
    const shared = await fixtures.loos.create({ notes: "Before" });
    expect((await put(shared.id, { notes: "By them" }, bearer(sub, handle))).status).toBe(200);
    expect((await put(shared.id, { notes: "By other" }, bearer(otherSub, "Keeper"))).status).toBe(
      200,
    );

    const pending = await getPrismaClient().pending_change.create({
      data: {
        type: "update",
        loo_id: shared.id,
        payload: { notes: "Queued by them" },
        submitted_by: handle,
        submitter_sub: sub,
      },
    });
    cleanupManager.trackPendingChange(pending.id);

    const vars = { handle, pseudonym, sub };
    await runRunbook("erase-contributor.sql", vars, false);
    expect((await toilet(theirs.id))?.contributors).toContain(handle);

    await runRunbook("erase-contributor.sql", vars, true);

    const theirsNow = await toilet(theirs.id);
    expect(theirsNow?.contributors).toContain(pseudonym);
    expect(theirsNow?.contributors).not.toContain(handle);
    expect(theirsNow?.notes).toBe("By them");
    expect(await updatedBySub(theirs.id)).toBeNull();

    const sharedNow = await toilet(shared.id);
    expect(sharedNow?.contributors).toEqual(expect.arrayContaining([pseudonym, "Keeper"]));
    expect(await updatedBySub(shared.id)).toBe(otherSub);

    const leftovers = await getPrismaClient().$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM audit.record_version
      WHERE record ->> 'id' IN (${theirs.id}, ${shared.id})
        AND (record::text LIKE ${`%${handle}%`} OR old_record::text LIKE ${`%${handle}%`}
          OR record::text LIKE ${`%${sub}%`} OR old_record::text LIKE ${`%${sub}%`})`;
    expect(leftovers[0]?.count).toBe(0);

    const pendingNow = await getPrismaClient().pending_change.findUnique({
      where: { id: pending.id },
    });
    expect(pendingNow?.submitted_by).toBe(pseudonym);
    expect(pendingNow?.submitter_sub).toBeNull();
  });

  it("refuses an empty pseudonym or one equal to the handle", async () => {
    await expect(
      runRunbook("erase-contributor.sql", { handle: "Someone", pseudonym: "", sub: "" }, false),
    ).rejects.toThrow(/pseudonym/);
    await expect(
      runRunbook(
        "erase-contributor.sql",
        { handle: "Someone", pseudonym: "Someone", sub: "" },
        false,
      ),
    ).rejects.toThrow(/pseudonym/);
  });
});

describe("runbooks commit only when apply is true", () => {
  // psql's `\if :{?apply}` is true whenever apply is set, so `-v apply=0`
  // would COMMIT; the scripts default apply to 0 and test its value instead
  // (checked with psql 15: unset, 0, false, off and unreadable values roll
  // back; 1, true, yes and on commit). No psql here, so check the block.
  const GUARD = [
    "\\if :{?apply}",
    "\\else",
    "\\set apply 0",
    "\\endif",
    "\\if :apply",
    "COMMIT;",
    "\\else",
    "ROLLBACK;",
  ].join("\n");

  it.each(["revert-by-account.sql", "erase-contributor.sql"])("%s", (name) => {
    const sql = runbookSql(name);
    expect(sql).toContain(GUARD);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).not.toMatch(/\\if :\{\?apply\}\nCOMMIT;/);
  });
});
