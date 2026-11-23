import { useCallback, useEffect, useState } from 'react';
import type { FormProps } from '../../app/formRequest';
import type { SubmitResult } from './formKit';

/**
 * Glue between a form view-model and its container: reports dirtiness, runs submit and
 * translates the result into onSaved / an inline error, manages the "advanced fields" toggle.
 */
export function useFormChrome<T>(
  props: Pick<FormProps, 'onDirtyChange' | 'onSaved' | 'expanded' | 'onExpand' | 'chrome'>,
  form: { dirty: boolean; submit: () => Promise<SubmitResult<T>> },
  savedMessage: string,
) {
  const { onDirtyChange, onSaved } = props;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    onDirtyChange(form.dirty);
  }, [form.dirty, onDirtyChange]);

  const save = useCallback(async () => {
    setSaveError(null);
    const res = await form.submit();
    if (res.ok) onSaved(savedMessage, res.record);
    else if (res.reason === 'error') setSaveError(res.message);
  }, [form, onSaved, savedMessage]);

  const advanced = props.chrome !== 'sheet' || props.expanded || showMore;
  const expand = useCallback(() => {
    setShowMore(true);
    props.onExpand();
  }, [props]);

  return { save, saveError, advanced, expand };
}
