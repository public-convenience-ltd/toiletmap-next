/// <reference types="astro/client" />

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}

declare module "leaflet/dist/images/marker-icon.png" {
  const value: string;
  export default value;
}

declare module "leaflet/dist/images/marker-icon-2x.png" {
  const value: string;
  export default value;
}

declare module "leaflet/dist/images/marker-shadow.png" {
  const value: string;
  export default value;
}
