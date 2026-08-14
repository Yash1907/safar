import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate } from "../src/db/schema.ts";
import {
  upsertJob,
  setStatus,
  setNotes,
  undoLastStatus,
  getStatusHistory,
  clearStatusHistory,
} from "../src/db/repo.ts";
import type { RawJob } from "../src/sources/types.ts";

function freshDbWithJob(): { db: Database; jobId: number } {
  const db = new Database(":memory:");
  migrate(db);
  const raw: RawJob = {
    sourceId: "fake",
    sourceJobId: "1",
    company: "Acme",
    title: "Engineer",
    url: "https://example.com",
    locations: ["Remote"],
  };
  upsertJob(db, raw, 100);
  const jobId = db.query<{ id: number }, []>("SELECT id FROM jobs").get()!.id;
  return { db, jobId };
}

describe("undoLastStatus", () => {
  test("reverts to the previous status and removes the reverted history entry", () => {
    const { db, jobId } = freshDbWithJob();
    setStatus(db, jobId, "saved", 100);
    setStatus(db, jobId, "applied", 200);
    setStatus(db, jobId, "interviewing", 300); // accidental keypress

    const restored = undoLastStatus(db, jobId);
    expect(restored).toBe("applied");

    const current = db
      .query<{ status: string }, [number]>("SELECT status FROM applications WHERE job_id = ?")
      .get(jobId)!;
    expect(current.status).toBe("applied");

    const history = getStatusHistory(db, jobId);
    expect(history.map((h) => h.status)).toEqual(["saved", "applied"]);
  });

  test("restores updated_at to the prior transition's timestamp, not now", () => {
    const { db, jobId } = freshDbWithJob();
    setStatus(db, jobId, "saved", 100);
    setStatus(db, jobId, "applied", 200);

    undoLastStatus(db, jobId);

    const row = db
      .query<{ updated_at: number }, [number]>(
        "SELECT updated_at FROM applications WHERE job_id = ?",
      )
      .get(jobId)!;
    expect(row.updated_at).toBe(100);
  });

  test("returns null and does nothing when there's only one status ever set", () => {
    const { db, jobId } = freshDbWithJob();
    setStatus(db, jobId, "saved", 100);

    const restored = undoLastStatus(db, jobId);
    expect(restored).toBeNull();

    const current = db
      .query<{ status: string }, [number]>("SELECT status FROM applications WHERE job_id = ?")
      .get(jobId)!;
    expect(current.status).toBe("saved");
    expect(getStatusHistory(db, jobId)).toHaveLength(1);
  });

  test("returns null for a job with no application/status at all", () => {
    const { db, jobId } = freshDbWithJob();
    expect(undoLastStatus(db, jobId)).toBeNull();
  });

  test("undo can be applied repeatedly, walking back through history", () => {
    const { db, jobId } = freshDbWithJob();
    setStatus(db, jobId, "saved", 100);
    setStatus(db, jobId, "applied", 200);
    setStatus(db, jobId, "oa", 300);

    expect(undoLastStatus(db, jobId)).toBe("applied");
    expect(undoLastStatus(db, jobId)).toBe("saved");
    expect(undoLastStatus(db, jobId)).toBeNull(); // can't undo below the first status
  });
});

describe("setNotes and status_history (regression: implicit 'saved' must be logged)", () => {
  test("adding notes to an untracked job logs the implicit 'saved' transition", () => {
    const { db, jobId } = freshDbWithJob();
    setNotes(db, jobId, "looks interesting", 100);

    const history = getStatusHistory(db, jobId);
    expect(history).toEqual([{ status: "saved", at: 100 }]);

    const app = db
      .query<{ status: string; notes: string }, [number]>(
        "SELECT status, notes FROM applications WHERE job_id = ?",
      )
      .get(jobId)!;
    expect(app.status).toBe("saved");
    expect(app.notes).toBe("looks interesting");
  });

  test("editing notes on an already-tracked job does not add a spurious history entry", () => {
    const { db, jobId } = freshDbWithJob();
    setStatus(db, jobId, "applied", 100);
    setNotes(db, jobId, "following up", 200);

    const history = getStatusHistory(db, jobId);
    expect(history).toEqual([{ status: "applied", at: 100 }]);

    const app = db
      .query<{ status: string; notes: string }, [number]>(
        "SELECT status, notes FROM applications WHERE job_id = ?",
      )
      .get(jobId)!;
    expect(app.status).toBe("applied"); // unchanged
    expect(app.notes).toBe("following up");
  });

  test("undo works correctly after notes implicitly created the tracking row", () => {
    const { db, jobId } = freshDbWithJob();
    setNotes(db, jobId, "note before any real status change", 100);
    setStatus(db, jobId, "applied", 200);

    expect(undoLastStatus(db, jobId)).toBe("saved");
  });
});

describe("clearStatusHistory", () => {
  test("deletes every history entry for the job and returns the count", () => {
    const { db, jobId } = freshDbWithJob();
    setStatus(db, jobId, "saved", 100);
    setStatus(db, jobId, "applied", 200);
    setStatus(db, jobId, "interviewing", 300);

    const deleted = clearStatusHistory(db, jobId);
    expect(deleted).toBe(3);
    expect(getStatusHistory(db, jobId)).toEqual([]);
  });

  test("current status and notes are untouched — only the timeline is wiped", () => {
    const { db, jobId } = freshDbWithJob();
    setStatus(db, jobId, "applied", 100);
    setNotes(db, jobId, "great referral", 150);

    clearStatusHistory(db, jobId);

    const app = db
      .query<{ status: string; notes: string }, [number]>(
        "SELECT status, notes FROM applications WHERE job_id = ?",
      )
      .get(jobId)!;
    expect(app.status).toBe("applied");
    expect(app.notes).toBe("great referral");
  });

  test("returns 0 and is a no-op when there's nothing to clear", () => {
    const { db, jobId } = freshDbWithJob();
    expect(clearStatusHistory(db, jobId)).toBe(0);
  });

  test("only clears the given job's history, not other jobs'", () => {
    const db = new Database(":memory:");
    migrate(db);
    const raw = (id: string) => ({
      sourceId: "fake",
      sourceJobId: id,
      company: "Acme",
      title: "Engineer",
      url: "https://example.com",
      locations: ["Remote"],
    });
    upsertJob(db, raw("1"), 100);
    upsertJob(db, raw("2"), 100);
    const [jobA, jobB] = db.query<{ id: number }, []>("SELECT id FROM jobs ORDER BY id").all();

    setStatus(db, jobA!.id, "applied", 100);
    setStatus(db, jobB!.id, "applied", 100);

    clearStatusHistory(db, jobA!.id);

    expect(getStatusHistory(db, jobA!.id)).toEqual([]);
    expect(getStatusHistory(db, jobB!.id)).toHaveLength(1);
  });

  test("after clearing, undoLastStatus correctly has nothing left to walk back to", () => {
    const { db, jobId } = freshDbWithJob();
    setStatus(db, jobId, "applied", 100);
    setStatus(db, jobId, "interviewing", 200);

    clearStatusHistory(db, jobId);

    expect(undoLastStatus(db, jobId)).toBeNull();
    // Current status survives even though there's no history to undo from.
    const app = db
      .query<{ status: string }, [number]>("SELECT status FROM applications WHERE job_id = ?")
      .get(jobId)!;
    expect(app.status).toBe("interviewing");
  });
});
