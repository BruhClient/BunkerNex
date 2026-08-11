/**
 * Regulatory port sets the fuel rules turn on.
 *
 * Both tables are duplicated from scripts/gen-vessel-movement.mjs, which is
 * where they are reasoned about and where data/README.md points. The generator
 * is a .mjs script that TypeScript cannot import, and these are needed
 * client-side to gate and prefill the spot bunker form, so the two copies have
 * to be kept in step by hand — change one and change the other.
 *
 * This is the same trade-off MGO_TANK_RATIO makes in types.ts. Do NOT "fix" it
 * by reading the generator or a CSV: every module that touches disk in this
 * app imports node:fs, and pulling one of those into a client bundle is the
 * failure this duplication exists to avoid.
 */

/**
 * The 22 ports capping sulphur at 0.10%, across all four ECA/DECA zones drawn
 * on the map (src/lib/ecaZones.ts): China's national port ECA, Korea's, the
 * North Sea & English Channel ECA, and the Mediterranean SOx ECA.
 *
 * A vessel runs MGO from a day before berthing here until shortly after
 * departure. VLSFO is a 0.50% grade and does not clear this cap — switching
 * between the two residual grades would be non-compliance dressed as
 * compliance.
 */
export const ECA_PORTS: ReadonlySet<string> = new Set([
  "CNNGB", // Ningbo
  "CNNSA", // Nansha
  "CNQZH", // Qinzhou
  "CNSHA", // Shanghai
  "CNSHK", // Shekou
  "CNTAO", // Qingdao
  "CNTSN", // Tianjin
  "CNXMN", // Xiamen
  "CNYTN", // Yantian
  "KRINC", // Incheon
  "KRPUS", // Busan

  // North Sea & English Channel ECA
  "NLRTM", // Rotterdam
  "BEANR", // Antwerp
  "DEHAM", // Hamburg
  "FRLEH", // Le Havre
  "GBSOU", // Southampton
  "GBFXT", // Felixstowe

  // Mediterranean SOx ECA
  "ESALG", // Algeciras
  "GRPIR", // Piraeus
  "MTMLA", // Malta
  "EGPSD", // Port Said
  "ESVLC", // Valencia
]);

/**
 * The 11 ports with no high-sulphur market.
 *
 * A scrubber-fitted hull calling here lifts VLSFO instead. Assigning grade by
 * scrubber fitting alone is the bug this set replaced — see data/README.md.
 * Algeciras/Piraeus/Malta are here for a different reason than the first
 * eight: not a CE-sheet finding, but the absence of an assessed HSFO
 * column for any of the three.
 */
export const NO_HSFO_PORTS: ReadonlySet<string> = new Set([
  "CNNSA", // Nansha
  "CNQZH", // Qinzhou
  "CNSHK", // Shekou
  "IDSUB", // Surabaya
  "INGAV", // Gangavaram
  "MMRGN", // Yangon
  "VNHPH", // Haiphong
  "VNUIH", // Qui Nhon
  "ESALG", // Algeciras - no priced HSFO market
  "GRPIR", // Piraeus - no priced HSFO market
  "MTMLA", // Malta - no priced HSFO market
]);

/**
 * The 5 ports with no 0.50% residual market.
 *
 * Chittagong and Mongla sell IFO 180/380 and distillate but no VLSFO; Kolkata
 * sells HSFO alone. A non-scrubber hull can stem no residual at any of them.
 */
export const NO_VLSFO_PORTS: ReadonlySet<string> = new Set([
  "BDCGP", // Chittagong
  "BDMGL", // Mongla
  "CNQZH", // Qinzhou
  "INCCU", // Kolkata
  "MMRGN", // Yangon
]);

/** The 5 ports with no distillate market at all. */
export const NO_MGO_PORTS: ReadonlySet<string> = new Set([
  "CNQZH", // Qinzhou
  "INCCU", // Kolkata
  "INGAV", // Gangavaram
  "MMRGN", // Yangon
  "VNHPH", // Haiphong
]);

/** Whether a berth caps sulphur at 0.10% rather than the global 0.50%. */
export function isEcaPort(portCode: string | null): boolean {
  return portCode !== null && ECA_PORTS.has(portCode);
}

/**
 * Whether a grade can actually be bought at a port.
 *
 * Unknown codes return true: these gate warnings, and warning about a port we
 * hold no information on would be inventing a fact.
 *
 * Qinzhou and Yangon fail all three — the CE sheet records no confirmed bunker
 * market at either, so nothing can be lifted there at all.
 */
export function hasHsfoMarket(portCode: string | null): boolean {
  return portCode === null || !NO_HSFO_PORTS.has(portCode);
}

export function hasVlsfoMarket(portCode: string | null): boolean {
  return portCode === null || !NO_VLSFO_PORTS.has(portCode);
}

export function hasMgoMarket(portCode: string | null): boolean {
  return portCode === null || !NO_MGO_PORTS.has(portCode);
}

/** Whether a berth can supply the grade a hull is asking for. */
export function hasMarketFor(
  grade: "VLSFO" | "HSFO" | "MGO",
  portCode: string | null,
): boolean {
  if (grade === "HSFO") return hasHsfoMarket(portCode);
  if (grade === "VLSFO") return hasVlsfoMarket(portCode);
  return hasMgoMarket(portCode);
}
