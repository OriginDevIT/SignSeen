import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "./middleware";

function req(path: string) {
  return new NextRequest(new URL(`https://getsignseen.com${path}`));
}

describe("coming-soon middleware", () => {
  it("lets the root through", () => {
    const res = middleware(req("/"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects every other page path to the root", () => {
    for (const path of ["/send", "/signup", "/dashboard", "/verify", "/terms"]) {
      const res = middleware(req(path));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("https://getsignseen.com/");
    }
  });
});
