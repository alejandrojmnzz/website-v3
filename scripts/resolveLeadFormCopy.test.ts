import { describe, expect, it } from "vitest";
import {
  resolveLeadFormCopy,
  resolveLeadFormPhase,
} from "../client/src/lib/resolveLeadFormCopy";

describe("resolveLeadFormPhase", () => {
  it("returns guest_signup when not a signup form", () => {
    expect(
      resolveLeadFormPhase({
        isSignup: false,
        loginMode: true,
        isLoggedIn: true,
        allVisibleFieldsFilled: true,
      }),
    ).toBe("guest_signup");
  });

  it("returns login when loginMode is on", () => {
    expect(
      resolveLeadFormPhase({
        isSignup: true,
        loginMode: true,
        isLoggedIn: false,
        allVisibleFieldsFilled: false,
      }),
    ).toBe("login");
  });

  it("returns logged_in_incomplete when visible fields are still empty", () => {
    expect(
      resolveLeadFormPhase({
        isSignup: true,
        loginMode: false,
        isLoggedIn: true,
        allVisibleFieldsFilled: false,
      }),
    ).toBe("logged_in_incomplete");
  });

  it("returns logged_in_ready when every visible field is filled", () => {
    expect(
      resolveLeadFormPhase({
        isSignup: true,
        loginMode: false,
        isLoggedIn: true,
        allVisibleFieldsFilled: true,
      }),
    ).toBe("logged_in_ready");
  });
});

describe("resolveLeadFormCopy", () => {
  it("keeps guest title/subtitle optional when messages.guest is omitted", () => {
    const copy = resolveLeadFormCopy("guest_signup", {}, "en");
    expect(copy.title).toBeUndefined();
    expect(copy.subtitle).toBeUndefined();
    expect(copy.submit_label).toBe("Submit");
  });

  it("uses messages.guest over top-level title/subtitle", () => {
    const copy = resolveLeadFormCopy(
      "guest_signup",
      {
        title: "Top title",
        subtitle: "Top subtitle",
        submit_label: "Top submit",
        messages: {
          guest: {
            title: "Nested title",
            subtitle: "Nested subtitle",
            submit_label: "Nested submit",
          },
        },
      },
      "en",
    );
    expect(copy).toEqual({
      title: "Nested title",
      subtitle: "Nested subtitle",
      submit_label: "Nested submit",
    });
  });

  it("uses messages.incomplete overrides", () => {
    const copy = resolveLeadFormCopy(
      "logged_in_incomplete",
      {
        messages: {
          incomplete: {
            title: "Custom almost",
            subtitle: "Custom missing",
            submit_label: "Go",
          },
        },
      },
      "en",
    );
    expect(copy).toEqual({
      title: "Custom almost",
      subtitle: "Custom missing",
      submit_label: "Go",
    });
  });

  it("falls back to locale defaults for ready", () => {
    const copy = resolveLeadFormCopy("logged_in_ready", {}, "es");
    expect(copy.title).toBe("Todo listo");
    expect(copy.subtitle).toContain("Confirma");
    expect(copy.submit_label).toBe("Confirmar");
  });

  it("uses messages.login and back_label", () => {
    const copy = resolveLeadFormCopy(
      "login",
      { messages: { login: { back_label: "Volver" } } },
      "es",
    );
    expect(copy.title).toBe("Inicia sesión");
    expect(copy.back_label).toBe("Volver");
  });

  it("falls back to deprecated top-level login block", () => {
    const copy = resolveLeadFormCopy(
      "login",
      { login: { title: "Legacy login" } },
      "en",
    );
    expect(copy.title).toBe("Legacy login");
  });
});
