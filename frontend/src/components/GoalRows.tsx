import { categoryOf, detail, glyph, rowScale, tone, upperEnd, word, zones } from "../lib/goals";
import { fmtHours, fmtRange } from "../lib/format";
import { colorVar } from "../lib/theme";
import type { GoalProgress, Settings } from "../lib/types";

const ROW = 30;      // drawing height per goal (bar 10px, rail 4px under it)
const BAR = 10;
const RAIL = 4;

/** One bullet row per goal: the bar, the zone rail, the goal line and the expected-by-now mark. */
function Bullet({ item, settings }: { item: GoalProgress; settings: Settings }) {
  const scale = rowScale(item);
  const pct = (hours: number) => `${Math.min(100, (hours / scale) * 100)}%`;
  const target = upperEnd(item);
  return (
    <svg className="bullet" viewBox={`0 0 100 ${ROW}`} preserveAspectRatio="none" height={ROW} role="img"
      aria-label={`${fmtHours(item.actual)} of ${item.label}`}>
      {/* the zone rail, 4px under the bar */}
      {zones(item).map((zone) => (
        <rect key={zone.tone + zone.from} x={pct(zone.from)} y={BAR + 4} height={RAIL}
          width={pct(Math.max(0, zone.to - zone.from))} fill={`var(--zone-${zone.tone})`} />
      ))}
      {/* "at this rate", from the bar end to where the period would end up */}
      {item.projected !== null && item.projected > item.actual && (
        <rect x={pct(item.actual)} y={0.5} height={BAR - 1} width={pct(item.projected - item.actual)}
          fill="none" stroke="var(--projection)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      )}
      <rect x={0} y={0} height={BAR} width={pct(item.actual)} fill={`var(--${colorVar(categoryOf(item.scope), settings)})`} />
      {target > 0 && (
        <rect x={pct(target)} y={0} width={1.5} height={BAR + RAIL + 4} fill="var(--goal-line)"
          vectorEffect="non-scaling-stroke" />
      )}
      {/* expected by now: one mark for a floor or cap, a bracket for a range */}
      {item.expected !== null && item.running && (
        <rect x={pct(item.expected)} y={-2} width={2} height={BAR + 6} fill="var(--expected)"
          vectorEffect="non-scaling-stroke" />
      )}
      {item.running && item.expected_min !== null && item.expected_max !== null && (
        <rect x={pct(item.expected_min)} y={-2} width={pct(item.expected_max - item.expected_min)} height={2}
          fill="var(--expected)" />
      )}
    </svg>
  );
}

interface Props {
  items: GoalProgress[];
  settings: Settings;
  onShowBlocks?: (item: GoalProgress) => void;
}

/** The goal rows, weekly first, each group under the period it is judged over. */
export default function GoalRows({ items, settings, onShowBlocks }: Props) {
  const groups = (["week", "month"] as const)
    .map((every) => ({ every, rows: items.filter((item) => item.every === every) }))
    .filter((group) => group.rows.length);
  return (
    <div className="goals">
      {groups.map(({ every, rows }) => (
        <div key={every}>
          <div className="goalgroup">
            {every === "week" ? "Weekly" : "Monthly"} · {fmtRange(rows[0].first_day, rows[0].last_day)}
            {rows[0].running && <> · {Math.round(rows[0].elapsed * 100)}% elapsed</>}
          </div>
          {rows.map((item) => (
            <div className="goalrow" key={item.id}>
              <div className="who">
                <span className="cat">{item.scope}</span>{" "}
                <span className="faint">{item.label}</span>
              </div>
              <div className="meter">
                {item.type === "fixed" ? <span className="faint small">not judged on hours</span>
                  : <Bullet item={item} settings={settings} />}
              </div>
              <div className="value">
                {onShowBlocks ? (
                  <button className="linkbtn" onClick={() => onShowBlocks(item)}
                    title={`Show the ${item.blocks} block(s) behind this goal`}>
                    {fmtHours(item.actual, item.estimated > 0)}
                  </button>
                ) : fmtHours(item.actual, item.estimated > 0)}
              </div>
              <div className={`status st-${tone(item.status)}`}>
                <span aria-hidden="true">{glyph(item.status)}</span> {word(item)}
                {detail(item) && <div className="faint small">{detail(item)}</div>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
