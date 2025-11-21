import 'dotenv/config';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from './generated/client/client';
import { LooService } from '../../src/services/loo';
import type { PrismaClientInstance } from '../../src/prisma';
import type {
    Coordinates,
    LooMutationAttributes,
} from '../../src/services/loo/types';

const PORT = 3001;

if (!process.env.POSTGRES_URI) {
    console.error('POSTGRES_URI is required');
    process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URI });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// --- Logic from fixtures.ts ---

let areaCounter = 0;
let coordinateCounter = 0;

const deterministicAreaId = (counter: number) =>
    counter.toString(16).padStart(24, '0').slice(-24);

const nextCoordinates = (): Coordinates => {
    coordinateCounter += 1;
    return {
        lat: 51.5 + coordinateCounter * 0.001,
        lng: -0.12 - coordinateCounter * 0.001,
    };
};

const generateLooId = () => randomBytes(12).toString('hex');

// --- Server ---

const readBody = (req: any): Promise<any> => {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: any) => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                resolve({});
            }
        });
        req.on('error', reject);
    });
};

const sendJson = (res: any, status: number, data: any) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url || '', `http://localhost:${PORT}`);

        if (req.method === 'POST' && url.pathname === '/fixtures/area') {
            const overrides = await readBody(req);

            areaCounter += 1;
            const area = await prisma.areas.create({
                data: {
                    id: overrides.id ?? deterministicAreaId(areaCounter),
                    name: overrides.name ?? `Area ${areaCounter}`,
                    type: overrides.type ?? 'borough',
                    priority: overrides.priority ?? areaCounter,
                    dataset_id: overrides.datasetId ?? 1,
                    version: overrides.version ?? 1,
                },
            });
            return sendJson(res, 200, area);
        }

        if (req.method === 'POST' && url.pathname === '/fixtures/loo') {
            const overrides = await readBody(req);

            const {
                id = generateLooId(),
                contributor = 'integration-fixture',
                ...mutationOverrides
            } = overrides;

            const { location: _ignoredLocation, ...withoutLocation } = mutationOverrides;
            const hasCustomLocation = Object.prototype.hasOwnProperty.call(
                overrides,
                'location',
            );
            const locationValue = hasCustomLocation
                ? (mutationOverrides.location ?? null)
                : nextCoordinates();

            const mutation: LooMutationAttributes = {
                ...withoutLocation,
                location: locationValue,
            };

            if (mutation.name === undefined) {
                mutation.name = `Integration Loo ${coordinateCounter}`;
            }
            if (mutation.active === undefined) {
                mutation.active = true;
            }
            if (mutation.accessible === undefined) {
                mutation.accessible = true;
            }

            const service = new LooService(prisma as unknown as PrismaClientInstance);
            await service.create(id, mutation, contributor);
            const record = await service.getById(id);

            if (!record) {
                return sendJson(res, 500, { error: 'Failed to load loo fixture' });
            }
            return sendJson(res, 200, record);
        }

        if (req.method === 'GET' && url.pathname.startsWith('/loos/')) {
            const id = url.pathname.split('/').pop();
            if (!id) {
                return sendJson(res, 400, { error: 'Missing id' });
            }

            const record = await prisma.toilets.findUnique({ where: { id } });
            if (!record) {
                return sendJson(res, 404, { error: 'Not found' });
            }
            return sendJson(res, 200, record);
        }

        if (req.method === 'GET' && url.pathname === '/healthcheck') {
            return sendJson(res, 200, { status: 'ok' });
        }

        if (req.method === 'POST' && url.pathname === '/fixtures/upsert-loo') {
            const { id, data, contributor } = await readBody(req);
            if (!id || !data || !contributor) {
                return sendJson(res, 400, { error: 'Missing id, data, or contributor' });
            }

            const service = new LooService(prisma as unknown as PrismaClientInstance);
            await service.upsert(id, data, contributor);
            const record = await service.getById(id);

            if (!record) {
                return sendJson(res, 500, { error: 'Failed to load loo after upsert' });
            }
            return sendJson(res, 200, record);
        }

        sendJson(res, 404, { error: 'Not found' });

    } catch (error: any) {
        console.error('Sidecar error:', error);
        sendJson(res, 500, { error: error.message });
    }
});

server.listen(PORT, () => {
    console.log(`Sidecar listening on port ${PORT}`);
});
