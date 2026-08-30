import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from '../config.mjs'
import { renderLabel } from '../renderers/label-renderer.mjs'
import { renderReceipt } from '../renderers/receipt-renderer.mjs'
import iconv from 'iconv-lite'

const execFileAsync = promisify(execFile)

export async function printText(text, printer, options = {}) {
  const profile = printer.profile || printer.printerProfile
  // Kitchen label printers understand TSPL directly. Avoid the bitmap renderer
  // (which starts PowerShell/System.Drawing and scans every pixel) because that
  // adds several seconds for multi-item Chinese orders.
  const tsplText = normalizeTsplText(text)
  if (profile === 'kitchen-label-tspl' && options.kind !== 'test' && canUseDirectTspl(tsplText)) {
    await printDirectTspl(tsplText, printer, options)
    return
  }

  if (profile === 'receipt-escpos') {
    await renderReceipt(text, printer)
    if (printer.cutEnabled) {
      if (!printer.cutFeedHex || !printer.cutCommandHex) throw new Error('Receipt cutter is enabled but its commands are not configured')
      await sendRawPrinterBytes(`${printer.cutFeedHex}${printer.cutCommandHex}`, printer)
    }
    return
  }

  await renderLabel(text, printer, options)
}

function canUseDirectTspl(text) {
  return /^[\x09\x0A\x0D\x0C\x20-\x7E\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]*$/.test(text)
}

function normalizeTsplText(text) {
  return text
    .replace(/[đĐ]/g, (character) => character === 'đ' ? 'd' : 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function escapeTsplText(value) {
  return value.replace(/"/g, "'")
}

async function printDirectTspl(text, printer, options = {}) {
  const widthDots = Math.max(1, Math.round(Number(printer.labelWidthMm) * Number(printer.printerDpi) / 25.4))
  const hasChinese = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(text)
  // TST24.BF2 is the installed Chinese font on the configured printer.
  // Smaller TST16.BF2 is not supported by this printer and produces blank labels.
  const font = hasChinese ? 'TST24.BF2' : '0'
  const requestedSize = Number(options.fontSize) || 18
  const textScale = Math.min(3, Math.max(1, Math.ceil(requestedSize / 18)))
  // Use the full configured label width; the previous 8-dot margins caused
  // otherwise-fitting headers to wrap on narrow 58 mm labels.
  const maxWidth = Math.max(1, widthDots)
  const blocks = text.trim().split('\f').filter((block) => block.trim().length > 0)
  const commands = []
  for (const block of blocks) {
    const lines = []
    let footerLine = ''
    for (const sourceLine of block.replace(/\r/g, '').split('\n')) {
      if (/^\d+\/\d+$/.test(sourceLine.trim())) {
        footerLine = sourceLine.trim()
        continue
      }
      if (!sourceLine) {
        lines.push('')
        continue
      }
      let line = ''
      let lineWidth = 0
      for (const character of sourceLine) {
      const characterWidth = (hasChinese && /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(character) ? 24 : 12) * textScale
        if (line && lineWidth + characterWidth > maxWidth) {
          lines.push(line)
          line = ''
          lineWidth = 0
        }
        line += character
        lineWidth += characterWidth
      }
      if (line) {
        lines.push(line)
      }
    }
    commands.push('CLS')
    const lineSpacing = (hasChinese ? 28 : 24) * textScale
    const startY = 8
    lines.forEach((line, index) => {
      // TST24.BF2 is 24 dots high; keep at least 28 dots between baselines
      // or the next line overlaps the previous one on Xprinter hardware.
      const lineX = 0
      commands.push(`TEXT ${lineX},${startY + (index * lineSpacing)},"${font}",0,${textScale},${textScale},"${escapeTsplText(line)}"`)
    })
    if (footerLine) {
      const footerY = Math.max(8, Math.round(Number(printer.labelHeightMm) * Number(printer.printerDpi) / 25.4) - ((hasChinese ? 28 : 24) * textScale))
      const footerX = 0
      commands.push(`TEXT ${footerX},${footerY},"${font}",0,${textScale},${textScale},"${escapeTsplText(footerLine)}"`)
    }
    commands.push('PRINT 1,1')
  }
  const header = `SIZE ${printer.labelWidthMm} mm,${printer.labelHeightMm} mm\r\nGAP ${printer.labelGapMm} mm,0\r\nDIRECTION 1\r\n`
  const tspl = `${header}${commands.join('\r\n')}\r\n`
  const encoded = hasChinese ? iconv.encode(tspl, 'big5') : Buffer.from(tspl, 'ascii')
  await sendRawPrinterData(encoded, printer, 'MamMi direct TSPL')
}

async function sendRawPrinterBytes(hex, printer) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error(`Invalid printer command hex: ${hex}`)
  await sendRawPrinterData(Buffer.from(hex, 'hex'), printer, 'MamMi cut')
}

async function sendRawPrinterData(data, printer, documentName) {
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
  $info.pDocName = $env:MAMMI_RAW_DOCUMENT; $info.pDataType = 'RAW'
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
    env: { ...process.env, MAMMI_RAW_BYTES: Buffer.from(data).toString('base64'), MAMMI_RAW_DOCUMENT: documentName, MAMMI_PRINTER_NAME: printer.windowsPrinterName || printer.printerName },
  })
}
