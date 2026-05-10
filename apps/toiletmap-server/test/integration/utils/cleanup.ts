import type { PrismaClientInstance } from "../../../src/prisma";

class CleanupManager {
  private looIds: Set<string> = new Set();
  private pendingChangeIds: Set<string> = new Set();

  trackLoo(id: string) {
    this.looIds.add(id);
  }

  trackPendingChange(id: string) {
    this.pendingChangeIds.add(id);
  }

  async cleanup(prisma: PrismaClientInstance) {
    if (this.pendingChangeIds.size > 0) {
      await prisma.pending_change.deleteMany({
        where: { id: { in: Array.from(this.pendingChangeIds) } },
      });
      this.pendingChangeIds.clear();
    }
    if (this.looIds.size > 0) {
      await prisma.toilets.deleteMany({
        where: { id: { in: Array.from(this.looIds) } },
      });
      this.looIds.clear();
    }
  }
}

export const cleanupManager = new CleanupManager();
