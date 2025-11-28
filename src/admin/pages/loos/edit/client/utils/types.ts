import type { LooFormState } from '../../../shared/utils/types';

export type EditPageConfig = {
    api: {
        update: string;
    };
    looId: string;
    defaults: Partial<LooFormState>;
};
