import { Context } from 'hono';
import { Layout } from '../components/Layout';
import { TriStateToggle, Input, Button, TextArea } from '../components/DesignSystem';
import { looSchema } from '../utils/validation';
import { createPrismaClient } from '../../prisma';
import { Env } from '../../types';

export const loosList = (c: Context) => {
    return c.html(
        <Layout title="Loos">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-m);">
                <h1>Loos</h1>
                <Button href="/admin/loos/create">Add New Loo</Button>
            </div>
            <p>List of loos will appear here.</p>
        </Layout>
    );
};

const renderLooForm = (c: Context, errors?: Record<string, string>) => {
    return c.html(
        <Layout title="Add New Loo">
            <div style="max-width: 800px; margin: 0 auto;">
                <h1 style="margin-bottom: var(--space-l);">Add New Loo</h1>

                {errors && Object.keys(errors).length > 0 && (
                    <div style="border: 2px solid var(--color-accent-pink); border-left-width: 4px; padding: var(--space-m); border-radius: 8px; margin-bottom: var(--space-l);">
                        <strong style="color: var(--color-accent-pink); display: block; margin-bottom: var(--space-2xs);">Please fix the following errors:</strong>
                        <ul style="margin: 0; padding-left: var(--space-m);">
                            {Object.entries(errors).map(([field, error]) => (
                                <li style="color: var(--color-accent-pink); margin-bottom: var(--space-3xs);">{error}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <form method="post" action="/admin/loos" style="display: grid; gap: var(--space-l);">

                    <section style="background: var(--color-white); padding: var(--space-l); border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
                        <h2>Basic Information</h2>
                        <div style="display: grid; gap: var(--space-s);">
                            <Input label="Loo Name" name="name" placeholder="e.g. Public Toilet" error={errors?.name} />
                            <TextArea label="Notes" name="notes" placeholder="Any additional notes..." rows={3} error={errors?.notes} />
                        </div>
                    </section>

                    <section style="background: var(--color-white); padding: var(--space-l); border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
                        <h2>Location</h2>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-m);">
                            <Input label="Latitude" name="lat" placeholder="e.g. 51.5074" error={errors?.lat} />
                            <Input label="Longitude" name="lng" placeholder="e.g. -0.1278" error={errors?.lng} />
                        </div>
                    </section>

                    <section style="background: var(--color-white); padding: var(--space-l); border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
                        <h2>Accessibility & Access</h2>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-m);">
                            <TriStateToggle label="Accessible?" name="accessible" value={errors?.accessible ? undefined : undefined} error={errors?.accessible} />
                            <TriStateToggle label="Radar Key?" name="radar" error={errors?.radar} />
                            <TriStateToggle label="Attended?" name="attended" error={errors?.attended} />
                            <TriStateToggle label="Automatic?" name="automatic" error={errors?.automatic} />
                            <TriStateToggle label="No Payment?" name="noPayment" error={errors?.noPayment} />
                        </div>
                        <div style="margin-top: var(--space-s);">
                            <Input label="Payment Details" name="paymentDetails" placeholder="e.g. 50p coin only" error={errors?.paymentDetails} />
                        </div>
                    </section>

                    <section style="background: var(--color-white); padding: var(--space-l); border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
                        <h2>Facilities</h2>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-m);">
                            <TriStateToggle label="Baby Changing?" name="babyChange" error={errors?.babyChange} />
                            <TriStateToggle label="Men?" name="men" error={errors?.men} />
                            <TriStateToggle label="Women?" name="women" error={errors?.women} />
                            <TriStateToggle label="All Gender?" name="allGender" error={errors?.allGender} />
                            <TriStateToggle label="Children?" name="children" error={errors?.children} />
                            <TriStateToggle label="Urinal Only?" name="urinalOnly" error={errors?.urinalOnly} />
                        </div>
                    </section>

                    <section style="background: var(--color-white); padding: var(--space-l); border-radius: 12px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
                        <h2>Status</h2>
                        <TriStateToggle label="Active?" name="active" value="true" error={errors?.active} />
                        <TextArea label="Removal Reason" name="removalReason" placeholder="If inactive, why?" rows={3} error={errors?.removalReason} />
                    </section>

                    <div style="display: flex; justify-content: flex-end; gap: var(--space-m); margin-top: var(--space-m); padding-top: var(--space-m); border-top: 1px solid #e5e7eb;">
                        <Button variant="secondary" href="/admin/loos">Cancel</Button>
                        <Button type="submit">Save Loo</Button>
                    </div>
                </form>
            </div>
        </Layout>
    );
};

export const loosCreate = (c: Context) => {
    return renderLooForm(c);
};

export const loosCreatePost = async (c: Context<{ Bindings: Env }>) => {
    try {
        const formData = await c.req.formData();
        const data = Object.fromEntries(formData);

        // Validate the data
        const result = looSchema.safeParse(data);

        if (!result.success) {
            const errors: Record<string, string> = {};
            result.error.issues.forEach((err) => {
                if (err.path[0]) {
                    errors[err.path[0].toString()] = err.message;
                }
            });
            return renderLooForm(c, errors);
        }

        // Convert tri-state values to booleans or null
        const toBoolOrNull = (val?: string | null) => {
            if (val === 'true') return true;
            if (val === 'false') return false;
            return null;
        };

        // Create Prisma client
        const prisma = createPrismaClient(c.env.POSTGRES_URI);

        // Generate a unique ID (24 character hex string)
        const id = Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

        // Create the loo in the database
        await prisma.toilets.create({
            data: {
                id,
                name: result.data.name,
                notes: result.data.notes || null,
                accessible: toBoolOrNull(result.data.accessible),
                radar: toBoolOrNull(result.data.radar),
                attended: toBoolOrNull(result.data.attended),
                automatic: toBoolOrNull(result.data.automatic),
                no_payment: toBoolOrNull(result.data.noPayment),
                payment_details: result.data.paymentDetails || null,
                baby_change: toBoolOrNull(result.data.babyChange),
                men: toBoolOrNull(result.data.men),
                women: toBoolOrNull(result.data.women),
                all_gender: toBoolOrNull(result.data.allGender),
                children: toBoolOrNull(result.data.children),
                urinal_only: toBoolOrNull(result.data.urinalOnly),
                active: toBoolOrNull(result.data.active),
                removal_reason: result.data.removalReason || null,
                contributors: [],
                created_at: new Date(),
                updated_at: new Date(),
            },
        });

        return c.redirect('/admin/loos');
    } catch (error) {
        console.error('Error creating loo:', error);
        return renderLooForm(c, { _error: 'Failed to create loo. Please try again.' });
    }
};
