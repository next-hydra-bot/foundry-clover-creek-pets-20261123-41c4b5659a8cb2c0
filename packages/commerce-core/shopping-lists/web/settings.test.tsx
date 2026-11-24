import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { ShoppingListAction } from "./action-contract";
import { ShoppingListSettings } from "./settings";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

describe("Shopping list settings", () => {
  let root: ReturnType<typeof createRoot> | undefined;
  beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
  afterEach(() => {
    act(() => root?.unmount());
    document.body.replaceChildren();
    vi.clearAllMocks();
  });
  afterAll(() => vi.unstubAllGlobals());

  it("saves a name from its labeled dialog and returns to the list", async () => {
    const action = vi.fn<ShoppingListAction>(async () => ({
      _tag: "Success",
      success: { locale: "en-US" },
    }));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root?.render(
        <ShoppingListSettings
          action={action}
          fields={{ id: "list" }}
          name="Weekly"
          labels={{
            rename: "Rename",
            name: "List name",
            save: "Save",
            delete: "Delete",
            confirmDelete: "Delete list",
            deleteDescription: "Delete this list",
            renameDescription: "Change the list name",
            cancel: "Cancel",
            pendingLabel: "Saving",
            refreshLabel: "Refresh",
            savedLabel: "Saved",
          }}
        />
      )
    );
    const trigger = container.querySelector("button");
    if (!trigger) throw new Error("Expected the rename control");
    act(() => trigger.click());
    const dialog = document.querySelector('[role="dialog"]');
    const input = dialog?.querySelector<HTMLInputElement>('input[name="name"]');
    const label = dialog?.querySelector("label");
    expect(input?.value).toBe("Weekly");
    expect(label?.htmlFor).toBe(input?.id);
    const form = dialog?.querySelector("form");
    if (!form || !input) throw new Error("Expected the name form");
    input.value = "Monthly";
    await act(async () => form.requestSubmit());
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    );
    expect(action.mock.calls[0]?.[0].get("name")).toBe("Monthly");
    expect(refresh).toHaveBeenCalledOnce();
  });
});
