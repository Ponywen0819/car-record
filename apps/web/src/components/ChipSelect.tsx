export interface ChipOption<V extends string = string> {
  value: V;
  label: string;
}

/** Multi/single select as tappable chips (plain buttons: fast, accessible, testable). */
export function ChipSelect<V extends string>(props: {
  options: readonly ChipOption<V>[];
  selected: readonly V[];
  onToggle: (value: V) => void;
  /** Values to highlight (e.g. maintenance items that are due). */
  hinted?: readonly V[];
  ariaLabel?: string;
}) {
  return (
    <div className="chip-select" role="group" aria-label={props.ariaLabel}>
      {props.options.map((o) => {
        const on = props.selected.includes(o.value);
        const hinted = props.hinted?.includes(o.value) ?? false;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            className={`chip pressable${on ? ' on' : ''}${hinted ? ' hinted' : ''}`}
            onClick={() => props.onToggle(o.value)}
          >
            {o.label}
            {hinted ? <span className="chip-dot" aria-label="即將到期" /> : null}
          </button>
        );
      })}
    </div>
  );
}
