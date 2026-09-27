import { isInOrganizationFolder } from "./isInOrganizationFolder.ts";

describe("isInOrganizationFolder", () => {
  it("accepts files in the organization folder", () => {
    expect(isInOrganizationFolder("12/0.123.jpg", 12)).toBe(true);
    expect(isInOrganizationFolder("12/notes/0.123.jpg", 12)).toBe(true);
  });

  it("rejects files of another organization", () => {
    expect(isInOrganizationFolder("13/0.123.jpg", 12)).toBe(false);
    expect(isInOrganizationFolder("123/0.123.jpg", 12)).toBe(false);
  });

  it("rejects files outside of any organization folder", () => {
    expect(isInOrganizationFolder("0.123.jpg", 12)).toBe(false);
    expect(isInOrganizationFolder("/12/0.123.jpg", 12)).toBe(false);
    expect(isInOrganizationFolder("12/../13/0.123.jpg", 12)).toBe(false);
    expect(isInOrganizationFolder("12/", 12)).toBe(false);
  });
});
