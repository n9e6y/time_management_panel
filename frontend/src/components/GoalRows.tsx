import { categoryOf, detail, glyph, goalLines, groupLine, rowScale, tone, word, zones } from "../lib/goals";
import { fmtHours } from "../lib/format";
import { pct } from "../lib/geometry";
import { fillOf } from "../lib/theme";
import type { GoalProgress, Settings } from "../lib/types";

/** One goal's meter: zone rail, logged bar, "at this rate", the goal line(s) and the expected-by-now mark. */
function Bullet({ item, settings }: { item: GoalProgress; settings: Settings }) {
  const scale = rowScale(item);
  const at = (hours: number) => pct(Math.min(1, hours / scale));
  const fill = fillOf(categoryOf(item.scope), settings);
  const rate = item.projected !== null && item.projected > item.actual;
  return (
    <div className="bullet" role="img" aria-label={`${fmtHours(item.actual)} of ${item.label}`}>
      {zones(item).map((zone) => (
        <div key={zone.tone + zone.from} className={`zone zone-${zone.tone}`}
          style={{ left: at(zone.from), width: at(Math.max(0, zone.to - zone.from)) }} />
      ))}
      {rate && <div className="proj" style={{ left: at(item.actual), width: at(item.projected! - item.actual) }} />}
      <div className="bar" style={{ width: at(item.actual), background: fill }} />
      {goalLines(item).map((line) => (
        <div key={line.label}>
          <div className="line" style={{ left: at(line.at) }} />
          <div className="line-label" style={{ left: at(line.at) }}>{line.label}</div>
        </div>
      ))}
      {item.running && item.expected !== null && (
        <div className="expected" title="expected by now" style={{ left: at(item.expected) }} />
      )}
      {item.running && item.type === "range" && item.expected_min !== null && item.expected_max !== null && (
        <div className="bracket" title="expected by now"
          style={{ left: at(item.expected_min), width: at(item.expected_max - item.expected_min) }} />
      )}
    </div>
  );
}

function Row({ item, settings, onShowBlocks }: { item: GoalProgress; settings: Settings; onShowBlocks?: (item: GoalProgress) => void }) {
  const value = fmtHours(item.actual, item.estimated > 0);
  const body = (
    <>
      <div className="who">
        <span className="scope">{item.scope}</span>
        <span className="label">{item.label}</span>
      </div>
      <div className="meter">
        {item.type === "fixed"
          ? <div className="fixed-note"><span style={{ background: fillOf(categoryOf(item.scope), settings) }} />not judged on hours</div>
          : <Bullet item={item} settings={settings} />}
      </div>
      <div className="value">{value}</div>
      <div className={`status st-${tone(item.status)}`}>
        <div className="word"><span className="g" aria-hidden="true">{glyph(item.status)}</span><span>{word(item)}</span></div>
        {detail(item) && <div className="detail">{detail(item)}</div>}
      </div>
    </>
  );
  if (!onShowBlocks) return <div className="goalrow">{body}</div>;
  return (
    <button type="button" className="goalrow" onClick={() => onShowBlocks(item)}
      aria-label={`${item.scope} ${item.label}: ${value}, ${word(item)}. Show the blocks behind this goal`}>
      {body}
    </button>
  );
}

interface Props {
  items: GoalProgress[];
  settings: Settings;
  /** The day goals are judged up to (today, or the export day). */
  asOf: string;
  onShowBlocks?: (item: GoalProgress) => void;
}

/** The goal rows, weekly first, each group under the period it is judged over. */
export default function GoalRows({ items, settings, asOf, onShowBlocks }: Props) {
  const groups = (["week", "month"] as const)
    .map((every) => ({ every, rows: items.filter((item) => item.every === every) }))
    .filter((group) => group.rows.length);
  return (
    <div className="goal-groups">
      {groups.map(({ every, rows }) => (
        <div key={every}>
          <div className="goal-head">
            <span className="eyebrow strong">{every === "week" ? "Weekly" : "Monthly"}</span>
            <span className="sub">{groupLine(rows, asOf, settings.days_off)}</span>
          </div>
          {rows.map((item) => <Row key={item.id} item={item} settings={settings} onShowBlocks={onShowBlocks} />)}
        </div>
      ))}
    </div>
  );
}
