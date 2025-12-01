declare module "supercluster" {
  import type { Point } from "geojson";

  export interface Options<P, C> {
    minZoom?: number;
    maxZoom?: number;
    minPoints?: number;
    radius?: number;
    extent?: number;
    nodeSize?: number;
    log?: boolean;
    generateId?: boolean;
    reduce?: (accumulated: C, props: P) => void;
    map?: (props: P) => C;
  }

  export interface ClusterProperties {
    cluster: boolean;
    cluster_id: number;
    point_count: number;
    point_count_abbreviated: string | number;
  }

  export interface PointFeature<P> {
    type: "Feature";
    id?: string | number;
    properties: P;
    geometry: Point;
  }

  export interface ClusterFeature<C> {
    type: "Feature";
    id?: string | number;
    properties: C & ClusterProperties;
    geometry: Point;
  }

  export type AnyProps = Record<string, unknown>;

  export default class Supercluster<P = AnyProps, C = AnyProps> {
    constructor(options?: Options<P, C>);
    load(points: PointFeature<P>[]): Supercluster<P, C>;
    getClusters(
      bbox: [number, number, number, number],
      zoom: number,
    ): Array<ClusterFeature<C> | PointFeature<P>>;
    getTile(
      z: number,
      x: number,
      y: number,
    ): { features: Array<ClusterFeature<C> | PointFeature<P>> } | null;
    getChildren(clusterId: number): Array<ClusterFeature<C> | PointFeature<P>>;
    getLeaves(clusterId: number, limit?: number, offset?: number): PointFeature<P>[];
    getClusterExpansionZoom(clusterId: number): number;
  }
}
