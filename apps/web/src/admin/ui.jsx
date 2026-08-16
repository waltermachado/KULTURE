/**
 * Peças de UI do backoffice: formatação, pill de status, paginação, gráfico de barras (SVG puro).
 */
import { brl } from "../lib/format.js";

export { brl };

export const STATUS_LABELS = {
  pending_payment: "Aguardando pagamento",
  paid: "Pago",
  sourcing: "Comprando nos EUA",
  shipped: "Enviado",
  delivered: "Entregue",
  abandoned: "Abandonado",
  cancelled: "Cancelado",
  refunded: "Estornado"
};

export const STATUS_ORDER = ["pending_payment", "paid", "sourcing", "shipped", "delivered", "abandoned", "cancelled", "refunded"];

export const METHOD_LABELS = { pix: "Pix", credit_card: "Cartão", outro: "Outro", unknown: "—" };

export function StatusPill({ status }) {
  return <span className={`pill ${status || ""}`}>{STATUS_LABELS[status] || status || "—"}</span>;
}

export function RolePill({ role }) {
  return <span className={`pill ${role}`}>{role === "admin" ? "Admin" : "Cliente"}</span>;
}

export const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
export const fmtDateTime = (v) =>
  v ? new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
export const fmtPhone = (v) => {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v || "—";
};
export const fmtCpf = (v) => {
  const d = String(v || "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : v || "—";
};
export const fmtAddress = (a) => {
  if (!a || typeof a !== "object") return "—";
  const l1 = [a.street, a.number].filter(Boolean).join(", ") + (a.complement ? ` — ${a.complement}` : "");
  const l2 = [a.neighborhood, a.city && a.state ? `${a.city}/${a.state}` : a.city || a.state].filter(Boolean).join(" · ");
  const cep = a.cep ? `CEP ${String(a.cep).replace(/(\d{5})(\d{3})/, "$1-$2")}` : "";
  return [l1, l2, cep].filter((s) => s && s.trim()).join(" · ") || "—";
};

export function Pager({ page, pages, total, onPage }) {
  if (!pages || pages <= 1) return total != null ? <div className="pager">{total} registro(s)</div> : null;
  return (
    <div className="pager">
      <span>{total} registro(s) · página {page}/{pages}</span>
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Anterior</button>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Próxima →</button>
    </div>
  );
}

/** Gráfico de barras diário (receita). SVG puro — sem dependência. */
export function BarChart({ series = [], valueKey = "revenue", height = 220 }) {
  const w = 720;
  const padL = 44, padB = 22, padT = 10;
  const innerW = w - padL - 8;
  const innerH = height - padB - padT;
  const max = Math.max(...series.map((s) => Number(s[valueKey]) || 0), 1);
  const n = series.length || 1;
  const gap = n > 40 ? 1 : 3;
  const bw = Math.max((innerW - gap * (n - 1)) / n, 1);
  const ticks = [0, 0.5, 1].map((t) => ({ y: padT + innerH - innerH * t, v: max * t }));
  const short = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v)));
  const label = (d) => d.slice(8, 10) + "/" + d.slice(5, 7);
  const every = n > 20 ? Math.ceil(n / 10) : 1;
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label="Receita por dia">
      {ticks.map((t) => (
        <g key={t.v}>
          <line className="axis" x1={padL} x2={w - 8} y1={t.y} y2={t.y} />
          <text x={padL - 6} y={t.y + 3} textAnchor="end">{short(t.v)}</text>
        </g>
      ))}
      {series.map((s, i) => {
        const v = Number(s[valueKey]) || 0;
        const h = (v / max) * innerH;
        const x = padL + i * (bw + gap);
        return (
          <g key={s.date}>
            <rect className={`bar${v ? "" : " zero"}`} x={x} y={padT + innerH - (v ? h : 1)} width={bw} height={v ? h : 1}>
              <title>{`${label(s.date)} — ${brl(v)} · ${s.orders} pedido(s)`}</title>
            </rect>
            {i % every === 0 && (
              <text x={x + bw / 2} y={height - 6} textAnchor="middle">{label(s.date)}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Barras horizontais (ranking). */
export function HBars({ rows = [], labelKey = "label", valueKey = "value", format = (v) => v }) {
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
  if (!rows.length) return <div className="empty">Sem dados no período</div>;
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div className="row" key={r.key ?? i}>
          <span className="lbl" title={r[labelKey]}>{r[labelKey]}</span>
          <span className="track"><i style={{ width: `${(Number(r[valueKey]) / max) * 100}%` }} /></span>
          <span className="val">{format(r[valueKey])}</span>
        </div>
      ))}
    </div>
  );
}

export function Loading({ children = "Carregando" }) {
  return <div className="loading">{children}…</div>;
}
export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="err">{error.message || String(error)}</div>;
}
