import { access, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { marked } from "marked";
import { writeTextFile } from "../utils/fs.js";
import { runCommand } from "../utils/process.js";

async function commandExists(commandPath: string): Promise<boolean> {
  try {
    await access(commandPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveWkhtmltopdfCommand(): Promise<string> {
  const configured = process.env.WKHTMLTOPDF_PATH?.trim();
  if (configured && (await commandExists(configured))) {
    return configured;
  }

  if (process.platform === "win32") {
    const candidates = [
      "C:/Program Files/wkhtmltopdf/bin/wkhtmltopdf.exe",
      "C:/Program Files (x86)/wkhtmltopdf/bin/wkhtmltopdf.exe",
    ];

    for (const candidate of candidates) {
      if (await commandExists(candidate)) {
        return candidate;
      }
    }
  }

  return "wkhtmltopdf";
}

export async function renderPdf(markdown: string, outPdfPath: string): Promise<void> {
  const html = marked.parse(markdown);
  const htmlDoc = `<!doctype html>
<html>
<head>
<meta charset=\"utf-8\" />
<title>Documentation Export</title>
<style>
body { font-family: "Segoe UI", Tahoma, sans-serif; line-height: 1.5; margin: 24px; }
pre, code { font-family: Consolas, "Courier New", monospace; }
pre { background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
h1, h2 { page-break-after: avoid; }
h2 { margin-top: 40px; padding-top: 16px; border-top: 1px solid #ddd; }
</style>
</head>
<body>${html}</body>
</html>`;

  const tempHtmlPath = `${outPdfPath}.tmp.html`;
  await writeTextFile(tempHtmlPath, htmlDoc);

  const wkhtmltopdfCommand = await resolveWkhtmltopdfCommand();
  await rm(outPdfPath, { force: true });
  const result = await runCommand(wkhtmltopdfCommand, [
    "--load-error-handling",
    "ignore",
    "--load-media-error-handling",
    "ignore",
    tempHtmlPath,
    outPdfPath,
  ]);
  // wkhtmltopdf can exit non-zero on missing resources (e.g. a 404 image) while still writing the PDF.
  const pdfWritten = await stat(outPdfPath).then((info) => info.size > 0).catch(() => false);
  if (result.exitCode !== 0 && !pdfWritten) {
    throw new Error(
      `wkhtmltopdf failed. Ensure wkhtmltopdf is installed and available on PATH, or set WKHTMLTOPDF_PATH. ${result.stderr || result.stdout}`,
    );
  }
}
