import { fuelFromInvoice, type FuelInvoiceFill } from '../../domain';
import { decodeQrCodes } from '../../lib/qr';
import { scanEInvoice, type InvoiceScanFailureReason, type QrDecoder } from '../forms/receiptScan';

export type ReceiptScanFailureReason = InvoiceScanFailureReason | 'no-fuel';

export type ReceiptScanResult =
  | { ok: true; fill: FuelInvoiceFill }
  | { ok: false; reason: ReceiptScanFailureReason; message: string };

const NO_FUEL_MESSAGE = '這張發票沒有油品項目';

/**
 * Decode QR codes from a receipt photo, parse the Taiwan e-invoice, and extract fuel form fields.
 */
export async function scanFuelReceipt(
  image: Blob,
  decode: QrDecoder = decodeQrCodes,
): Promise<ReceiptScanResult> {
  const parsed = await scanEInvoice(image, decode);
  if (!parsed.ok) return parsed;

  const fill = fuelFromInvoice(parsed.invoice);
  if (!fill) {
    return { ok: false, reason: 'no-fuel', message: NO_FUEL_MESSAGE };
  }

  return { ok: true, fill };
}
