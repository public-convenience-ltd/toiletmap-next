import type { MapLoo, CacheTreeStats } from "./types";
import { TILE_TTL_MS } from "./utils";

export type CoverageKind = "compressed" | "full";

export type CacheTreeNode = {
  coverageFetchedAt: number | null;
  coverageKind: CoverageKind | null;
  children: Record<string, CacheTreeNode>;
  loos?: Record<string, MapLoo>;
};

export type CacheTree = {
  root: CacheTreeNode;
};

export type CacheTreeSnapshot = {
  version: number;
  root: CacheTreeNode;
};

export const CACHE_TREE_VERSION = 1;
export const CACHE_TREE_STORAGE_KEY = "tile-cache-tree.v1";

const createChildContainer = () => Object.create(null) as Record<string, CacheTreeNode>;

const createNode = (): CacheTreeNode => ({
  coverageFetchedAt: null,
  coverageKind: null,
  children: createChildContainer(),
});

export const createCacheTree = (): CacheTree => ({
  root: createNode(),
});

const normalizeNode = (node?: CacheTreeNode): CacheTreeNode => {
  if (!node) return createNode();
  const normalized: CacheTreeNode = {
    coverageFetchedAt: typeof node.coverageFetchedAt === "number" ? node.coverageFetchedAt : null,
    coverageKind:
      node.coverageKind === "full"
        ? "full"
        : node.coverageKind === "compressed"
          ? "compressed"
          : null,
    children: createChildContainer(),
  };
  if (node.loos) {
    normalized.loos = { ...node.loos };
  }
  const entries = node.children ? Object.entries(node.children) : [];
  for (const [char, child] of entries) {
    normalized.children[char] = normalizeNode(child);
  }
  return normalized;
};

export const fromSnapshot = (snapshot?: CacheTreeSnapshot | null): CacheTree => {
  if (!snapshot || snapshot.version !== CACHE_TREE_VERSION || !snapshot.root) {
    return createCacheTree();
  }
  return { root: normalizeNode(snapshot.root) };
};

export const toSnapshot = (tree: CacheTree): CacheTreeSnapshot => ({
  version: CACHE_TREE_VERSION,
  root: tree.root,
});

const traverse = (
  node: CacheTreeNode,
  path: string,
  createIfMissing: boolean,
): CacheTreeNode | null => {
  if (!path) return node;
  let current: CacheTreeNode = node;
  for (const char of path) {
    let next = current.children[char];
    if (!next) {
      if (!createIfMissing) return null;
      next = createNode();
      current.children[char] = next;
    }
    current = next;
  }
  return current;
};

const clearSubtree = (node: CacheTreeNode) => {
  node.coverageFetchedAt = null;
  node.coverageKind = null;
  node.loos = undefined;
  node.children = createChildContainer();
};

const insertLoo = (root: CacheTreeNode, loo: MapLoo) => {
  let current = root;
  for (const char of loo.geohash) {
    let next = current.children[char];
    if (!next) {
      next = createNode();
      current.children[char] = next;
    }
    current = next;
  }
  current.loos ??= {};
  current.loos[loo.id] = loo;
};

const collectFromNode = (node: CacheTreeNode | null, acc: MapLoo[] = []): MapLoo[] => {
  if (!node) return acc;
  if (node.loos) {
    acc.push(...Object.values(node.loos));
  }
  const children = Object.values(node.children);
  for (const child of children) {
    collectFromNode(child, acc);
  }
  return acc;
};

const isFresh = (timestamp: number | null, now: number) =>
  typeof timestamp === "number" && now - timestamp <= TILE_TTL_MS;

const findNearestFreshCoverageNode = (root: CacheTreeNode, prefix: string, now: number) => {
  for (let length = prefix.length; length >= 0; length -= 1) {
    const partial = prefix.slice(0, length);
    const candidate = traverse(root, partial, false);
    if (candidate && isFresh(candidate.coverageFetchedAt, now)) {
      return { node: candidate, prefix: partial };
    }
  }
  return null;
};

export type CacheHit = {
  data: MapLoo[];
  fetchedAt: number;
  sourcePrefix: string;
  coverageKind: CoverageKind | null;
};

export const getCachedTileData = (tree: CacheTree, tile: string, now: number): CacheHit | null => {
  const exactNode = traverse(tree.root, tile, false);
  if (exactNode && isFresh(exactNode.coverageFetchedAt, now)) {
    const fetchedAt = exactNode.coverageFetchedAt;
    if (typeof fetchedAt !== "number") {
      return null;
    }
    return {
      data: collectFromNode(exactNode, []),
      fetchedAt,
      sourcePrefix: tile,
      coverageKind: exactNode.coverageKind ?? null,
    };
  }

  const ancestor = findNearestFreshCoverageNode(tree.root, tile, now);
  if (!ancestor) return null;
  const suffix = tile.slice(ancestor.prefix.length);
  const target = suffix ? traverse(ancestor.node, suffix, false) : ancestor.node;
  const fetchedAt = ancestor.node.coverageFetchedAt;
  if (typeof fetchedAt !== "number") {
    return null;
  }
  return {
    data: collectFromNode(target, []),
    fetchedAt,
    sourcePrefix: ancestor.prefix,
    coverageKind: ancestor.node.coverageKind ?? null,
  };
};

export const replaceTileData = (
  tree: CacheTree,
  tile: string,
  loos: MapLoo[],
  fetchedAt: number,
  coverageKind: CoverageKind,
) => {
  const target = traverse(tree.root, tile, true);
  if (!target) return;
  clearSubtree(target);
  target.coverageFetchedAt = fetchedAt;
  target.coverageKind = coverageKind;

  for (const loo of loos) {
    if (!loo.geohash.startsWith(tile)) continue;
    insertLoo(tree.root, loo);
  }
};

export const computeCacheTreeStats = (tree: CacheTree, now: number): CacheTreeStats => {
  const stats: CacheTreeStats = {
    nodeCount: 0,
    leafCount: 0,
    uniqueLoos: 0,
    coverageNodes: 0,
    freshCoverageNodes: 0,
    fullCoverageNodes: 0,
    hydratedLoos: 0,
    maxDepth: 0,
  };

  const walk = (node: CacheTreeNode, depth: number) => {
    stats.nodeCount += 1;
    if (node.loos) {
      stats.leafCount += 1;
      const loos = Object.values(node.loos);
      stats.uniqueLoos += loos.length;
      stats.hydratedLoos += loos.filter((loo) => loo.detailLevel === "full").length;
    }
    if (typeof node.coverageFetchedAt === "number") {
      stats.coverageNodes += 1;
      if (isFresh(node.coverageFetchedAt, now)) {
        stats.freshCoverageNodes += 1;
      }
      if (node.coverageKind === "full") {
        stats.fullCoverageNodes += 1;
      }
    }
    if (depth > stats.maxDepth) {
      stats.maxDepth = depth;
    }
    for (const child of Object.values(node.children)) {
      walk(child, depth + 1);
    }
  };

  walk(tree.root, 0);
  return stats;
};

export const shouldHydrateTile = (tree: CacheTree, tile: string, now: number) => {
  const node = traverse(tree.root, tile, false);
  if (!node) return true;
  if (!isFresh(node.coverageFetchedAt, now)) return true;
  return node.coverageKind !== "full";
};
