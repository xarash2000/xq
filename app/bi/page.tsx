"use client";

import { useState } from "react";
import { BIPage } from "@/components/bi/BIPage";
import { BIConfig } from "@/lib/types/bi";

export default function BIPageRoute() {
  const [config, setConfig] = useState<BIConfig | null>(null);
  const [loading, setLoading] = useState(false);

  const handleConfigUpdate = (newConfig: BIConfig) => {
    setConfig(newConfig);
    setLoading(false);
  };

  return (
    <BIPage
      config={config}
      onConfigUpdate={handleConfigUpdate}
      loading={loading}
    />
  );
}

