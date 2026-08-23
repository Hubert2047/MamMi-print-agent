import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { config } from '../config.mjs'

const execFileAsync = promisify(execFile)

export async function printText(text) {
  const filePath = path.join(os.tmpdir(), `mammi-print-${Date.now()}-${process.pid}.txt`)
  await fs.writeFile(filePath, `${text.trim()}\r\n\r\n`, 'utf8')
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Drawing.Printing
$lineHeight = 27
$labelWidthPx = [int][Math]::Ceiling([double]$env:MAMMI_LABEL_WIDTH_MM * 203 / 25.4)
$labelHeightPx = [int][Math]::Ceiling([double]$env:MAMMI_LABEL_HEIGHT_MM * 203 / 25.4)
function New-LabelBitmap([string]$block) {
  $lines = $block -split "\`n"
  $renderLines = @()
  for ($index = 0; $index -lt $lines.Count; $index++) {
    $raw = $lines[$index].TrimEnd("\`r")
    $isOptionLine = $raw.StartsWith('- ') -or $raw.StartsWith('+ ')
    $fontSize = if ($index -eq 1) { 18 } elseif ($index -eq 0) { 13 } else { 11 }
    $maxChars = if ($index -eq 1) { 23 } elseif ($isOptionLine) { 44 } elseif ($index -eq 0) { 38 } else { 46 }
    while ($raw.Length -gt $maxChars) {
      $cut = $raw.LastIndexOf(' ', [Math]::Min($maxChars, $raw.Length - 1))
      if ($cut -lt 1) { $cut = $maxChars }
      $renderLines += [PSCustomObject]@{ Text = $raw.Substring(0, $cut).Trim(); Size = $fontSize }
      $raw = $raw.Substring($cut).Trim()
    }
    if ($raw.Length -gt 0) { $renderLines += [PSCustomObject]@{ Text = $raw; Size = $fontSize } }
  }
  $dynamicHeight = [Math]::Max(100, ($lineHeight * $renderLines.Count) + 16)
  $height = if ($env:MAMMI_PRINT_MODE -eq 'label') { $labelHeightPx } else { $dynamicHeight }
  $bitmap = [System.Drawing.Bitmap]::new($labelWidthPx, [int]$height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::White)
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $y = 6
  for ($lineIndex = 0; $lineIndex -lt $renderLines.Count; $lineIndex++) {
    $line = $renderLines[$lineIndex]
    $style = if ($line.Size -ge 11) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $font = [System.Drawing.Font]::new('Arial', [single]$line.Size, $style)
    $graphics.DrawString($line.Text, $font, [System.Drawing.Brushes]::Black, 4, $y)
    $font.Dispose()
    $y += $lineHeight
  }
  $graphics.Dispose()
  return $bitmap
}
$blocks = (Get-Content -LiteralPath $env:MAMMI_PRINT_FILE -Raw -Encoding UTF8) -split "\`f" | Where-Object { $_.Trim().Length -gt 0 }
$bitmaps = @()
foreach ($block in $blocks) { $bitmaps += New-LabelBitmap $block }
$gapPx = [int][Math]::Ceiling([double]$env:MAMMI_LABEL_GAP_MM * 203 / 25.4)
$raw = [System.Collections.Generic.List[byte]]::new()
function Add-Ascii([string]$value) { $raw.AddRange([System.Text.Encoding]::ASCII.GetBytes($value)) }
Add-Ascii ("SIZE {0} mm,{1} mm\`r\`nGAP {2} mm,0\`r\`nDIRECTION 1\`r\`nCLS\`r\`n" -f $env:MAMMI_LABEL_WIDTH_MM, $env:MAMMI_LABEL_HEIGHT_MM, $env:MAMMI_LABEL_GAP_MM)
foreach ($bitmap in $bitmaps) {
  $widthBytes = [int][Math]::Ceiling([double]$bitmap.Width / 8)
  $pixels = [byte[]]::new($widthBytes * $bitmap.Height)
  for ($y = 0; $y -lt $bitmap.Height; $y++) {
    for ($x = 0; $x -lt $bitmap.Width; $x++) {
      $pixel = $bitmap.GetPixel($x, $y)
      # TSPL firmware used by this model treats bit 0 as a printed dot.
      # The rendered bitmap is white-on-black only if this polarity is reversed.
      if ($pixel.R -ge 200) {
        $byteIndex = $y * $widthBytes + [int][Math]::Floor([double]$x / 8)
        $bit = 7 - ($x % 8)
        $pixels[$byteIndex] = $pixels[$byteIndex] -bor (1 -shl $bit)
      }
    }
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
      env: { ...process.env, MAMMI_PRINT_FILE: filePath, MAMMI_PRINTER_NAME: config.printerName, MAMMI_PRINT_MODE: config.printMode, MAMMI_LABEL_WIDTH_MM: String(config.labelWidthMm), MAMMI_LABEL_HEIGHT_MM: String(config.labelHeightMm), MAMMI_LABEL_GAP_MM: String(config.labelGapMm) },
    })
    if (config.cutEnabled) await sendRawPrinterBytes(`${config.cutFeedHex}${config.cutCommandHex}`)
  } finally { await fs.rm(filePath, { force: true }) }
}

async function sendRawPrinterBytes(hex) {
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
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: config.requestTimeoutMs, env: { ...process.env, MAMMI_RAW_BYTES: Buffer.from(hex, 'hex').toString('base64'), MAMMI_PRINTER_NAME: config.printerName } })
}
