/**
 * Renders a SpotBunkerRequest to a downloadable PDF.
 *
 * Client-only (jsPDF builds the document in-browser and triggers the save),
 * so this must never be imported from a server component. A plain text
 * layout rather than a table library: the form is a flat list of
 * label/value pairs, not tabular data, and jspdf-autotable would be a
 * second dependency for something a manual y-cursor already handles.
 */

import jsPDF from "jspdf";
import { formatMt } from "./format";
import {
  isResidual,
  type SpotBunkerRequest,
  type SpotContext,
  type SpotIssue,
} from "./spotBunker";
import type { VesselSpec } from "./types";

type Row = [string, string];

const PAGE_MARGIN = 14;
const LINE_HEIGHT = 5.2;
const SECTION_GAP = 3;

const yn = (v: boolean) => (v ? "Yes" : "No");
const mt = (v: number | null) => (v === null ? "—" : `${formatMt(v)} MT`);
const str = (v: string | null) => (v === null || v === "" ? "—" : v);

function sectionRows(
  value: SpotBunkerRequest,
  ctx: SpotContext,
): Array<{ title: string; rows: Row[] }> {
  const residual = isResidual(value.grade);
  const distillate = value.grade === "MGO";
  const headroom = residual ? ctx.residualHeadroomMt : ctx.mgoHeadroomMt;

  const sections: Array<{ title: string; rows: Row[] }> = [
    {
      title: "Fuel grade & specification",
      rows: [
        ["Required grade", str(value.grade)],
        ...(value.grade === "HSFO"
          ? ([
              [
                "Scrubber confirmed operational",
                yn(value.scrubberOperational),
              ],
            ] as Row[])
          : []),
        [
          "ISO 8217 edition",
          value.isoVersion ? `ISO 8217:${value.isoVersion}` : "—",
        ],
      ],
    },
    {
      title: "Quantity & ROB",
      rows: [
        ["Nomination", mt(value.nominationMt)],
        ["Current ROB", mt(value.robMt)],
        ["Burn to delivery", mt(value.projectedConsumptionMt)],
        [
          "Headroom on arrival",
          headroom === null ? "—" : `${formatMt(headroom)} MT`,
        ],
        [
          "Port stay",
          value.portStayDays === null ? "—" : `${value.portStayDays} days`,
        ],
      ],
    },
    {
      title: "Temperature & cold flow",
      rows: [
        [
          "Maximum pour point",
          value.maxPourPointC === null ? "—" : `${value.maxPourPointC} °C`,
        ],
        ...(distillate
          ? ([
              [
                "Minimum viscosity",
                value.minViscosityCst === null
                  ? "—"
                  : `${value.minViscosityCst} mm²/s`,
              ],
            ] as Row[])
          : []),
        ...(residual
          ? ([
              [
                "Residual viscosity",
                value.residualViscosityGrade
                  ? `${value.residualViscosityGrade} CST`
                  : "—",
              ],
              ...(value.residualViscosityGrade === "500"
                ? ([
                    [
                      "Heaters confirmed for 500 CST",
                      yn(value.heaterConfirmedFor500Cst),
                    ],
                  ] as Row[])
                : []),
            ] as Row[])
          : []),
      ],
    },
    {
      title: "Environmental & statutory",
      rows: [
        [
          "Maximum sulphur",
          value.maxSulphurPct === null
            ? "—"
            : `${value.maxSulphurPct.toFixed(2)}% m/m`,
        ],
        [
          "Minimum flash point",
          value.minFlashPointC === null ? "—" : `${value.minFlashPointC} °C`,
        ],
        [
          "Supplier flash point declaration required",
          yn(value.supplierFlashDeclarationRequired),
        ],
      ],
    },
    {
      title: "Schedule, port & barging",
      rows: [
        ["Bunkering port", str(ctx.portName ?? ctx.portCode)],
        ["ETA window", `${str(value.etaWindowStart)} — ${str(value.etaWindowEnd)}`],
        ["ETD window", `${str(value.etdWindowStart)} — ${str(value.etdWindowEnd)}`],
        ["Bunkering method", str(value.deliveryLocation)],
        ["SIMOPS (during cargo ops)", yn(value.simops)],
        ["Dual-grade barge pairing", yn(value.bargePairing)],
        ...(value.bargePairing
          ? ([
              ["Second grade on barge", str(value.bargePairingGrade)],
            ] as Row[])
          : []),
      ],
    },
    {
      title: "Surveyor & quality testing",
      rows: [
        ["Biofuel lifting", yn(value.biofuelLifting)],
        ["Bunker quantity survey (BQS)", yn(value.bqsRequested)],
        ...(value.bqsRequested
          ? ([
              ["Surveyor", str(value.bqsSurveyor)],
              ...(!value.biofuelLifting
                ? ([
                    ["SRCM Head approval reference", str(value.srcmApprovalRef)],
                    ["Justification", str(value.bqsJustification)],
                  ] as Row[])
                : []),
            ] as Row[])
          : []),
        ["Supplier lab COQ requested in advance", yn(value.coqRequested)],
        ["Contaminant screening", yn(value.contaminantScreening)],
        ["FQT sampling bottles prepared", yn(value.fqtSamplesPrepared)],
      ],
    },
    {
      title: "Notes",
      rows: [["For the desk", str(value.notes)]],
    },
  ];

  return sections;
}

