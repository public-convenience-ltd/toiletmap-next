export const openApiInfo = {
  title: "Toilet Map API",
  version: "1.0.0",
  description: "Programmatic access to Toilet Map loos and administrative areas.",
};

export const openApiTags = [
  { name: "Meta", description: "General service endpoints." },
  { name: "Areas", description: "Administrative area operations." },
  { name: "Loos", description: "Operations relating to loos." },
];

export const openApiServers = [
  {
    url: "https://toiletmap-server.gbtoiletmap.workers.dev",
    description: "Production",
  },
  { url: "http://localhost:8787", description: "Local development" },
];
