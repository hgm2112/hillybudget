import { redirect } from "next/navigation";
import { requireUser, getHousehold } from "@/lib/session";
import { HouseholdForm } from "./household-form";

export default async function HouseholdPage() {
  await requireUser();
  const household = await getHousehold();
  if (household) redirect("/dashboard");

  return (
    <main className="mx-auto max-w-4xl p-4 md:p-8">
      <HouseholdForm />
    </main>
  );
}
