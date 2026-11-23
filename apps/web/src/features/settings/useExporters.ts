import { useCallback } from 'react';
import { useIonAlert } from '@ionic/react';
import { buildIcs, buildSnapshot, parseSnapshot, toCsv } from '../../domain';
import { importRecords } from '../../db/repository';
import { useServices } from '../../app/services';
import { useVehicleContext } from '../../app/vehicleContext';
import { useNotify } from '../../app/useNotify';
import { errorMessage } from '../forms/formKit';
import {
  CSV_COLUMNS,
  TABLE_LABELS,
  buildCalendarEvents,
  csvRows,
  exportFileName,
  readAllTables,
  shareOrDownload,
  summarizeTables,
} from './exportModel';

export type CsvTable = keyof typeof CSV_COLUMNS;

/** Export / import actions shared by Settings and the reminders page. */
export function useExporters() {
  const { db } = useServices();
  const { vehicle, state, today } = useVehicleContext();
  const notify = useNotify();
  const [presentAlert] = useIonAlert();

  const deliver = useCallback(
    async (file: File) => {
      const how = await shareOrDownload(file);
      if (how === 'downloaded') notify.toast(`已下載 ${file.name}`);
    },
    [notify],
  );

  const guarded = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        notify.toast(`匯出失敗：${errorMessage(e)}`, 'danger');
      }
    },
    [notify],
  );

  const exportJson = useCallback(
    () =>
      guarded(async () => {
        const snapshot = buildSnapshot(await readAllTables(db));
        const file = new File([JSON.stringify(snapshot, null, 2)], exportFileName('backup', 'json', today), {
          type: 'application/json',
        });
        await deliver(file);
      }),
    [db, today, deliver, guarded],
  );

  const exportCsv = useCallback(
    (table: CsvTable) =>
      guarded(async () => {
        const tables = await readAllTables(db);
        const rows = csvRows(table, tables[table], tables.vehicles);
        const csv = toCsv(rows, CSV_COLUMNS[table]);
        const file = new File([csv], exportFileName(table, 'csv', today), { type: 'text/csv' });
        await deliver(file);
      }),
    [db, today, deliver, guarded],
  );

  const exportIcs = useCallback(
    () =>
      guarded(async () => {
        const events = buildCalendarEvents(vehicle, state.reminders, state.deadlines);
        if (events.length === 0) {
          notify.toast('沒有可匯出的到期日（里程提醒需要有足夠的紀錄才能推估日期）', 'warning');
          return;
        }
        const file = new File([buildIcs(events)], exportFileName('reminders', 'ics', today), { type: 'text/calendar' });
        await deliver(file);
      }),
    [vehicle, state, today, deliver, guarded, notify],
  );

  /** Parse first, confirm with a summary, then import through the outbox. */
  const importJson = useCallback(
    async (file: File) => {
      let snapshot;
      try {
        snapshot = parseSnapshot(await file.text());
      } catch (e) {
        notify.toast(`無法讀取備份檔：${errorMessage(e)}`, 'danger');
        return;
      }
      const summary = summarizeTables(snapshot.tables);
      if (summary.total === 0) {
        notify.toast('備份檔沒有任何資料', 'warning');
        return;
      }
      void presentAlert({
        header: '匯入備份？',
        message: `${summary.text}，共 ${summary.total} 筆（匯出於 ${snapshot.exportedAt.slice(0, 10)}）。相同 ID 的資料會被覆蓋，並同步到 server。`,
        buttons: [
          { text: '取消', role: 'cancel' },
          {
            text: '匯入',
            handler: () => {
              importRecords(db, snapshot.tables)
                .then((n) => notify.toast(`已匯入 ${n} 筆資料`, 'success'))
                .catch((e) => notify.toast(`匯入失敗：${errorMessage(e)}`, 'danger'));
            },
          },
        ],
      });
    },
    [db, notify, presentAlert],
  );

  return { exportJson, exportCsv, exportIcs, importJson, tableLabels: TABLE_LABELS };
}
