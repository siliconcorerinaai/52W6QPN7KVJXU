import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/access";
import { AdminPanel } from "@/components/AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdmin())) notFound();
  return <AdminPanel />;
}
