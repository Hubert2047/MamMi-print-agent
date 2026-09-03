import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { config } from '../config.mjs'

const execFileAsync = promisify(execFile)

export async function renderLabel(text, printer = config, options = {}) {
  const filePath = path.join(os.tmpdir(), `mammi-print-${Date.now()}-${process.pid}.txt`)
  await fs.writeFile(filePath, `${text.trim()}\r\n\r\n`, 'utf8')
  const script = `
Add-Type -AssemblyName System.Drawing
  $lineHeight = [int]([Math]::Max(24, [double]$env:MAMMI_TEST_LINE_HEIGHT))
$labelWidthPx = [int][Math]::Ceiling([double]$env:MAMMI_LABEL_WIDTH_MM * [double]$env:MAMMI_PRINTER_DPI / 25.4)
$labelHeightPx = [int][Math]::Ceiling([double]$env:MAMMI_LABEL_HEIGHT_MM * [double]$env:MAMMI_PRINTER_DPI / 25.4)
function New-LabelBitmap([string]$block) {
  $lines = $block -split "\`n"
  $renderLines = @()
  $measureBitmap = [System.Drawing.Bitmap]::new(1, 1)
  $measureGraphics = [System.Drawing.Graphics]::FromImage($measureBitmap)
  $maxTextWidth = $labelWidthPx - 28
  for ($index = 0; $index -lt $lines.Count; $index++) {
    $raw = $lines[$index].TrimEnd("\`r")
    $isOptionLine = $raw.StartsWith('- ') -or $raw.StartsWith('+ ') -or $raw.StartsWith('不加:') -or $raw.StartsWith('加點:')
    $baseSize = [double]$env:MAMMI_TEST_FONT_SIZE
    $fontSize = if ($index -eq 1) { $baseSize } elseif ($index -eq 0) { [Math]::Max(12, $baseSize - 5) } elseif ($isOptionLine) { [Math]::Max(12, $baseSize - 5) } else { [Math]::Max(10, $baseSize - 7) }
    $originalWasEmpty = $raw.Length -eq 0
    $measureStyle = if ($env:MAMMI_TEST_BOLD -eq '1') { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $measureFont = [System.Drawing.Font]::new('Segoe UI', [single]$fontSize, $measureStyle)
    while ($raw.Length -gt 0) {
      $cut = $raw.Length
      while ($cut -gt 1 -and $measureGraphics.MeasureString($raw.Substring(0, $cut), $measureFont).Width -gt $maxTextWidth) { $cut-- }
      if ($cut -eq $raw.Length) {
        $renderLines += [PSCustomObject]@{ Text = $raw.Trim(); Size = $fontSize }
        $raw = ''
        break
      }
      $spaceCut = $raw.LastIndexOf(' ', $cut - 1)
      if ($spaceCut -gt 0) { $cut = $spaceCut }
      $renderLines += [PSCustomObject]@{ Text = $raw.Substring(0, $cut).Trim(); Size = $fontSize }
      $raw = $raw.Substring($cut).Trim()
    }
    $measureFont.Dispose()
    if ($originalWasEmpty) { $renderLines += [PSCustomObject]@{ Text = ''; Size = $fontSize } }
  }
  $measureGraphics.Dispose()
  $measureBitmap.Dispose()
  $extraSpacing = ($renderLines | Where-Object { $_.Text.Trim().StartsWith('不加:') }).Count * 6
  $dynamicHeight = [Math]::Max(100, ($lineHeight * $renderLines.Count) + 16 + $extraSpacing)
  $height = if ($env:MAMMI_PRINT_PROFILE -eq 'kitchen-label-tspl') { $labelHeightPx } else { $dynamicHeight }
  $footerLine = $renderLines | Where-Object { $_.Text.Trim() -match '^[0-9]+/[0-9]+$' } | Select-Object -Last 1
  $bitmap = [System.Drawing.Bitmap]::new($labelWidthPx, [int]$height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::White)
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.SetClip([System.Drawing.Rectangle]::new(0, 0, $labelWidthPx, [int]$height))
  $fontHeight = [double]$env:MAMMI_TEST_FONT_SIZE
  $contentHeight = if ($renderLines.Count -gt 0) { (($renderLines.Count - 1) * $lineHeight) + $fontHeight } else { 0 }
  $centerContent = $env:MAMMI_PRINT_CENTER_CONTENT -eq '1'
  $y = if ($centerContent) { [Math]::Max(6, [int](($height - $contentHeight) / 2)) } else { 6 }
  $footerY = [int]$height - 36
  for ($lineIndex = 0; $lineIndex -lt $renderLines.Count; $lineIndex++) {
    $line = $renderLines[$lineIndex]
    $style = if ($env:MAMMI_TEST_BOLD -eq '1') { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $font = [System.Drawing.Font]::new('Segoe UI', [single]$line.Size, $style)
    $isFooter = $line.Text.Trim() -match '^[0-9]+/[0-9]+$'
    $isNoteLine = $line.Text.Trim().StartsWith('不加:')
    if ($isFooter) { $font.Dispose(); continue }
    $drawY = if ($isNoteLine) { $y + 6 } else { $y }
    if ($null -ne $footerLine -and $drawY -ge $footerY) { $font.Dispose(); break }
    $lineWidth = $graphics.MeasureString($line.Text, $font).Width
    $drawX = if ($centerContent) { [Math]::Max(0, [int](($labelWidthPx - $lineWidth) / 2)) } else { 8 }
    $graphics.DrawString($line.Text, $font, [System.Drawing.Brushes]::Black, $drawX, $drawY)
    $font.Dispose()
    $y = $drawY + $lineHeight
  }
  if ($null -ne $footerLine) {
    $graphics.FillRectangle([System.Drawing.Brushes]::White, 0, [Math]::Max(0, $footerY - 3), $labelWidthPx, [int]$height - [Math]::Max(0, $footerY - 3))
    $footerFont = [System.Drawing.Font]::new('Segoe UI', [single]22, [System.Drawing.FontStyle]::Bold)
    $footerText = $footerLine.Text.Trim()
    $footerWidth = $graphics.MeasureString($footerText, $footerFont).Width
  $footerX = if ($centerContent) { [Math]::Max(0, [int](($labelWidthPx - $footerWidth) / 2)) } else { 8 }
    $graphics.DrawString($footerText, $footerFont, [System.Drawing.Brushes]::Black, $footerX, $footerY)
    $footerFont.Dispose()
  }
  $graphics.Dispose()
  return $bitmap
}
$blocks = (Get-Content -LiteralPath $env:MAMMI_PRINT_FILE -Raw -Encoding UTF8) -split "\`f" | Where-Object { $_.Trim().Length -gt 0 }
$bitmaps = @()
foreach ($block in $blocks) { $bitmaps += New-LabelBitmap $block }
$raw = [System.Collections.Generic.List[byte]]::new()
function Add-Ascii([string]$value) { $raw.AddRange([System.Text.Encoding]::ASCII.GetBytes($value)) }
Add-Ascii ("SIZE {0} mm,{1} mm\`r\`nGAP {2} mm,0\`r\`nDIRECTION 1\`r\`nCLS\`r\`n" -f $env:MAMMI_LABEL_WIDTH_MM, $env:MAMMI_LABEL_HEIGHT_MM, $env:MAMMI_LABEL_GAP_MM)
foreach ($bitmap in $bitmaps) {
  $widthBytes = [int][Math]::Ceiling([double]$bitmap.Width / 8)
  $pixels = [byte[]]::new($widthBytes * $bitmap.Height)
  $rectangle = [System.Drawing.Rectangle]::new(0, 0, $bitmap.Width, $bitmap.Height)
  $bitmapData = $bitmap.LockBits($rectangle, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $sourceStride = [Math]::Abs($bitmapData.Stride)
    $sourceBytes = [byte[]]::new($sourceStride * $bitmap.Height)
    [System.Runtime.InteropServices.Marshal]::Copy($bitmapData.Scan0, $sourceBytes, 0, $sourceBytes.Length)
    for ($y = 0; $y -lt $bitmap.Height; $y++) {
      $sourceRow = $y * $sourceStride
      $outputRow = $y * $widthBytes
      for ($x = 0; $x -lt $bitmap.Width; $x++) {
        $red = $sourceBytes[$sourceRow + ($x * 4) + 2]
        if ($red -ge 200) {
          $byteIndex = $outputRow + [int][Math]::Floor([double]$x / 8)
          $bit = 7 - ($x % 8)
          $pixels[$byteIndex] = $pixels[$byteIndex] -bor (1 -shl $bit)
        }
      }
    }
  } finally {
    $bitmap.UnlockBits($bitmapData)
  }
  Add-Ascii ("BITMAP 0,0,{0},{1},0," -f $widthBytes, $bitmap.Height)
  $raw.AddRange($pixels)
  Add-Ascii "\`r\`nPRINT 1,1\`r\`n"
}
$rawBase64 = [Convert]::ToBase64String($raw.ToArray())
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MamMiRawLabelPrinter {
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
$handle = [IntPtr]::Zero
if (-not [MamMiRawLabelPrinter]::OpenPrinter($env:MAMMI_PRINTER_NAME, [ref]$handle, [IntPtr]::Zero)) { throw "Printer not found: $env:MAMMI_PRINTER_NAME" }
try {
  $info = New-Object MamMiRawLabelPrinter+DOCINFO
  $info.pDocName = 'MamMi labels'; $info.pDataType = 'RAW'
  if ([MamMiRawLabelPrinter]::StartDocPrinter($handle, 1, $info) -eq 0) { throw 'Cannot start raw label job' }
  try {
    if (-not [MamMiRawLabelPrinter]::StartPagePrinter($handle)) { throw 'Cannot start raw label page' }
    try {
      $written = 0
      $bytes = [Convert]::FromBase64String($rawBase64)
      if (-not [MamMiRawLabelPrinter]::WritePrinter($handle, $bytes, $bytes.Length, [ref]$written)) { throw 'Cannot write raw label data' }
    } finally { [MamMiRawLabelPrinter]::EndPagePrinter($handle) }
  } finally { [MamMiRawLabelPrinter]::EndDocPrinter($handle) }
} finally { [MamMiRawLabelPrinter]::ClosePrinter($handle) }
foreach ($bitmap in $bitmaps) { $bitmap.Dispose() }
`
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      timeout: config.requestTimeoutMs,
      env: { ...process.env, MAMMI_PRINT_FILE: filePath, MAMMI_PRINTER_NAME: printer.windowsPrinterName || printer.printerName, MAMMI_PRINT_PROFILE: printer.profile || printer.printerProfile, MAMMI_PRINTER_DPI: String(printer.printerDpi), MAMMI_LABEL_WIDTH_MM: String(printer.labelWidthMm), MAMMI_LABEL_HEIGHT_MM: String(printer.labelHeightMm), MAMMI_LABEL_GAP_MM: String(printer.labelGapMm), MAMMI_TEST_FONT_SIZE: String(Math.min(48, Math.max(8, Number(options.fontSize) || 22))), MAMMI_TEST_BOLD: options.bold ? '1' : '0', MAMMI_TEST_LINE_HEIGHT: String(Math.min(60, Math.max(24, (Number(options.fontSize) || 22) + 10))), MAMMI_PRINT_CENTER_CONTENT: options.kind === 'test' ? '1' : '0' },
    })
  } finally {
    await fs.rm(filePath, { force: true })
  }
}
