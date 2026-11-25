import {
  EInvoiceError,
  parseEInvoice,
  receiptFromInvoice,
  type EInvoice,
  type ReceiptInvoiceFill,
} from '../../domain';
import { decodeQrCodes } from '../../lib/qr';

export type QrDecoder = (image: Blob) => Promise<readonly Uint8Array[]>;

export type InvoiceScanFailureReason = 'no-qr' | 'not-einvoice' | 'error';

export type InvoiceScanResult =
  | { ok: true; invoice: EInvoice }
  | { ok: false; reason: InvoiceScanFailureReason; message: string };

export type ReceiptScanResult =
  | { ok: true; fill: ReceiptInvoiceFill }
  | { ok: false; reason: InvoiceScanFailureReason; message: string };

export const SCAN_MESSAGES: Record<InvoiceScanFailureReason, string> = {
  'no-qr': '找不到 QR code，請把發票左右兩個 QR code 拍清楚再試一次',
  'not-einvoice': '這不是電子發票的 QR code',
  error: '無法讀取照片，請再試一次',
};

/** Shared decode + parse + error mapping for Taiwan e-invoice QR photos. */
export async function scanEInvoice(
  image: Blob,
  decode: QrDecoder = decodeQrCodes,
): Promise<InvoiceScanResult> {
  let codes: readonly Uint8Array[];
  try {
    codes = await decode(image);
  } catch {
    return { ok: false, reason: 'error', message: SCAN_MESSAGES.error };
  }

  if (codes.length === 0) {
    return { ok: false, reason: 'no-qr', message: SCAN_MESSAGES['no-qr'] };
  }

  try {
    return { ok: true, invoice: parseEInvoice(codes) };
  } catch (err) {
    if (err instanceof EInvoiceError) {
      return { ok: false, reason: 'not-einvoice', message: SCAN_MESSAGES['not-einvoice'] };
    }
    return { ok: false, reason: 'not-einvoice', message: SCAN_MESSAGES['not-einvoice'] };
  }
}

/** Decode QR codes from a receipt photo and extract date, total, and item note. */
export async function scanReceipt(
  image: Blob,
  decode: QrDecoder = decodeQrCodes,
): Promise<ReceiptScanResult> {
  const parsed = await scanEInvoice(image, decode);
  if (!parsed.ok) return parsed;
  return { ok: true, fill: receiptFromInvoice(parsed.invoice) };
}
