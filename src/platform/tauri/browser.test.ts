import { describe, expect, it } from "vitest";
import { normalizeBrowserUrl } from "./browser";

describe("normalizeBrowserUrl", () => {
  it("returns empty string when input is empty", () => {
    expect(normalizeBrowserUrl("")).toBe("");
    expect(normalizeBrowserUrl("   ")).toBe("");
  });

  it("preserves valid http and https URLs", () => {
    expect(normalizeBrowserUrl("https://google.com")).toBe("https://google.com");
    expect(normalizeBrowserUrl("http://localhost:3000/api")).toBe("http://localhost:3000/api");
  });

  it("prepends http to localhost and 127.0.0.1", () => {
    expect(normalizeBrowserUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBrowserUrl("localhost:5173/dashboard")).toBe("http://localhost:5173/dashboard");
    expect(normalizeBrowserUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  it("prepends https to domain names", () => {
    expect(normalizeBrowserUrl("google.com")).toBe("https://google.com");
    expect(normalizeBrowserUrl("github.com/torvalds/linux")).toBe("https://github.com/torvalds/linux");
    expect(normalizeBrowserUrl("vite.dev")).toBe("https://vite.dev");
  });

  it("transforms search terms into Google search URL", () => {
    expect(normalizeBrowserUrl("react router tutorial")).toBe(
      "https://www.google.com/search?q=react%20router%20tutorial",
    );
    expect(normalizeBrowserUrl("como centrar un div")).toBe(
      "https://www.google.com/search?q=como%20centrar%20un%20div",
    );
  });
});
