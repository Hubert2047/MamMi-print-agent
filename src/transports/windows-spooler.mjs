import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from '../config.mjs'
import { renderLabel } from '../renderers/label-renderer.mjs'

const execFileAsync = promisify(execFile)

export async function printText(text, printer) {
  await renderLabel(text, printer)
  if (config.cutEnabled) await sendRawPrinterBytes(`${config.cutFeedHex}${config.cutCommandHex}`, printer)
}

async function sendRawPrinterBytes(hex, printer) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error(`Invalid printer command hex: ${hex}`)
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MamMiRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO info);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
}
'@
$bytes = [Convert]::FromBase64String($env:MAMMI_RAW_BYTES)
$handle = [IntPtr]::Zero
if (-not [MamMiRawPrinter]::OpenPrinter($env:MAMMI_PRINTER_NAME, [ref]$handle, [IntPtr]::Zero)) { throw 'Cannot open printer' }
try {
  $info = New-Object MamMiRawPrinter+DOCINFO
  $info.pDocName = 'MamMi cut'; $info.pDataType = 'RAW'
  if ([MamMiRawPrinter]::StartDocPrinter($handle, 1, $info) -eq 0) { throw 'Cannot start raw print job' }
  try {
    if (-not [MamMiRawPrinter]::StartPagePrinter($handle)) { throw 'Cannot start raw print page' }
    try { $written = 0; if (-not [MamMiRawPrinter]::WritePrinter($handle, $bytes, $bytes.Length, [ref]$written)) { throw 'Cannot write raw printer command' } }
    finally { [MamMiRawPrinter]::EndPagePrinter($handle) }
  } finally { [MamMiRawPrinter]::EndDocPrinter($handle) }
} finally { [MamMiRawPrinter]::ClosePrinter($handle) }
`
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    timeout: config.requestTimeoutMs,
    env: { ...process.env, MAMMI_RAW_BYTES: Buffer.from(hex, 'hex').toString('base64'), MAMMI_PRINTER_NAME: printer.windowsPrinterName || printer.printerName },
  })
}
