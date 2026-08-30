import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { config } from '../config.mjs'

const execFileAsync = promisify(execFile)

// Receipt printers use their Windows driver (GDI), not TSPL RAW commands. This
// preserves Unicode text and lets the configured paper roll/cutter behave normally.
export async function renderReceipt(text, printer) {
  const filePath = path.join(os.tmpdir(), `mammi-receipt-${Date.now()}-${process.pid}.txt`)
  await fs.writeFile(filePath, `${text.trim()}\r\n`, 'utf8')
  const script = `
Add-Type -AssemblyName System.Drawing
$text = Get-Content -LiteralPath $env:MAMMI_PRINT_FILE -Raw -Encoding UTF8
$paperWidth = [int][Math]::Round(([double]$env:MAMMI_RECEIPT_WIDTH_MM / 25.4) * 100)
$dpi = [Math]::Max(100, [double]$env:MAMMI_PRINTER_DPI)
$font = [System.Drawing.Font]::new('Arial', 10, [System.Drawing.FontStyle]::Regular)
$measureBitmap = [System.Drawing.Bitmap]::new(1, 1)
$measureGraphics = [System.Drawing.Graphics]::FromImage($measureBitmap)
$widthPixels = [Math]::Max(100, [int][Math]::Round(([double]$env:MAMMI_RECEIPT_WIDTH_MM / 25.4) * $dpi) - 24)
$format = [System.Drawing.StringFormat]::new()
$format.Trimming = [System.Drawing.StringTrimming]::Word
$textHeight = [Math]::Ceiling($measureGraphics.MeasureString($text, $font, $widthPixels, $format).Height)
$measureGraphics.Dispose(); $measureBitmap.Dispose()
$paperHeight = [Math]::Max(100, [int][Math]::Ceiling((($textHeight + 24) / $dpi) * 100))
$document = [System.Drawing.Printing.PrintDocument]::new()
$document.DocumentName = 'MamMi receipt'
$document.PrinterSettings.PrinterName = $env:MAMMI_PRINTER_NAME
if (-not $document.PrinterSettings.IsValid) { throw "Printer not found: $env:MAMMI_PRINTER_NAME" }
$document.DefaultPageSettings.PaperSize = [System.Drawing.Printing.PaperSize]::new('MamMi Receipt', $paperWidth, $paperHeight)
$document.DefaultPageSettings.Margins = [System.Drawing.Printing.Margins]::new(0, 0, 0, 0)
$document.add_PrintPage([System.Drawing.Printing.PrintPageEventHandler]{
  param($sender, $eventArgs)
  $bounds = [System.Drawing.RectangleF]::new([single]$eventArgs.MarginBounds.Left, [single]$eventArgs.MarginBounds.Top, [single]$eventArgs.MarginBounds.Width, [single]$eventArgs.MarginBounds.Height)
  $eventArgs.Graphics.DrawString($text, $font, [System.Drawing.Brushes]::Black, $bounds, $format)
  $eventArgs.HasMorePages = $false
})
try { $document.Print() } finally { $font.Dispose(); $format.Dispose(); $document.Dispose() }
`
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: config.requestTimeoutMs,
      env: {
        ...process.env,
        MAMMI_PRINT_FILE: filePath,
        MAMMI_PRINTER_NAME: printer.windowsPrinterName || printer.printerName,
        MAMMI_PRINTER_DPI: String(printer.printerDpi || 203),
        MAMMI_RECEIPT_WIDTH_MM: String(printer.labelWidthMm || 80),
      },
    })
  } finally {
    await fs.rm(filePath, { force: true })
  }
}
