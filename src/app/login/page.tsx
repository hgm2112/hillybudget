import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { BrandLogo } from "@/components/brand";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getUser();
  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <BrandLogo className="h-10 w-auto" />
      <LoginForm />
    </main>
  );
}
