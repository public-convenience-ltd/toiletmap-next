import { JSX } from 'hono/jsx';
import { OpeningTimes } from '../../services/loo/types';

const DAYS = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
];

export const OpeningHours = (props: { openingTimes: OpeningTimes }) => {
    if (!props.openingTimes) {
        return <span style="color: var(--color-neutral-grey);">Unknown</span>;
    }

    // Check if all days are closed (empty arrays)
    const isClosed = props.openingTimes.every((day) => day.length === 0);
    if (isClosed) {
        return <span style="color: var(--color-accent-pink);">Closed</span>;
    }

    // Check if open 24/7 (all days have 00:00-00:00 or similar logic if we had it, 
    // but for now we'll just check if every day has some hours)
    // Actually, let's just render the list.

    return (
        <ul style="list-style: none; padding: 0; margin: 0; font-size: var(--text-0);">
            {props.openingTimes.map((times, index) => {
                const dayName = DAYS[index];
                let timeString = 'Closed';

                if (times.length > 0) {
                    // Assuming [open, close] format
                    const [open, close] = times;
                    if (open === '00:00' && close === '00:00') {
                         // This is often used for 24 hours in some datasets, 
                         // or we might see specific 24h flags. 
                         // For this system, let's just print the times or "24 Hours" if we detect it.
                         // But strictly following the type:
                         timeString = '24 Hours';
                    } else {
                        timeString = `${open} - ${close}`;
                    }
                }

                const isToday = new Date().getDay() === (index + 1) % 7;

                return (
                    <li 
                        key={dayName} 
                        style={{
                            display: 'flex', 
                            justifyContent: 'space-between',
                            padding: 'var(--space-3xs) 0',
                            borderBottom: '1px solid var(--color-neutral-light-grey)',
                            fontWeight: isToday ? '600' : 'normal',
                            color: isToday ? 'var(--color-primary)' : 'inherit'
                        }}
                    >
                        <span>{dayName}</span>
                        <span>{timeString}</span>
                    </li>
                );
            })}
        </ul>
    );
};
