import { getBIDashboard } from "@/lib/db";
import { BIConfig } from "@/lib/types/bi";
import { BIPage } from "@/components/bi/BIPage";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const dynamicParams = true;

interface Props {
  params: Promise<{ bi_id: string }>;
}

export default async function BIDashboardPage({ params }: Props) {
  const { bi_id } = await params;

  try {
    const dashboard = await getBIDashboard(bi_id);
    const config = JSON.parse(dashboard.config) as BIConfig;

    return (
      <BIPage
        config={config}
        onConfigUpdate={(newConfig) => {
          // Config updates would require a new dashboard or update endpoint
          // For now, this is read-only - updates create new dashboards
          console.log("Config update requested (not implemented for existing dashboards)");
        }}
        loading={false}
      />
    );
  } catch (error) {
    console.error("Failed to load BI dashboard:", error);
    notFound();
  }
}

