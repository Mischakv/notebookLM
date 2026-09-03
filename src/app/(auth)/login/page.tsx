import { redirect } from "next/navigation";

/** Sign-in now lives at `/`. Kept so existing links and redirect targets work. */
export default function LoginPage() {
  redirect("/");
}
