import { describe, it, expect } from "vitest";
import { groupBySeries } from "../group-series";

const rad = (id: string, series_id: string | null, event_date: string | null) => ({
  id, series_id, event_date,
});

describe("groupBySeries", () => {
  it("slår ihop en serie till en post och räknar resten", () => {
    const g = groupBySeries([
      rad("a", "s1", "2026-09-21"),
      rad("b", "s1", "2026-09-28"),
      rad("c", "s1", "2026-10-05"),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].forsta.id).toBe("a");
    expect(g[0].fler).toBe(2);
    expect(g[0].alla.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("låter närmaste kvällen representera serien även om inmatningen är osorterad", () => {
    const g = groupBySeries([
      rad("sen", "s1", "2026-10-05"),
      rad("tidig", "s1", "2026-09-21"),
    ]);
    expect(g[0].forsta.id).toBe("tidig");
  });

  it("håller isär två serier", () => {
    const g = groupBySeries([
      rad("m1", "mandag", "2026-09-21"),
      rad("t1", "torsdag", "2026-09-24"),
      rad("m2", "mandag", "2026-09-28"),
    ]);
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.forsta.id)).toEqual(["m1", "t1"]);
  });

  it("klumpar INTE ihop lösa listningar utan serie", () => {
    const g = groupBySeries([
      rad("tjanst1", null, null),
      rad("tjanst2", null, null),
      rad("tjanst3", null, null),
    ]);
    expect(g).toHaveLength(3);
    expect(g.every((x) => x.fler === 0)).toBe(true);
  });

  it("bevarar ordningen — posten hamnar där serien först dök upp", () => {
    const g = groupBySeries([
      rad("tjanst", null, null),
      rad("m1", "mandag", "2026-09-21"),
      rad("m2", "mandag", "2026-09-28"),
    ]);
    expect(g.map((x) => x.forsta.id)).toEqual(["tjanst", "m1"]);
  });
});
