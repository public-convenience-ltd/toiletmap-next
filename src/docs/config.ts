export const openApiInfo = {
  title: 'Toilet Map API',
  version: '1.0.0',
  description:
    'Programmatic access to Toilet Map loos and administrative areas.',
} as const;

export const openApiTags = [
  { name: 'Meta', description: 'General service endpoints.' },
  { name: 'Areas', description: 'Administrative area operations.' },
  { name: 'Loos', description: 'Operations relating to loos.' },
] as const;

export const openApiServers = [
  { url: 'http://localhost:4001', description: 'Local development' },
] as const;
