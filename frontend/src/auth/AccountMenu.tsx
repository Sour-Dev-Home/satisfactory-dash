import { LogoutButton } from "./LogoutButton";
import { useSignedInUser } from "./SignedInUser";

/** Who is signed in, and Log out. For the shell's top bar, inside AuthGate. */
export function AccountMenu() {
  const user = useSignedInUser();
  if (!user) return null;
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted max-sm:sr-only">Signed in as {user.name}</span>
      <LogoutButton />
    </div>
  );
}
