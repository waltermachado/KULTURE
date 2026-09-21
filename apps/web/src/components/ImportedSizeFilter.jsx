import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const tone = {
  shell: "mx-auto w-full px-4 pt-6 sm:px-6 lg:px-8 2xl:px-10",
  panel:
    "relative mx-auto w-full max-w-none overflow-hidden rounded-[28px] border border-[#2f2f2a] bg-[#121310] text-[#f5f1e8] shadow-[0_24px_80px_rgba(0,0,0,0.28)]",
  glow:
    "pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,211,31,0.18),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.06),transparent_24%)]",
};

function actionClass() {
  return "h-10 rounded-full border border-[#3a3b33] bg-transparent px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#d6d1c5] hover:border-[var(--yellow)] hover:bg-[rgba(255,211,31,0.08)] hover:text-[var(--yellow)]";
}

function expandedSizeClass(active, available) {
  return cn(
    "h-auto min-h-[74px] rounded-[16px] border px-2 py-3 transition-all duration-150 ease-out active:scale-[0.98]",
    "flex flex-col items-center justify-center gap-1.5",
    active
      ? "border-[var(--yellow)] bg-[var(--yellow)] text-[var(--ink)] hover:bg-[var(--yellow)]/95"
      : available
        ? "border-[#34352d] bg-[#1b1c18] text-[#f3efe5] hover:border-[#5b5c50] hover:bg-[#20211d]"
        : "border-[#292a24] bg-[#121310] text-[#7e7a71] hover:border-[#3a3b33] hover:text-[#cfc8b9]"
  );
}

export default function ImportedSizeFilter({
  size,
  sizes,
  sizeStatus,
  onSelectSize,
  onRetry,
}) {
  const [showAllSizes, setShowAllSizes] = useState(false);
  const hasSelection = Boolean(size);
  const sizeMap = useMemo(() => new Map(sizes.map(entry => [String(entry.br), entry.count])), [sizes]);
  const availableSizes = useMemo(
    () => [...new Set(sizes.map(entry => String(entry.br)).filter(Boolean))].sort((a, b) => Number(a) - Number(b)),
    [sizes]
  );
  const visibleSizes = useMemo(() => {
    if (!size || availableSizes.includes(String(size))) return availableSizes;
    return [...availableSizes, String(size)].sort((a, b) => Number(a) - Number(b));
  }, [availableSizes, size]);

  return (
    <section className={tone.shell} aria-label="Filtro de tamanho dos importados">
      <div className={tone.panel}>
        <div className={tone.glow} />
        <div className="relative grid gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:gap-6 lg:px-8 lg:py-7">
          <div className="flex flex-col items-center gap-3 text-center lg:items-start lg:gap-4 lg:text-left">
            <h2 className="text-[28px] leading-[0.96] font-black tracking-[-0.05em] text-[#fbf7ec] text-balance sm:text-[34px]">
              Filtre seu tamanho
            </h2>
            <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              <Button
                type="button"
                variant="outline"
                className={actionClass()}
                onClick={() => setShowAllSizes(value => !value)}
                aria-expanded={showAllSizes}
              >
                {showAllSizes ? "Fechar tamanhos" : "Ver todos os tamanhos"}
              </Button>
              {hasSelection && (
                <Button type="button" variant="outline" className={actionClass()} onClick={() => onSelectSize("")}>
                  Limpar filtro
                </Button>
              )}
              {sizeStatus === "error" && (
                <Button type="button" variant="outline" className={actionClass()} onClick={onRetry}>
                  Tentar novamente
                </Button>
              )}
            </div>
            <span className="text-[12px] font-medium tracking-[0.02em] text-[#9f9b90]">
              {hasSelection ? `Tamanho ${size} selecionado` : "Nenhum tamanho selecionado"}
            </span>
          </div>

          {showAllSizes && (
            <div className="mx-auto w-full rounded-[22px] border border-[#2a2b24] bg-[#141512] p-3 sm:p-4">
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5">
                <Button
                  type="button"
                  variant="ghost"
                  className={expandedSizeClass(!hasSelection, true)}
                  aria-pressed={!hasSelection}
                  onClick={() => onSelectSize("")}
                >
                  <span className="text-[17px] font-black tracking-[-0.04em]">Todos</span>
                  <span className="text-[10px] font-medium text-[#5c4900]">Sem filtro</span>
                </Button>
                {visibleSizes.map(br => {
                  const count = sizeMap.get(br) ?? 0;
                  const active = size === br;
                  return (
                    <Button
                      key={br}
                      type="button"
                      variant="ghost"
                      className={expandedSizeClass(active, count > 0)}
                      aria-pressed={active}
                      onClick={() => onSelectSize(br)}
                    >
                      <span className="text-[17px] font-black tracking-[-0.04em]">{br}</span>
                      <span className={cn("text-[10px] font-medium", active ? "text-[#5c4900]" : count > 0 ? "text-[#938d80]" : "text-[#6f6a61]")}>
                        {count > 0 ? `${count} par${count === 1 ? "" : "es"}` : "Sem pares"}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
