/** @jsxImportSource hono/jsx/dom */

import { useState, useEffect } from 'hono/jsx';
import { LooForm } from '../../shared/LooForm.client';
import { usePageConfig } from './hooks/usePageConfig';
import { useLooForm } from '../../shared/hooks/useLooForm';
import { buildPayload, validateForm } from '../../shared/utils/form';
import type { FieldErrors, SubmissionStatus, TriStateValue } from '../../shared/utils/types';

type CreatePageConfig = {
    api: {
        create: string;
    };
    defaults?: Partial<Record<string, string>>;
};

const mapIssueObject = (issues: unknown): FieldErrors => {
    if (!issues || typeof issues !== 'object') return {};
    const map: FieldErrors = {};
    Object.entries(issues as Record<string, unknown>).forEach(([key, value]) => {
        if (typeof value === 'string') {
            map[key] = value;
        } else if (value && typeof value === 'object' && '_errors' in value) {
            const errors = (value as { _errors?: unknown[] })._errors;
            if (Array.isArray(errors) && errors.length > 0 && typeof errors[0] === 'string') {
                map[key] = errors[0];
            }
        }
    });
    return map;
};

const hideServerShell = () => {
    const shell = document.querySelector('[data-loo-create-shell]');
    if (shell && shell instanceof HTMLElement) {
        shell.style.display = 'none';
    }
};

const scrollToSelector = (selector: string, options?: ScrollIntoViewOptions) => {
    if (typeof document === 'undefined') return;
    const el = document.querySelector(selector);
    if (el && el instanceof HTMLElement) {
        el.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            ...options,
        });
    }
};

const focusFieldByName = (name: string) => {
    if (typeof document === 'undefined') return;
    const field = document.querySelector(`[name="${name}"]`) as HTMLElement | null;
    if (field) {
        field.focus({ preventScroll: true });
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
};

const focusFirstErrorField = (fieldErrors: FieldErrors) => {
    const firstKey = Object.keys(fieldErrors)[0];
    if (!firstKey) return;
    requestAnimationFrame(() => focusFieldByName(firstKey));
};

const redirectToDetails = (id?: string | null) => {
    if (typeof window === 'undefined') return;
    if (id) {
        window.location.assign(`/admin/loos/${id}?source=create`);
        return;
    }
    window.location.assign('/admin/loos');
};

export const CreateLooApp = () => {
    const config = usePageConfig<CreatePageConfig>();

    if (!config) {
        return <div class="form-card">Loading create form…</div>;
    }

    return <CreateLooAppContent config={config} />;
};

const CreateLooAppContent = ({ config }: { config: CreatePageConfig }) => {
    const { form, updateField, updateTriState, updateOpeningHours, updateLocation } = useLooForm(config.defaults);
    const [status, setStatus] = useState<SubmissionStatus>('idle');
    const [errors, setErrors] = useState<FieldErrors>({});
    const [serverError, setServerError] = useState<string | null>(null);

    useEffect(() => {
        hideServerShell();
    }, []);

    const handleTriStateChange = (field: keyof typeof form, value: TriStateValue) => {
        updateTriState(field, value);
    };

    const handleSubmit = async (event: SubmitEvent) => {
        event.preventDefault();
        setServerError(null);

        const validation = validateForm(form);
        if (!validation.success) {
            setErrors(validation.errors || {});
            setStatus('error');
            focusFirstErrorField(validation.errors || {});
            return;
        }

        hideServerShell();
        setErrors({});
        setStatus('saving');

        try {
            const response = await fetch(config.api.create, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                },
                credentials: 'same-origin',
                body: JSON.stringify(buildPayload(validation.data)),
            });

            if (response.status === 401) {
                window.location.href = '/admin/login';
                return;
            }

            if (!response.ok) {
                const body = await response.json().catch(() => null);
                const apiIssues = body && typeof body === 'object' ? (body as Record<string, unknown>).issues : null;
                if (apiIssues) {
                    const issueMap = mapIssueObject(apiIssues);
                    setErrors(issueMap);
                    focusFirstErrorField(issueMap);
                }
                const message =
                    body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
                        ? (body as { message: string }).message
                        : 'The API rejected this request.';
                setServerError(message);
                setStatus('error');
                requestAnimationFrame(() => scrollToSelector('[data-error-banner]', { block: 'center' }));
                return;
            }

            const result = (await response.json().catch(() => null)) as { id?: string | null } | null;
            redirectToDetails(result?.id ?? null);
        } catch (error) {
            console.error('Failed to submit loo create request', error);
            setServerError('Unexpected error while saving. Please try again.');
            setStatus('error');
            requestAnimationFrame(() => scrollToSelector('[data-error-banner]', { block: 'center' }));
        }
    };

    return (
        <LooForm
            form={form}
            errors={errors}
            status={status}
            serverError={serverError}
            formId="loo-create-form"
            mode="create"
            onFieldChange={(field, value) => updateField(field, value)}
            onTriStateChange={handleTriStateChange}
            onOpeningHoursChange={updateOpeningHours}
            onLocationChange={updateLocation}
            onSubmit={handleSubmit}
        />
    );
};
