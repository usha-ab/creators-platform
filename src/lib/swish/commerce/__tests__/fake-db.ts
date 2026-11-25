/**
 * En liten Supabase-fake i minnet för Swish Handel-testerna: select med
 * eq/neq/order/limit, insert, update med villkor (så att "uppdatera bara om
 * status = pending" fungerar som i Postgres) och rpc.
 */
export type Row = Record<string, unknown>;

export function fakeDb(tables: Record<string, Row[]>) {
  const rpcCalls: { fn: string; args: Row }[] = [];

  function from(table: string) {
    const rows = (tables[table] ??= []);
    const eqs: [string, unknown][] = [];
    const neqs: [string, unknown][] = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row = {};
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    let wantRows = false;

    const match = () =>
      rows.filter((r) => eqs.every(([c, v]) => r[c] === v) && neqs.every(([c, v]) => r[c] !== v));

    const run = (): { data: unknown; error: { message: string; code?: string } | null } => {
      if (op === "insert") {
        if (table === "swish_payment_requests") {
          if (rows.some((r) => r.id === payload.id)) return { data: null, error: { message: "duplicate", code: "23505" } };
          rows.push({ status: "CREATED", created_at: new Date().toISOString(), last_checked_at: null, token: null, payment_reference: null, error_code: null, ...payload });
        } else rows.push({ ...payload });
        return { data: payload, error: null };
      }
      if (op === "update") {
        const hit = match();
        // Unikt index: högst en PAID per bokning.
        if (table === "swish_payment_requests" && payload.status === "PAID") {
          for (const r of hit) {
            if (rows.some((o) => o !== r && o.booking_id === r.booking_id && o.status === "PAID")) {
              return { data: null, error: { message: "unique violation", code: "23505" } };
            }
          }
        }
        hit.forEach((r) => Object.assign(r, payload));
        return { data: wantRows ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      let out = match().map((r) => ({ ...r }));
      if (order) {
        const { col, asc } = order;
        out.sort((a, b) => (String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : String(a[col]) > String(b[col]) ? (asc ? 1 : -1) : 0));
      }
      if (limit != null) out = out.slice(0, limit);
      return { data: out, error: null };
    };

    const one = async () => {
      const r = run();
      if (r.error) return { data: null, error: r.error };
      return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null };
    };

    const b = {
      select: () => ((wantRows = true), b),
      insert: (p: Row) => ((op = "insert"), (payload = p), b),
      update: (p: Row) => ((op = "update"), (payload = p), (wantRows = false), b),
      eq: (c: string, v: unknown) => (eqs.push([c, v]), b),
      neq: (c: string, v: unknown) => (neqs.push([c, v]), b),
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), b),
      limit: (n: number) => ((limit = n), b),
      maybeSingle: one,
      single: one,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  }

  const admin = {
    from,
    rpc: (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      if (fn === "increment_tickets_sold") {
        const l = (tables.listings ?? []).find((r) => r.id === args.p_listing);
        if (l) l.tickets_sold = Number(l.tickets_sold ?? 0) + Number(args.p_n);
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { admin, tables, rpcCalls };
}
