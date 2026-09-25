import { fireEvent, screen, within } from "@testing-library/react";

/** Opens the top bar's account menu (AccountMenu) and returns its panel. */
export async function openAccountMenu(): Promise<ReturnType<typeof within>> {
  const toggle = await screen.findByRole("button", { name: "Account" });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return within(document.getElementById(toggle.getAttribute("aria-controls")!)!);
}

/** Signs out through the account menu. */
export async function signOutFromMenu(everywhere = false): Promise<void> {
  const menu = await openAccountMenu();
  fireEvent.click(menu.getByRole("button", { name: everywhere ? "Sign out everywhere" : "Sign out" }));
}
