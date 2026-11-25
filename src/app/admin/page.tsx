import { notFound } from "next/navigation";
import { AdminPanel } from "@/components/AdminPanel";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if ((await currentUser())?.role !== "admin") notFound();
  return <AdminPanel />;
}
