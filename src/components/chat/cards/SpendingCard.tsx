import { money } from "@/lib/today/brief";
import { titleCase } from "@/components/today/format";
import { Button } from "@/components/ui/Button";
import type { SpendingCardPayload } from "@/lib/chat/card-payload";
import styles from "./SpendingCard.module.css";

const CHART_W = 600;
const CHART_H = 140;

/** The smallest "nice" (1/2/5 x a power of ten) step that gives roughly `targetLines` gridlines up to maxValue. */
function niceStep(maxValue: number, targetLines = 3): number {
  if (maxValue <= 0) return 100;
  const raw = maxValue / targetLines;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const step = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return step * magnitude;
}

/** The richer "how was my spending" card: hero total, a running-total line chart against the prior period,
 * a diverging bar per category that moved, top merchants, and one or two suggested follow-ups. */
export function SpendingCard({ payload, onFollowUp, busy }: { payload: SpendingCardPayload; onFollowUp?: (text: string) => void; busy?: boolean }) {
  const { periodLabel, filterLabel, currency, total, changePercent, comparisonLabel, insight, running, xTicks, changes, topMerchants, categories, actions, count, otherCurrencyCount } = payload;

  const maxValue = Math.max(1, ...running.map((point) => Math.max(point.current, point.prior)));
  const step = niceStep(maxValue);
  const chartMax = step * Math.ceil(maxValue / step);
  const gridlines = Array.from({ length: Math.round(chartMax / step) }, (_, i) => step * (i + 1));
  const yFor = (value: number) => CHART_H - (value / chartMax) * CHART_H;
  const xFor = (offset: number) => (running.length > 1 ? (offset / (running.length - 1)) * CHART_W : 0);
  const currentPoints = running.map((point, i) => `${xFor(i)},${yFor(point.current)}`).join(" ");
  const priorPoints = running.map((point, i) => `${xFor(i)},${yFor(point.prior)}`).join(" ");
  const currentLast = running[running.length - 1]?.current ?? 0;
  const priorLast = running[running.length - 1]?.prior ?? 0;
  const maxChangeDelta = Math.max(1, ...changes.map((change) => Math.abs(change.delta)));

  return <section className={styles.card} aria-label={`Spending${filterLabel ? ` on ${filterLabel}` : ""}, ${periodLabel}`}>
    <p className={styles.eyebrow}>{filterLabel ? `${titleCase(filterLabel)} · ` : "Spending · "}{periodLabel}</p>
    <div className={styles.hero}>
      <p className={styles.big}>{money(total, currency)}</p>
      {changePercent !== null && <span className={`${styles.pill} ${changePercent > 0 ? styles.pillWarn : styles.pillOk}`}>
        {changePercent === 0 ? `Level ${comparisonLabel}` : `${changePercent > 0 ? "▲" : "▼"} ${Math.abs(changePercent)}% ${comparisonLabel}`}
      </span>}
    </div>
    {insight && <p className={styles.insight}>{insight}</p>}

    {categories.length > 0 && <div className={styles.cats}>{categories.map((item) => <div className={styles.catRow} key={item.category}>
      <span className={styles.catHead}>
        <span className={styles.catName}>{titleCase(item.category)}</span>
        <span className={styles.catAmount}>{money(item.amountMinor, currency)}</span>
      </span>
      <span className={styles.catBar} aria-hidden="true"><span className={styles.catFill} style={{ width: `${Math.max(item.sharePercent, 3)}%` }} /></span>
    </div>)}</div>}

    {running.length > 1 && <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.label}>Running total</span>
        <span className={styles.legend}><i className={styles.legendCurrent} />This period<i className={styles.legendPrior} />Prior period</span>
      </div>
      <div className={styles.chartRow}>
        <div className={styles.yAxis}>{[...gridlines].reverse().map((value) => <span key={value}>{money(value, currency)}</span>)}<span>{money(0, currency)}</span></div>
        <div className={styles.chartArea}>
          <svg className={styles.chart} viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" aria-hidden="true">
            {gridlines.map((value) => <line key={value} className={styles.gridline} x1={0} x2={CHART_W} y1={yFor(value)} y2={yFor(value)} />)}
            <polyline className={styles.priorLine} points={priorPoints} />
            <polyline className={styles.currentLine} points={currentPoints} />
          </svg>
          <span className={styles.endLabelPrior} style={{ top: `${(yFor(priorLast) / CHART_H) * 100}%` }}>{money(priorLast, currency)}</span>
          <span className={styles.endLabelCurrent} style={{ top: `${(yFor(currentLast) / CHART_H) * 100}%` }}>{money(currentLast, currency)}</span>
        </div>
      </div>
      <div className={styles.xAxis}>{xTicks.map((tick) => <span key={tick.offset} style={{ left: `${(xFor(tick.offset) / CHART_W) * 100}%` }}>{tick.label}</span>)}</div>
    </div>}

    {changes.length > 0 && <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.label}>What changed</span>
        <span className={styles.legend}><i className={styles.legendLess} />Spent less<i className={styles.legendMore} />Spent more</span>
      </div>
      <div className={styles.changes}>{changes.map((change) => <div className={styles.changeRow} key={change.category}>
        <span className={styles.changeLabel}>{titleCase(change.category)}<small>{money(change.now, currency)} now</small></span>
        <span className={styles.changeTrack} aria-hidden="true">
          <span className={`${styles.changeFill} ${change.delta < 0 ? styles.less : styles.more}`} style={{ width: `${Math.max((Math.abs(change.delta) / maxChangeDelta) * 50, 4)}%` }} />
        </span>
        <span className={`${styles.changeDelta} ${change.delta < 0 ? styles.less : styles.more}`}>{change.delta < 0 ? "−" : "+"}{money(Math.abs(change.delta), currency)}</span>
      </div>)}</div>
    </div>}

    {topMerchants.length > 0 && <div className={styles.section}>
      <span className={styles.label}>Top merchants</span>
      <div className={styles.merchants}>{topMerchants.map((merchant) => <div className={styles.merchantRow} key={merchant.merchant}>
        <span className={styles.merchantName}>{merchant.merchant}{merchant.count > 1 && <span className={styles.tag}>{merchant.count} charges</span>}</span>
        <span className={styles.merchantAmount}>{money(merchant.amountMinor, currency)}</span>
      </div>)}</div>
    </div>}

    {actions.length > 0 && <div className={styles.actions}>
      {actions.map((action, i) => <Button key={action.label} size="sm" variant={i === 0 ? "primary" : "secondary"} disabled={busy || !onFollowUp} onClick={() => onFollowUp?.(action.query)}>{action.label}</Button>)}
    </div>}

    <p className={styles.foot}>
      {count} transaction{count === 1 ? "" : "s"} · from your linked bank
      {otherCurrencyCount > 0 ? ` · ${otherCurrencyCount} in another currency not included` : ""}
    </p>
  </section>;
}
