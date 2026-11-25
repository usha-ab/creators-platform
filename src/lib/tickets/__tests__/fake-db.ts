/**
 * En liten minnesdatabas med Supabase-klientens kedje-API, precis så mycket
 * som incheckningen använder: select/eq/is/in/order, update/insert,
 * maybeSingle/single och count med head. Unika index anges per tabell så att
 * dubbelklipp kan provas (23505).
 */
type Row = Record<string, unknown>;

export interface FakeDb {
  tables: Record<string, Row[]>;
  unique?: Record<string, string[][]>;
}

export function fakeAdmin(db: FakeDb) {
  let seq = 0;
  return {
    from(table: string) {
      const rows = (db.tables[table] ??= []);
      const filters: ((r: Row) => boolean)[] = [];
      let op: "select" | "update" | "insert" = "select";
      let patch: Row | null = null;
      let inserted: Row | null = null;
      let head = false;
      let countMode = false;
      let returning = false;

      const matching = () => rows.filter((r) => filters.every((f) => f(r)));

      const run = () => {
        if (op === "insert") {
          const row: Row = { id: `gen-${++seq}`, is_manual: false, ...inserted! };
          const keys = db.unique?.[table] ?? [];
          for (const cols of keys) {
            if (rows.some((r) => cols.every((c) => r[c] === row[c]))) {
              return { data: null, error: { code: "23505", message: "duplicate" }, count: null };
            }
          }
          rows.push(row);
          return { data: returning ? [row] : null, error: null, count: null };
        }
        if (op === "update") {
          const hit = matching();
          for (const r of hit) Object.assign(r, patch);
          return { data: returning ? hit : null, error: null, count: null };
        }
        const hit = matching();
        return { data: head ? null : hit, error: null, count: countMode ? hit.length : null };
      };

      const q: any = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          if (op !== "select") returning = true;
          if (opts?.count) countMode = true;
          if (opts?.head) head = true;
          return q;
        },
        update(p: Row) {
          op = "update";
          patch = p;
          return q;
        },
        insert(r: Row) {
          op = "insert";
          inserted = r;
          return q;
        },
        eq(col: string, v: unknown) {
          filters.push((r) => r[col] === v);
          return q;
        },
        is(col: string, v: unknown) {
          filters.push((r) => (r[col] ?? null) === v);
          return q;
        },
        in(col: string, vs: unknown[]) {
          filters.push((r) => vs.includes(r[col]));
          return q;
        },
        ilike(col: string, v: string) {
          filters.push((r) => String(r[col] ?? "").toLowerCase() === v.toLowerCase());
          return q;
        },
        limit() {
          return q;
        },
        not() {
          return q;
        },
        order() {
          return q;
        },
        maybeSingle() {
          const r = run();
          const arr = (r.data as Row[] | null) ?? [];
          return Promise.resolve({ data: arr[0] ?? null, error: r.error });
        },
        single() {
          return q.maybeSingle();
        },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve(run()).then(res, rej);
        },
      };
      return q;
    },
  };
}

/** Översättaren i testen: nyckeln själv, så att svaren går att jämföra. */
export const tKey = (key: string) => key;
