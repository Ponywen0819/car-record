import type React from 'react';
import { IonBackButton, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonTitle, IonToolbar } from '@ionic/react';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import type { FormChrome } from '../app/formRequest';
import { handleEnterKey } from './enterKey';

export interface FormLayoutProps {
  title: string;
  chrome: FormChrome;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel?: string;
  /** Odometer warning: the save button turns into "仍要儲存". */
  warning?: string | null;
  error?: string | null;
  backHref?: string;
  headerEnd?: React.ReactNode;
  children: React.ReactNode;
}

/** Header + scrollable fields + save bar pinned above the keyboard (visualViewport). */
export function FormLayout(props: FormLayoutProps) {
  const inset = useKeyboardInset();
  return (
    <>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            {props.chrome === 'sheet' ? (
              <IonButton onClick={props.onCancel}>取消</IonButton>
            ) : props.chrome === 'page' ? (
              <IonBackButton defaultHref={props.backHref ?? '/records'} text="返回" />
            ) : null}
          </IonButtons>
          <IonTitle>{props.title}</IonTitle>
          {props.headerEnd ? <IonButtons slot="end">{props.headerEnd}</IonButtons> : null}
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <form
          className="form-body"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            props.onSave();
          }}
          onKeyDown={(e) => handleEnterKey(e, props.onSave)}
        >
          {props.children}
          {/* keep content clear of the keyboard-lifted save bar */}
          <div style={{ height: inset }} />
        </form>
      </IonContent>
      <IonFooter
        className={`save-bar ion-no-border${inset ? ' keyboard-open' : ''}`}
        style={inset ? { transform: `translateY(-${inset}px)` } : undefined}
      >
        {props.warning ? (
          <div className="form-warning" role="alert">
            ⚠ {props.warning}
          </div>
        ) : null}
        {props.error ? (
          <div className="form-error" role="alert">
            儲存失敗：{props.error}
          </div>
        ) : null}
        <IonButton
          expand="block"
          color={props.warning ? 'warning' : 'primary'}
          disabled={props.saving}
          // keep the keyboard from closing before the tap registers
          onMouseDown={(e) => e.preventDefault()}
          onClick={props.onSave}
        >
          {props.saving ? '儲存中…' : props.warning ? '仍要儲存' : (props.saveLabel ?? '儲存')}
        </IonButton>
      </IonFooter>
    </>
  );
}

/** iOS-style switch as a native checkbox. */
export function SwitchRow(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="switch-row">
      <span>
        {props.label}
        {props.hint ? <span className="field-hint" style={{ display: 'block' }}>{props.hint}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

/** "Show more fields" button (non-gesture alternative to dragging the sheet up). */
export function MoreFieldsButton(props: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="more-button pressable" onClick={props.onClick}>
      ＋ {props.label}
    </button>
  );
}
