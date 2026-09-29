import { compactDateLabel } from "@/lib/dates/display";
import { money } from "@/lib/today/brief";
import { titleCase } from "@/components/today/format";
import { Button } from "@/components/ui/Button";
import type { SpendingCardPayload } from "@/lib/chat/card-payload";
import styles from "./SpendingCard.module.css";

const CHART_W = 600;
const CHART_H = 160;

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
  const { filterLabel, currency, total, changePercent, comparisonLabel, insight, running, xTicks, changes, topMerchants, categories, actions, count, otherCurrencyCount } = payload;

  const periodLabel = compactDateLabel(payload.periodLabel);
  const priorPeriodLabel = payload.priorPeriodLabel ? compactDateLabel(payload.priorPeriodLabel) : null;
  const comparisonDates = priorPeriodLabel ?? compactDateLabel(comparisonLabel.replace(/^vs /, ""));
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
  const chartCategories = categories.filter(item => item.amountMinor > 0).sort((a,b)=>b.amountMinor-a.amountMinor);
  const maxChangeDelta = Math.max(1, ...changes.map((change) => Math.abs(change.delta)));

  return <section className={`${styles.card} ${running.length > 1 ? styles.wide : ""}`} aria-label={`Spending${filterLabel ? ` on ${filterLabel}` : ""}, ${periodLabel}`}>
    <p className={styles.eyebrow}>{filterLabel ? `${titleCase(filterLabel)} · ` : "Spending · "}{periodLabel}</p>
    <div className={styles.hero}>
      <p className={`${styles.big} ${payload.empty ? styles.emptyHeadline : ""}`}>{payload.empty ? "No spending recorded" : money(total, currency)}</p>
      {changePercent !== null && <span className={`${styles.pill} ${changePercent > 0 ? styles.pillWarn : styles.pillOk}`} title={`Compared with ${comparisonDates}`} aria-label={`${changePercent === 0 ? "Unchanged" : `${Math.abs(changePercent)}% ${changePercent > 0 ? "more" : "less"}`} compared with ${comparisonDates}`}>
        {changePercent === 0 ? "No change" : `${changePercent > 0 ? "▲" : "▼"} ${Math.abs(changePercent)}%`}
      </span>}
    </div>
    {changePercent !== null && <p className={styles.comparison}>Compared with {comparisonDates}</p>}
    {insight && <p className={styles.insight}>{insight}</p>}

    {chartCategories.length > 1 && <div className={styles.cats}>
      <div className={styles.segmented} aria-hidden="true">{chartCategories.map((item,index)=><span key={item.category} style={{flex:item.amountMinor,background:`var(--chart-${Math.min(index+1,4)})`}} />)}</div>
      <div className={styles.categoryLegend}>{chartCategories.map((item,index)=><div className={styles.catHead} key={item.category}>
        <span className={styles.catName}><i style={{background:`var(--chart-${Math.min(index+1,4)})`}}/>{titleCase(item.category)}</span>
        <span className={styles.catAmount}>{money(item.amountMinor,currency)} <small>{item.sharePercent}%</small></span>
      </div>)}</div>
    </div>}

    {running.length > 1 && <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.label}>Cumulative spending</span>
        <span className={styles.legend}><span><i className={styles.legendCurrent} />{periodLabel}</span><span><i className={styles.legendPrior} />{priorPeriodLabel ?? "Previous period"}</span></span>
      </div>
      <p className={styles.chartNote}>Total spent through each day, aligned by day of each period. Flat sections mean no additional recorded spending.</p>
      <div className={styles.chartRow}>
        <div className={styles.yAxis}>{[...gridlines].reverse().map((value) => <span key={value} style={{top:`${yFor(value)/CHART_H*100}%`}}>{money(value, currency).replace(/\.00$/, "")}</span>)}<span style={{top:"100%"}}>{money(0, currency).replace(/\.00$/, "")}</span></div>
        <div className={styles.chartArea}>
          <svg className={styles.chart} viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" aria-hidden="true">
            {gridlines.map((value) => <line key={value} className={styles.gridline} x1={0} x2={CHART_W} y1={yFor(value)} y2={yFor(value)} />)}
            <polygon className={styles.areaFill} points={`0,${CHART_H} ${currentPoints} ${CHART_W},${CHART_H}`} />
            <polyline className={styles.priorLine} points={priorPoints} />
            <polyline className={styles.currentLine} points={currentPoints} />
            {running.map((point,i)=><circle key={i} cx={xFor(i)} cy={yFor(point.current)} r="2.5" className={styles.point}/>)}
          </svg>
          <span className={styles.endLabelPrior} style={{ top: `${(yFor(priorLast) / CHART_H) * 100}%`, marginTop: Math.abs(yFor(priorLast)-yFor(currentLast))<24 ? -20 : 0 }}>{money(priorLast, currency)}</span>
          <span className={styles.endLabelCurrent} style={{ top: `${(yFor(currentLast) / CHART_H) * 100}%` }}>{money(currentLast, currency)}</span>
        </div>
      </div>
      <div className={styles.xAxis}>{xTicks.map((tick) => <span key={tick.offset} style={{ left: `${(xFor(tick.offset) / CHART_W) * 100}%` }}>{tick.label}</span>)}</div>
      <details className={styles.values}><summary>View daily totals</summary><div className={styles.tableWrap}><table><caption>Cumulative spending · {currency}</caption><thead><tr><th>Day</th><th>{periodLabel}</th><th>{priorPeriodLabel ?? "Previous period"}</th></tr></thead><tbody>{running.map((point,index)=><tr key={index}><th>{xTicks.find(tick=>tick.offset===index)?.label ?? `Day ${index+1}`}</th><td>{money(point.current,currency)}</td><td>{money(point.prior,currency)}</td></tr>)}</tbody></table></div></details>
    </div>}

    {changes.length > 0 && <div className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.label}>What changed</span>
        <span className={styles.legend}><i className={styles.legendLess} />Spent less<i className={styles.legendMore} />Spent more</span>
      </div>
      <div className={styles.changes}>{changes.map((change) => <div className={styles.changeRow} key={change.category}>
        <span className={styles.changeLabel}>{titleCase(change.category)}<small>{money(change.before, currency)} → {money(change.now, currency)}</small></span>
        <span className={styles.changeTrack} aria-hidden="true">
          <span className={`${styles.changeFill} ${change.delta < 0 ? styles.less : styles.more}`} style={{ width: `${(Math.abs(change.delta) / maxChangeDelta) * 50}%` }} />
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
      {actions.map((action) => <Button key={action.label} size="sm" variant="secondary" disabled={busy || !onFollowUp} onClick={() => onFollowUp?.(action.query)}>{action.label}</Button>)}
    </div>}

    <p className={styles.foot}>
      {count} transaction{count === 1 ? "" : "s"} · saved transactions
      {otherCurrencyCount > 0 ? ` · ${otherCurrencyCount} in another currency not included` : ""}
    </p>
  </section>;
}
