import { useLocation } from "@solidjs/router";
import { UserMenu } from "~/components/ark-ui/UserMenu";
import { ThemeSwitcher } from "~/components/ark-ui/ThemeSwitcher";

export default function Nav() {
  const location = useLocation();
  const active = (path: string) =>
    path == location.pathname
      ? "border-neon-cyan"
      : "border-transparent hover:border-neon-cyan/50";
  return (
    <nav bg="dark-bg-secondary" border="b dark-border-primary">
      <ul text="dark-text-primary" p="3" container flex items-center>
        <li class={`border-b-2 ${active("/")} mx-1.5 transition-colors sm:mx-6`}>
          <a href="/" hover="text-neon-cyan">Home</a>
        </li>
        <li class={`border-b-2 ${active("/about")} mx-1.5 transition-colors sm:mx-6`}>
          <a href="/about" hover="text-neon-cyan">About</a>
        </li>
        <li flex items-center gap-3 m="l-auto">
          <ThemeSwitcher />
          <UserMenu />
        </li>
      </ul>
    </nav>
  );
}
