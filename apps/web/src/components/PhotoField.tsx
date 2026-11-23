import { useEffect, useRef, useState } from 'react';
import type { CarDB } from '../db/db';
import { photoUrl } from '../db/repository';
import { attachPhoto } from './photos';
import { errorMessage } from '../features/forms/formKit';

function PhotoThumb(props: { db: CarDB; id: string; onRemove: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    photoUrl(props.db, props.id)
      .then((u) => {
        url = u;
        if (cancelled) {
          if (u.startsWith('blob:')) URL.revokeObjectURL(u);
        } else setSrc(u);
      })
      .catch(() => setSrc(null));
    return () => {
      cancelled = true;
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [props.db, props.id]);
  return (
    <div className="photo-thumb">
      {src ? <img src={src} alt="附件照片" /> : null}
      <button type="button" aria-label="移除照片" onClick={props.onRemove}>
        ×
      </button>
    </div>
  );
}

/** Receipt / work-order photos: camera or library → compressed → stored locally. */
export function PhotoField(props: { db: CarDB; photoIds: string[]; onChange: (ids: string[]) => void }) {
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idsRef = useRef(props.photoIds);
  idsRef.current = props.photoIds;

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const ids: string[] = [];
      for (const file of Array.from(files)) ids.push(await attachPhoto(props.db, file));
      props.onChange([...idsRef.current, ...ids]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (camera.current) camera.current.value = '';
      if (library.current) library.current.value = '';
    }
  };

  return (
    <div className="field">
      <span className="field-label">照片（工單、發票）</span>
      <div className="button-row">
        <button type="button" className="plain-button pressable" disabled={busy} onClick={() => camera.current?.click()}>
          📷 拍照
        </button>
        <button type="button" className="plain-button pressable" disabled={busy} onClick={() => library.current?.click()}>
          🖼 相簿
        </button>
      </div>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void onFiles(e.target.files)}
      />
      <input ref={library} type="file" accept="image/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
      {busy ? <div className="field-hint">壓縮中…</div> : null}
      {error ? (
        <div className="field-error" role="alert">
          照片處理失敗：{error}
        </div>
      ) : null}
      {props.photoIds.length > 0 ? (
        <div className="photo-strip">
          {props.photoIds.map((id) => (
            <PhotoThumb
              key={id}
              db={props.db}
              id={id}
              onRemove={() => props.onChange(props.photoIds.filter((p) => p !== id))}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
