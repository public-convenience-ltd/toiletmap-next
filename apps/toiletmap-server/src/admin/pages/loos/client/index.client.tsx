/** @jsxImportSource hono/jsx/dom */

/**
 * Client-side entry point for Loos List app
 * This file will be bundled and included in the page
 */

import { render } from 'hono/jsx/dom';
import { LoosListApp } from './LoosListApp.client';

/**
 * Hide server-rendered loading states
 * The server renders placeholders with spinners that need to be hidden
 * when the client-side app takes over
 */
const hideServerRenderedLoaders = () => {
    // Hide all server-rendered loading indicators by adding 'hidden' attribute
    const loaders = [
        '[data-loos-metrics]',
        '[data-loos-table-loading]',
        '[data-loos-features-loading]',
        '[data-loos-areas-loading]',
        '[data-loos-pagination]',
    ];

    loaders.forEach((selector) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el) => {
            (el as HTMLElement).style.display = 'none';
        });
    });
};

// Wait for DOM to be ready
if (typeof window !== 'undefined') {
    const bootstrap = () => {
        // Hide server-rendered spinners immediately
        hideServerRenderedLoaders();

        const root = document.getElementById('loos-app-root');
        if (root) {
            render(<LoosListApp />, root);
        } else {
            console.error('Root element #loos-app-root not found');
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
}
