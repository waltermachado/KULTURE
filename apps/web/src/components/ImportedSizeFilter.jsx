import { useMemo, useState } from "react";
import { standardSizes } from "@kulture/shared/sizes";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const tone = {
  shell: "mx-auto w-full max-w-[1408px] px-4 pt-6 sm:px-6 lg:px-8",
  panel:
    "relative mx-auto w-full max-w-[1120px] overflow-hidden rounded-[28px] border border-[#2f2f2a] bg-[#121310] text-[#f5f1e8] shadow-[0_24px_80px_rgba(0,0,0,0.28)]",
  glow:
    "pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,211,31,0.18),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.06),transparent_24%)]",
};

function chipClass(active) {
  return cn(
    "group h-auto min-w-[72px] shrink-0 rounded-[18px] border px-4 py-3 transition-all duration-150 ease-out active:scale-[0.98]",
    "flex flex-col items-center justify-center gap-1.5",
    "sm:min-w-[78px]",
    active
      ? "border-[var(--yellow)] bg-[var(--yellow)] text-[var(--ink)] shadow-[0_14px_28px_rgba(255,211,31,0.16)] hover:bg-[var(--yellow)]/95"
      : "border-[#30312b] bg-[#1a1b17] text-[#f5f1e8] hover:border-[#57584d] hover:bg-[#20211c]"
  );
}

function actionClass() {
  return "h-10 rounded-full border border-[#3a3b33] bg-transparent px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#d6d1c5] hover:border-[var(--yellow)] hover:bg-[rgba(255,211,31,0.08)] hover:text-[var(--yellow)]";
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
  const hasCurrentSize = sizes.some(entry => entry.br === size);
  const quickSizes = useMemo(() => sizes.slice(0, 14), [sizes]);
  const allSizes = useMemo(() => {
    const fromStandard = standardSizes().map(entry => String(entry.brLabel ?? entry.brSize)).filter(Boolean);
    const merged = new Set([...fromStandard, ...sizes.map(entry => String(entry.br))]);
    if (size) merged.add(String(size));
    return [...merged].sort((a, b) => Number(a) - Number(b));
  }, [size, sizes]);

  return (
    <section className={tone.shell} aria-label="Filtro de tamanho dos importados">
      <div className={tone.panel}>
        <div className={tone.glow} />
        <div className="relative grid gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:gap-6 lg:px-8">
          <div className="flex flex-col items-center justify-center gap-3 text-center lg:flex-row lg:items-center lg:justify-between lg:text-left">
            <h2 className="w-full max-w-[12ch] text-[28px] leading-[0.96] font-black tracking-[-0.05em] text-[#fbf7ec] text-balance sm:text-[34px] lg:max-w-none lg:flex-1 lg:text-[32px] lg:leading-[0.92]">
              Filtre seu tamanho
            </h2>
            <div className="flex flex-wrap items-center justify-center gap-2 lg:flex-none lg:justify-end">
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
            <div className="hidden lg:block" aria-hidden="true" />
          </div>

          <ScrollArea className="mx-auto w-full max-w-[1040px] whitespace-nowrap rounded-[22px] border border-[#272822] bg-[#161713] p-1.5">
            <div className="mx-auto flex w-max min-w-full justify-center gap-2 lg:justify-center">
              <Button
                type="button"
                variant="ghost"
                className={chipClass(!hasSelection)}
                aria-pressed={!hasSelection}
                onClick={() => onSelectSize("")}
              >
                <span className="text-[15px] font-black tracking-[-0.03em]">Todos</span>
                <span className={cn("text-[10px] font-medium", !hasSelection ? "text-[#5c4900]" : "text-[#8b8578]")}>
                  BR
                </span>
              </Button>

              {quickSizes.map(entry => {
                const active = size === entry.br;
                return (
                  <Button
                    key={entry.br}
                    type="button"
                    variant="ghost"
                    className={chipClass(active)}
                    aria-pressed={active}
                    onClick={() => onSelectSize(entry.br)}
                  >
                    <span className="text-[18px] font-black tracking-[-0.04em]">{entry.br}</span>
                    <span className={cn("text-[10px] font-medium", active ? "text-[#5c4900]" : "text-[#8b8578]")}>
                      {entry.count} par{entry.count === 1 ? "" : "es"}
                    </span>
                  </Button>
                );
              })}

              {hasSelection && !quickSizes.some(entry => entry.br === size) && (
                <Button
                  type="button"
                  variant="ghost"
                  className="group h-auto min-w-[72px] shrink-0 rounded-[18px] border border-[rgba(255,211,31,0.35)] bg-[rgba(255,211,31,0.12)] px-4 py-3 text-[#f6e8b7] transition-all duration-150 ease-out hover:bg-[rgba(255,211,31,0.16)]"
                  aria-pressed="true"
                  onClick={() => onSelectSize(size)}
                >
                  <span className="text-[18px] font-black tracking-[-0.04em]">{size}</span>
                  <span className="text-[10px] font-medium text-[#c8b76d]">
                    {hasCurrentSize ? "Disponível" : "Sem pares"}
                  </span>
                </Button>
              )}
            </div>
            <ScrollBar orientation="horizontal" className="hidden" />
          </ScrollArea>

          {showAllSizes && (
            <div className="mx-auto w-full max-w-[1040px] rounded-[22px] border border-[#2a2b24] bg-[#141512] p-3 sm:p-4">
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-8 xl:grid-cols-10">
                {allSizes.map(br => {
                  const count = sizes.find(entry => entry.br === br)?.count ?? 0;
                  const active = size === br;
                  return (
                    <Button
                      key={br}
                      type="button"
                      variant="ghost"
                      className={cn(
                        "h-auto min-h-[68px] rounded-[16px] border px-2 py-3 transition-all duration-150 ease-out active:scale-[0.98]",
                        "flex flex-col items-center justify-center gap-1.5",
                        active
                          ? "border-[var(--yellow)] bg-[var(--yellow)] text-[var(--ink)] hover:bg-[var(--yellow)]/95"
                          : count > 0
                            ? "border-[#34352d] bg-[#1b1c18] text-[#f3efe5] hover:border-[#5b5c50] hover:bg-[#20211d]"
                            : "border-[#292a24] bg-[#121310] text-[#7e7a71] hover:border-[#3a3b33] hover:text-[#cfc8b9]"
                      )}
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
