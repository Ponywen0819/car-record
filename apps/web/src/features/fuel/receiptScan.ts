import { EInvoiceError, fuelFromInvoice, parseEInvoice, type FuelInvoiceFill } from '../../domain';
import { decodeQrCodes } from '../../lib/qr';

export type ReceiptScanFailureReason = 'no-qr' | 'not-einvoice' | 'no-fuel' | 'error';

export type ReceiptScanResult =
  | { ok: true; fill: FuelInvoiceFill }
  | { ok: false; reason: ReceiptScanFailureReason; message: string };

const MESSAGES: Record<ReceiptScanFailureReason, string> = {
  'no-qr': '找不到 QR code，請把發票左右兩個 QR code 拍清楚再試一次',
  'not-einvoice': '這不是電子發票的 QR code',
  'no-fuel': '這張發票沒有油品項目',
  error: '無法讀取照片，請再試一次',
};

/**
 * Decode QR codes from a receipt photo, parse the Taiwan e-invoice, and extract fuel form fields.
 */
export async function scanFuelReceipt(
  image: Blob,
  decode: (image: Blob) => Promise<readonly Uint8Array[]> = decodeQrCodes,
): Promise<ReceiptScanResult> {
  let codes: readonly Uint8Array[];
  try {
    codes = await decode(image);
  } catch {
    return { ok: false, reason: 'error', message: MESSAGES.error };
  }

  if (codes.length === 0) {
    return { ok: false, reason: 'no-qr', message: MESSAGES['no-qr'] };
  }

  let invoice;
  try {
    invoice = parseEInvoice(codes);
  } catch (err) {
    if (err instanceof EInvoiceError) {
      return { ok: false, reason: 'not-einvoice', message: MESSAGES['not-einvoice'] };
    }
    return { ok: false, reason: 'not-einvoice', message: MESSAGES['not-einvoice'] };
  }

  const fill = fuelFromInvoice(invoice);
  if (!fill) {
    return { ok: false, reason: 'no-fuel', message: MESSAGES['no-fuel'] };
  }

  return { ok: true, fill };
}
