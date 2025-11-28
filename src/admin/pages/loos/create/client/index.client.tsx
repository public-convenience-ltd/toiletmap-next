/** @jsxImportSource hono/jsx/dom */

import { render } from 'hono/jsx/dom';
import { CreateLooApp } from './CreateLooApp.client';

const hideServerShell = () => {
    const shell = document.querySelector('[data-loo-create-shell]');
    if (shell && shell instanceof HTMLElement) {
        shell.style.display = 'none';
    }
};

if (typeof window !== 'undefined') {
    const mount = () => {
        hideServerShell();
        const root = document.getElementById('loo-create-root');
        if (!root) {
            console.error('Create form root not found');
            return;
        }
        render(<CreateLooApp />, root);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
}
