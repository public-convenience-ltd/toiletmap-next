import type { PrismaClientInstance } from '../../../src/prisma';

class CleanupManager {
    private looIds: Set<string> = new Set();

    trackLoo(id: string) {
        this.looIds.add(id);
    }

    async cleanup(prisma: PrismaClientInstance) {
        if (this.looIds.size > 0) {
            await prisma.toilets.deleteMany({
                where: {
                    id: {
                        in: Array.from(this.looIds),
                    },
                },
            });
            this.looIds.clear();
        }
    }
}

export const cleanupManager = new CleanupManager();
