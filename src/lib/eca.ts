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
 * The 10 China/Korea ports capping sulphur at 0.10%.
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
  "KRINC", // Incheon
  "KRPUS", // Busan
]);

/**
 * The 12 ports with no IFO380 column and no high-sulphur market.
 *
 * A scrubber-fitted hull calling here lifts VLSFO instead. Assigning grade by
 * scrubber fitting alone is the bug this set replaced — see data/README.md.
 */
export const NO_HSFO_PORTS: ReadonlySet<string> = new Set([
  "BDCGP", // Chittagong
  "BDMGL", // Mongla
  "CNSHA", // Shanghai
  "IDJKT", // Jakarta
  "IDSRG", // Semarang
  "IDSUB", // Surabaya
  "INCCU", // Kolkata
  "INGAV", // Gangavaram
  "MMRGN", // Yangon
  "THBKK", // Bangkok
  "VNHPH", // Haiphong
  "VNUIH", // Qui Nhon
]);

/** Whether a berth caps sulphur at 0.10% rather than the global 0.50%. */
export function isEcaPort(portCode: string | null): boolean {
  return portCode !== null && ECA_PORTS.has(portCode);
}

/**
 * Whether high-sulphur fuel can actually be bought at a port.
 *
 * Unknown codes return true: this gates a warning, and warning about a port we
 * hold no information on would be inventing a fact.
 */
export function hasHsfoMarket(portCode: string | null): boolean {
  return portCode === null || !NO_HSFO_PORTS.has(portCode);
}
