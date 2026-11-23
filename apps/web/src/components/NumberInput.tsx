import { useId } from 'react';
import type React from 'react';

type EnterKeyHint = 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';

export interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string | null;
  suffix?: string;
  children: (id: string) => React.ReactNode;
}

/** Label + control + hint/error, stacked; used by all form fields. */
export function FieldShell(props: FieldShellProps) {
  const id = useId();
  return (
    <div className={`field${props.error ? ' has-error' : ''}`}>
      <label className="field-label" htmlFor={id}>
        {props.label}
      </label>
      <div className="field-control">
        {props.children(id)}
        {props.suffix ? <span className="field-suffix">{props.suffix}</span> : null}
      </div>
      {props.hint && !props.error ? <div className="field-hint">{props.hint}</div> : null}
      {props.error ? (
        <div className="field-error" role="alert">
          {props.error}
        </div>
      ) : null}
    </div>
  );
}

export interface NumberInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  hint?: string;
  error?: string | null;
  placeholder?: string;
  enterKeyHint?: EnterKeyHint;
  /** Select everything on focus so only the last digits need retyping (odometer). */
  selectOnFocus?: boolean;
  inputMode?: 'decimal' | 'numeric';
  onEnter?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  autoFocus?: boolean;
  className?: string;
}

function selectAll(el: HTMLInputElement) {
  try {
    el.setSelectionRange(0, el.value.length);
  } catch {
    el.select();
  }
}

/** Native text input with the decimal keypad (SPEC §5.3: better than type=number on iOS). */
export function NumberInput(props: NumberInputProps) {
  return (
    <FieldShell label={props.label} hint={props.hint} error={props.error} suffix={props.suffix}>
      {(id) => (
        <input
          id={id}
          ref={props.inputRef}
          className={`input ${props.className ?? ''}`}
          type="text"
          inputMode={props.inputMode ?? 'decimal'}
          enterKeyHint={props.enterKeyHint}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={props.autoFocus}
          placeholder={props.placeholder}
          value={props.value}
          aria-invalid={props.error ? true : undefined}
          onChange={(e) => props.onChange(e.target.value)}
          onFocus={(e) => {
            if (!props.selectOnFocus) return;
            const el = e.currentTarget;
            selectAll(el);
            // iOS resets the selection after focusing; select again on the next tick.
            setTimeout(() => {
              if (document.activeElement === el) selectAll(el);
            }, 0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && props.onEnter) {
              e.preventDefault();
              props.onEnter();
            }
          }}
        />
      )}
    </FieldShell>
  );
}

export interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  placeholder?: string;
  enterKeyHint?: EnterKeyHint;
  type?: 'text' | 'date';
  list?: string;
  onEnter?: () => void;
  autoCapitalize?: string;
  required?: boolean;
}

export function TextInput(props: TextInputProps) {
  return (
    <FieldShell label={props.label} hint={props.hint} error={props.error}>
      {(id) => (
        <input
          id={id}
          className="input"
          type={props.type ?? 'text'}
          enterKeyHint={props.enterKeyHint}
          placeholder={props.placeholder}
          value={props.value}
          list={props.list}
          autoCapitalize={props.autoCapitalize}
          required={props.required}
          aria-invalid={props.error ? true : undefined}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && props.onEnter) {
              e.preventDefault();
              props.onEnter();
            }
          }}
        />
      )}
    </FieldShell>
  );
}

export function TextArea(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <FieldShell label={props.label}>
      {(id) => (
        <textarea
          id={id}
          className="input textarea"
          rows={2}
          placeholder={props.placeholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}
