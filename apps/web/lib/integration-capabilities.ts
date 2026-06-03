import type { Integration } from "@autocyber/core";

type Provider = Integration["provider"];
type CapabilityTone = "blue" | "green" | "gray";

interface IntegrationCapability {
  label: string;
  tone: CapabilityTone;
}

const capabilities: Record<Provider, IntegrationCapability> = {
  github: {
    label: "Token-mode PR prototype",
    tone: "blue"
  },
  vercel: {
    label: "Scanner checks available",
    tone: "green"
  },
  supabase: {
    label: "Scanner checks available",
    tone: "green"
  },
  clerk: {
    label: "Scanner checks available",
    tone: "green"
  },
  stripe: {
    label: "Scanner checks available",
    tone: "green"
  },
  firebase: {
    label: "Planned",
    tone: "gray"
  },
  railway: {
    label: "Planned",
    tone: "gray"
  },
  render: {
    label: "Planned",
    tone: "gray"
  },
  openai: {
    label: "Scanner checks available",
    tone: "green"
  },
  anthropic: {
    label: "Scanner checks available",
    tone: "green"
  }
};

export function getIntegrationCapability(provider: Provider): IntegrationCapability {
  return capabilities[provider];
}