/** Strips characters a filesystem is likely to reject. */
function safeFileSegment(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}

export function generateSpotBunkerPdf(
  spec: VesselSpec,
  ctx: SpotContext,
  value: SpotBunkerRequest,
  issues: SpotIssue[],
): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const labelWidth = 62;

  let y = PAGE_MARGIN;

  const ensureRoom = (needed: number) => {
    if (y + needed > pageHeight - PAGE_MARGIN) {
      doc.addPage();
      y = PAGE_MARGIN;
    }
  };

  // --- Header ---------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Spot Bunker Requirement", PAGE_MARGIN, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(spec.name, PAGE_MARGIN, y);
  y += 5;

  doc.setFontSize(9);
  doc.setTextColor(90);
  doc.text(
    `${ctx.fromPortCode ?? "—"} -> ${ctx.portCode ?? "—"}` +
      (ctx.portName ? ` ${ctx.portName}` : "") +
      ` · arriving ${ctx.arrivalTimestamp ?? "—"}`,
    PAGE_MARGIN,
    y,
  );
  y += 4;
  doc.text(`Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, PAGE_MARGIN, y);
  doc.setTextColor(0);
  y += SECTION_GAP + 2;

  // --- Sections ---------------------------------------------------------
  for (const section of sectionRows(value, ctx)) {
    ensureRoom(LINE_HEIGHT * 2);
    doc.setDrawColor(210);
    doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
    y += 5;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text(section.title, PAGE_MARGIN, y);
    y += LINE_HEIGHT + 1;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);

    for (const [label, val] of section.rows) {
      const valueLines = doc.splitTextToSize(val, contentWidth - labelWidth);
      ensureRoom(LINE_HEIGHT * valueLines.length);
      doc.setTextColor(100);
      doc.text(label, PAGE_MARGIN, y);
      doc.setTextColor(0);
      doc.text(valueLines, PAGE_MARGIN + labelWidth, y);
      y += LINE_HEIGHT * valueLines.length;
    }
    y += SECTION_GAP;
  }

  // --- Warnings / errors -------------------------------------------------
  if (issues.length > 0) {
    ensureRoom(LINE_HEIGHT * 2);
    doc.setDrawColor(210);
    doc.line(PAGE_MARGIN, y, pageWidth - PAGE_MARGIN, y);
    y += 5;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text("Flags", PAGE_MARGIN, y);
    y += LINE_HEIGHT + 1;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (const issue of issues) {
      const prefix = issue.level === "error" ? "ERROR: " : "WARN: ";
      const lines = doc.splitTextToSize(
        `${prefix}${issue.message}`,
        contentWidth,
      );
      ensureRoom(LINE_HEIGHT * lines.length);
      doc.setTextColor(issue.level === "error" ? 180 : 140, 60, 40);
      doc.text(lines, PAGE_MARGIN, y);
      doc.setTextColor(0);
      y += LINE_HEIGHT * lines.length;
    }
    y += SECTION_GAP;
  }

  // --- Provenance footer ---------------------------------------------------
  ensureRoom(LINE_HEIGHT * 3);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  const disclaimer = doc.splitTextToSize(
    "Arrival, ROB and headroom are read off a simulated movement series, not a " +
      "published ETA or measured tank sounding. Nothing on this form is a live " +
      "supplier quote — treat this document as a draft requirement to route through " +
      "the bunker desk, not an order.",
    contentWidth,
  );
  doc.text(disclaimer, PAGE_MARGIN, y);
  doc.setTextColor(0);

  const filename = `spot-bunker-${safeFileSegment(spec.name)}-${safeFileSegment(
    ctx.portCode ?? "port",
  )}.pdf`;
  doc.save(filename);
}
