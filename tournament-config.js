export const MODE = "32"; // "32" ou "16"

const POULES_32 = ["A", "B", "C", "D", "E", "F", "G", "H"];
const POULES_16 = ["A", "B", "C", "D"];

export const POULES = MODE === "16" ? POULES_16 : POULES_32;
