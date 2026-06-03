import type { ProductStage } from "../types/domain";

export const PRODUCT_NAME = "AutoCyber";

export const CORE_LOOP = ["Detect", "Explain", "Fix", "Verify", "PR", "Remember", "Monitor"] as const;

export const CURRENT_STAGE: ProductStage = "stage-0-foundation";
