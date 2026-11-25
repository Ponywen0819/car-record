import { useRef, useState } from 'react';
import { SCAN_MESSAGES } from './receiptScan';

export type ScanOutcome = { ok: true; message: string } | { ok: false; message: string };

export interface ReceiptScanButtonProps {
  onScan: (file: File) => Promise<ScanOutcome>;
}

/**
 * Shared "掃描發票" button + hidden file input + inline feedback line.
 * No `capture` attribute so iOS offers both Camera and Photo Library; the image is never stored.
 */
export function ReceiptScanButton(props: ReceiptScanButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState<ScanOutcome | null>(null);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setScanning(true);
    setFeedback(null);
    try {
      setFeedback(await props.onScan(file));
    } catch {
      setFeedback({ ok: false, message: SCAN_MESSAGES.error });
    } finally {
      setScanning(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="field">
      <div className="button-row">
        <button
          type="button"
          className="plain-button pressable"
          disabled={scanning}
          onClick={() => inputRef.current?.click()}
        >
          {scanning ? '讀取中…' : '掃描發票'}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => void handleFiles(e.target.files)}
      />
      {feedback ? (
        feedback.ok ? (
          <div className="field-hint" role="status">
            {feedback.message}
          </div>
        ) : (
          <div className="field-error" role="alert">
            {feedback.message}
          </div>
        )
      ) : null}
    </div>
  );
}
