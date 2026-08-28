import { describe, it, expect } from "vitest";
import { parseAllowedIds, isAllowedById } from "../access";

const A = "15d852ed-1f33-446f-9bcb-821c2444c84f";
const B = "096f951e-d49b-4a81-ba82-fbfa5ee3871e";

describe("parseAllowedIds", () => {
  it("läser en kommaseparerad lista", () => {
    expect(parseAllowedIds(`${A},${B}`)).toEqual([A, B]);
  });

  it("tål mellanslag och radbrytningar", () => {
    expect(parseAllowedIds(` ${A} ,\n ${B} `)).toEqual([A, B]);
  });

  it("släpper allt som inte är ett uuid", () => {
    expect(parseAllowedIds(`${A}, inte-ett-id, 12345`)).toEqual([A]);
  });

  it("tar bort dubbletter", () => {
    expect(parseAllowedIds(`${A},${A.toUpperCase()}`)).toEqual([A]);
  });

  it("ger tom lista för tomt eller osatt värde", () => {
    expect(parseAllowedIds(undefined)).toEqual([]);
    expect(parseAllowedIds("")).toEqual([]);
    expect(parseAllowedIds("   ")).toEqual([]);
  });
});

describe("isAllowedById", () => {
  it("släpper in den som står på listan, oavsett skiftläge", () => {
    expect(isAllowedById(A.toUpperCase(), [A])).toBe(true);
  });

  it("stänger ute den som inte står där", () => {
    expect(isAllowedById(B, [A])).toBe(false);
  });

  it("stänger ute när listan är tom eller användaren saknas", () => {
    expect(isAllowedById(A, [])).toBe(false);
    expect(isAllowedById(null, [A])).toBe(false);
  });
});
