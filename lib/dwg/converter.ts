/**
 * DWG → DXF Converter — Server-side conversion using ODA File Converter.
 *
 * ODA File Converter is a free tool from Open Design Alliance that
 * converts between DWG and DXF formats. It must be installed on the server.
 *
 * Usage: ODAFileConverter <input_dir> <output_dir> <version> <type> <recurse> <audit>
 */

import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── ODA File Converter Paths ────────────────────────────────────────────────

const ODA_PATHS = [
  "/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter",
  "/usr/local/bin/ODAFileConverter",
  "/usr/bin/ODAFileConverter",
  "ODAFileConverter", // rely on PATH
];

function findOdaConverter(): string | null {
  for (const odaPath of ODA_PATHS) {
    try {
      // Just check if the file exists — don't run with --help
      // (ODA prints usage to stdout which can leak into responses)
      execSync(`test -f "${odaPath}"`, { timeout: 2000, stdio: "pipe" });
      return odaPath;
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Conversion ──────────────────────────────────────────────────────────────

/**
 * Convert a DWG file buffer to DXF string content.
 *
 * @param dwgBuffer - Raw DWG file content as a Buffer
 * @param fileName - Original filename (used for the temp file)
 * @returns DXF file content as a string
 */
export async function convertDwgToDxf(
  dwgBuffer: Buffer,
  fileName: string,
): Promise<string> {
  const odaPath = findOdaConverter();
  if (!odaPath) {
    throw new Error(
      "ODA File Converter not found. Install it from https://www.opendesign.com/guestfiles/oda_file_converter " +
      "or export DXF from AutoCAD (File → Save As → DXF).",
    );
  }

  // Create temp directories
  const inputDir = mkdtempSync(join(tmpdir(), "dwg-input-"));
  const outputDir = mkdtempSync(join(tmpdir(), "dwg-output-"));

  try {
    // Write the DWG file to input dir
    const dwgPath = join(inputDir, fileName);
    writeFileSync(dwgPath, dwgBuffer);

    // Run ODA File Converter
    // Args: input_dir/ output_dir/ output_version output_type recurse audit
    // Trailing slashes on directories are required by ODA on some platforms
    const cmd = `"${odaPath}" "${inputDir}/" "${outputDir}/" "ACAD2018" "DXF" "0" "1"`;

    try {
      execSync(cmd, {
        timeout: 60000,
        stdio: "pipe", // suppress ODA's stdout/stderr (it prints usage text)
      });
    } catch (execErr) {
      // ODA may exit with non-zero even on success — check for output files
      const hasOutput = readdirSync(outputDir).some((f) =>
        f.toLowerCase().endsWith(".dxf"),
      );
      if (!hasOutput) {
        throw new Error("ODA File Converter failed to convert the file.");
      }
    }

    // Find the output DXF file
    const outputFiles = readdirSync(outputDir).filter((f) =>
      f.toLowerCase().endsWith(".dxf"),
    );

    if (outputFiles.length === 0) {
      throw new Error("DWG to DXF conversion produced no output. The file may be corrupt or unsupported.");
    }

    const dxfContent = readFileSync(join(outputDir, outputFiles[0]), "utf-8");
    return dxfContent;
  } finally {
    // Cleanup temp dirs
    try {
      rmSync(inputDir, { recursive: true, force: true });
      rmSync(outputDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Check if ODA File Converter is available on this system.
 */
export function isConverterAvailable(): boolean {
  return findOdaConverter() !== null;
}
